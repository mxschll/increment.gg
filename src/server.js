const path = require("path");
const crypto = require("crypto");
const sqlite = require("sqlite3").verbose();

const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const minify = require("express-minify");
const ratelimit = require("express-rate-limit");
const slowdown = require("express-slow-down");
const cookieParser = require("cookie-parser");

// Configure rate limiters
const rate_limiter = ratelimit({
  windowMs: 1 * 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const speed_limiter = slowdown({
  windowMs: 5 * 60 * 1000,
  delayAfter: 120 * 5,
  delayMs: (hits) => hits * 200,
  maxDelayMs: 5000,
});

// Setup middleware
app.use(speed_limiter);
app.use(rate_limiter);
app.use(minify());
app.use(express.json());
app.use(express.urlencoded());
app.use(express.static(path.join(__dirname, "public")));
app.use(cookieParser());

// Configure view engine
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

// Initialize database
const db = new sqlite.Database("counters.db");

// Create database schema if it doesn't exist
db.serialize(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      id TEXT PRIMARY KEY,
      name TEXT,
      value UNSIGNED BIG INT DEFAULT 0,
      public BOOLEAN,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by TEXT REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      token TEXT
    );

    CREATE TABLE IF NOT EXISTS user_counters (
      user_id TEXT,
      counter_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (counter_id) REFERENCES counters(id),
      PRIMARY KEY (user_id, counter_id)
    );

    CREATE TABLE IF NOT EXISTS join_tokens (
      token TEXT PRIMARY KEY,
      counter_id TEXT,
      FOREIGN KEY (counter_id) REFERENCES counters(id)
    );
  `);
});

const authMiddleware = (req, res, next) => {
  // Check for token in Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    req.token = authHeader.substring(7);
  } 
  // Check for token in cookies (using cookie-parser)
  else if (req.cookies && req.cookies.token) {
    req.token = req.cookies.token;
  } 
  // No token found in either place
  else {
    req.token = null;
    return next();
  }
  
  // If we have a token, look up the associated user
  getUserByToken(req.token, (err, user) => {
    if (err) {
      console.error("Auth error:", err);
    }
    
    // Set userId on request object if user was found
    req.userId = user ? user.id : null;
    next();
  });
};

app.use(authMiddleware);

function getUserByToken(token, callback) {
  if (!token) {
    return callback(null, null);
  }
  
  db.get("SELECT id FROM users WHERE token = ?", [token], callback);
}

function setAuthCookie(res, token) {
  res.cookie('token', token, { 
    maxAge: 2147483647,
    httpOnly: true,
    sameSite: 'strict',
    path: '/'
  });
}

// Helper function to clear authentication cookie
function clearAuthCookie(res) {
  res.clearCookie('token', { path: '/' });
}

const getOrderClause = () => 
  "ORDER BY value / POWER((strftime('%s', 'now') - strftime('%s', created_at)), 1.7) DESC";

// Routes
app.get("/", (req, res) => {
  db.all(
    `SELECT * FROM counters WHERE public = 1 ${getOrderClause()}`,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).send("Internal server error");
      }
      res.render("index", { counters: rows, currentPath: req.path });
    }
  );
});

// Private counters route
app.get("/private", (req, res) => {

  const token = req.token;
  if (!token) {
    return res.render("private", { counters: [], currentPath: req.path });
  }

  const user = req.userId;


  db.all(
    `SELECT c.id, c.name, c.value, DATE(c.created_at) as created_at 
       FROM counters c
       JOIN user_counters uc ON c.id = uc.counter_id
       WHERE uc.user_id = ? AND c.public = 0
       ORDER BY c.value DESC`,
    [user],
      (err, rows) => {
        if (err) {
          console.error(err);
          return res.status(500).send("Internal server error");
        }

        console.log("rows");
        console.log(rows);

      res.render("private", { counters: rows, currentPath: req.path });
    }
  );
});

// Join counter route
app.get("/join/:joinId", (req, res) => {
  const joinId = req.params.joinId;
  if (!joinId || joinId.length !== 6) {
    return res.render("private", { error: "Invalid join link", currentPath: req.path });
  }

  res.render("private", { joinId, currentPath: req.path });
});

// About page route
app.get("/about", (req, res) => {
  res.render("about", { currentPath: req.path });
});

// Returns a bearer token for the user
app.post("/auth/register", (req, res) => {
  const id = crypto.randomBytes(16).toString("hex");
  const token = crypto.randomBytes(16).toString("hex");

  db.run("INSERT INTO users (id, token) VALUES (?, ?)", [id, token], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    // Set token as a cookie
    setAuthCookie(res, token);
    
    res.json({ id, token });
  });
});

// Create counter (form submission)
app.post("/counters", (req, res) => {
  let { name, public } = req.body;
  const token = req.token;
  
  // Require authentication for all counter creation
  if (!token) {
    return res.status(401).json({ error: "Authentication required to create counters" });
  }

  if (!name || name === "") {
    return res.status(400).json({ error: "Name is required" });
  }

  public = public === "true" || public === true || public === "1" ? true : false;

  // Validate name (alphanumeric and up to 32 characters long)
  const nameRegex = /^[a-zA-Z0-9 ]{1,32}$/;
  if (!nameRegex.test(name)) {
    return res.status(400).json({
      error: "Name must be alphanumeric and up to 32 characters long",
    });
  }

  const id = crypto.randomBytes(16).toString("hex");

  // Get user from token
  getUserByToken(token, (err, user) => {
    if (err) {
      return res.status(500).json({ error: "Database error while validating user" });
    }

    if (!user) {
      return res.status(401).json({ error: "Valid authentication required to create counters" });
    }

    // Create the counter with user association
    createCounter(user.id);
  });

  // Function to create counter with user association
  function createCounter(userId) {
    db.run(
      "INSERT INTO counters (id, name, public, created_by) VALUES (?, ?, ?, ?)",
      [id, name, public, userId],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        const response = { id, name, public };

        // For private counters, add entry to user_counters table to give creator access
        if (!public) {
          db.run(
            "INSERT INTO user_counters (user_id, counter_id) VALUES (?, ?)",
            [userId, id],
            (err) => {
              if (err) {
                console.error("Failed to create user_counter association:", err);
                // Still return success for counter creation
              }
              res.json(response);
              
              // Emit socket event for private counters
              io.to(`private:${userId}`).emit("private:new", {
                id,
                name,
                value: 0,
                created_at: new Date().toISOString().split("T")[0],
              });
            }
          );
        } else {
          res.json(response);

          // Emit socket event for public counters
          io.to("public").emit("new", {
            id,
            name,
            value: 0,
            created_at: new Date().toISOString().split("T")[0],
          });
        }
      }
    );
  }
});

// Endpoint to share a counter (can only be shared by users that are joined to the counter)
app.post("/counters/:id/share", (req, res) => {
  const { id } = req.params;
  const token = req.token;
  
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  
  getUserByToken(token, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }
    
    const user_id = user.id;

    // Check if user has access to the counter
    db.get("SELECT created_by FROM counters WHERE id = ?", [id], (err, counter) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!counter) {
        return res.status(404).json({ error: "Counter not found" });
      }

      // If user is the creator, they can share it
      if (counter.created_by === user_id) {
        createShareToken();
      } else {
        // If not the creator, check if they have access through user_counters
        db.get(
          "SELECT * FROM user_counters WHERE user_id = ? AND counter_id = ?",
          [user_id, id],
          (err, row) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            if (!row) {
              return res.status(403).json({ error: "User is not joined to the counter" });
            }
            createShareToken();
          }
        );
      }
    });
  });

  function createShareToken() {
    const token = crypto.randomBytes(16).toString("hex");
    db.run(
      "INSERT INTO join_tokens (token, counter_id) VALUES (?, ?)",
      [token, id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ token });
      }
    );
  }
});

// Endpoint to join a counter
app.post("/join", (req, res) => {
  const token = req.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  getUserByToken(token, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    // Join token is sent as parameter
    const { token: joinToken } = req.body;

    if (!joinToken) {
      return res.status(400).json({ error: "Join token is required" });
    }

    // Check if join token is valid
    db.get("SELECT counter_id FROM join_tokens WHERE token = ?", [joinToken], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!row) {
        return res.status(404).json({ error: "Invalid join token" });
      }

      // Add user to counter
      db.run("INSERT INTO user_counters (user_id, counter_id) VALUES (?, ?)", [user.id, row.counter_id], (err) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ success: true });
      });
    });
  });
});

// Endpoint to join a counter using a join ID in the URL
app.post("/counters/join/:joinId", (req, res) => {
  const token = req.token;
  const { joinId } = req.params;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  getUserByToken(token, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }

    if (!joinId) {
      return res.status(400).json({ error: "Join ID is required" });
    }

    // Check if join token is valid
    db.get("SELECT counter_id FROM join_tokens WHERE token = ?", [joinId], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (!row) {
        return res.status(404).json({ error: "Invalid join ID" });
      }

      // Check if user is already joined to this counter
      db.get(
        "SELECT * FROM user_counters WHERE user_id = ? AND counter_id = ?",
        [user.id, row.counter_id],
        (err, existingRow) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          if (existingRow) {
            // User is already joined to this counter
            return res.json({ success: true, message: "Already joined to this counter" });
          }

          // Add user to counter
          db.run(
            "INSERT INTO user_counters (user_id, counter_id) VALUES (?, ?)",
            [user.id, row.counter_id],
            (err) => {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              
              // Get counter details to return to client
              db.get(
                "SELECT id, name, value, DATE(created_at) as created_at FROM counters WHERE id = ?",
                [row.counter_id],
                (err, counter) => {
                  if (err) {
                    return res.status(500).json({ error: err.message });
                  }
                  
                  res.json({ 
                    success: true, 
                    message: "Successfully joined counter",
                    counter
                  });
                }
              );
            }
          );
        }
      );
    });
  });
});

// Return public counters
app.get("/counters", (req, res) => {
  db.all(
    `SELECT id, name, value, DATE(created_at) as created_at 
     FROM counters WHERE public = 1 ${getOrderClause()}`,
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rows);
    },
  );
});

// Return private counters
app.get("/counters/private", (req, res) => {
  const token = req.token;

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  getUserByToken(token, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ error: "Invalid authentication token" });
    }
    
    db.all(
      `SELECT c.id, c.name, c.value, DATE(c.created_at) as created_at 
       FROM counters c
       JOIN user_counters uc ON c.id = uc.counter_id
       WHERE uc.user_id = ? AND c.public = 0
       ORDER BY c.value DESC`,
      [user.id],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json(rows);
      }
    );
  });
});

// Endpoint to increment a counter
app.post("/counters/:id/increment", (req, res) => {
  const { id } = req.params;
  const token = req.token;

  // Increment the value of the counter and return the new value
  db.run("UPDATE counters SET value = value + 1 WHERE id = ?", [id], (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    db.get(
      "SELECT id, name, value, public, DATE(created_at) as created_at FROM counters WHERE id = ?",
      [id],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        
        res.json({ id, name: row.name, value: row.value });

        // Emit event to counter-specific room
        io.to(id).emit("update", { id, value: row.value });

        if (row.public) {
          // Emit to public room for public counters
          io.to("public").emit("update", {
            id,
            name: row.name,
            value: row.value,
            created_at: row.created_at
          });
        } else {
          // For private counters, emit to all users who have access to this counter
          db.all(
            "SELECT user_id FROM user_counters WHERE counter_id = ?",
            [id],
            (err, users) => {
              if (err || !users) {
                return;
              }
              
              // Emit to each user's private room
              users.forEach(user => {
                io.to(`private:${user.user_id}`).emit("private:update", {
                  id,
                  name: row.name,
                  value: row.value,
                  created_at: row.created_at
                });
              });
            }
          );
        }
      },
    );
  });
});

// Endpoint for auth status
app.get("/auth/status", (req, res) => {
  const token = req.token;
  const user = req.userId;
  
  if (!token) {
    return res.status(401).json({ 
      authenticated: false, 
      message: "No token provided" 
    });
  }

  if (!user) {
    return res.status(401).json({ 
      authenticated: false, 
      message: "Invalid token" 
    });
  }

  setAuthCookie(res, token);

  res.json({ 
    authenticated: true, 
    user: { id: user.id } 
  });
});

// Endpoint for logging out
app.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
});

// Socket.io event handling
io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);
  
  // Helper function to authenticate socket with token
  function authenticateSocket(token) {
    getUserByToken(token, (err, user) => {
      if (err || !user) {
        console.log("Socket auth failed:", err || "Invalid token");
        return;
      }
      
      console.log("Socket authenticated for user:", user.id);
      socket.join(`private:${user.id}`);
      socket.userId = user.id;
    });
  }
  
  // Handle authentication if token is provided in handshake auth
  if (socket.handshake.auth && socket.handshake.auth.token) {
    authenticateSocket(socket.handshake.auth.token);
  }
  // Check for token in cookies
  else if (socket.handshake.headers.cookie) {
    const cookies = socket.handshake.headers.cookie.split(';').map(cookie => cookie.trim());
    for (const cookie of cookies) {
      if (cookie.startsWith('token=')) {
        const token = cookie.substring(6); // 'token='.length === 6
        authenticateSocket(token);
        break;
      }
    }
  }
  
  socket.on("subscribe", (room) => {
    console.log(`Socket ${socket.id} subscribing to room:`, room);
    
    if (room === "public") {
      socket.join(room);
      return;
    }

    // Handle private room subscriptions
    if (room.startsWith("private:")) {
      const userId = room.split(":")[1];

      // Verify the user exists before allowing subscription
      db.get("SELECT id FROM users WHERE id = ?", [userId], (err, user) => {
        if (err || !user) {
          console.log("Failed to subscribe to private room:", err || "User not found");
          return;
        }
        console.log(`Socket ${socket.id} joined private room for user:`, userId);
        socket.join(room);
      });
      return;
    }

    // For any other room (like specific counter rooms)
    socket.join(room);
  });

  socket.on("unsubscribe", (room) => {
    console.log(`Socket ${socket.id} unsubscribing from room:`, room);
    socket.leave(room);
  });
  
  socket.on("disconnect", (reason) => {
    console.log(`Socket ${socket.id} disconnected:`, reason);
  });
});

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("listening on *:" + port);
});
