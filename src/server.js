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
const bcrypt = require("bcrypt");
const compression = require("compression");

// ===== Configuration =====
const PORT = process.env.PORT || 3000;
const NAME_REGEX = /^[a-zA-Z0-9 ]{1,32}$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const SALT_ROUNDS = 10;

// ===== Middleware Configuration =====
const rate_limiter = ratelimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const speed_limiter = slowdown({
  windowMs: 5 * 60 * 1000,
  delayAfter: 600,
  delayMs: (hits) => hits * 200,
  maxDelayMs: 5000,
});

// ===== Database Setup =====
const db = new sqlite.Database("counters.db");
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
      token TEXT,
      username TEXT UNIQUE,
      password_hash TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (counter_id) REFERENCES counters(id)
    );
  `);
});

// Periodic cleanup of old join tokens
const cleanupOldJoinTokens = () => {
  const expirationDays = 7; // Tokens expire after 7 days
  console.log("Cleaning up old join tokens...");
  db.run(
    "DELETE FROM join_tokens WHERE datetime(created_at) < datetime('now', ?)",
    [`-${expirationDays} days`],
    function (err) {
      if (err) {
        console.error("Failed to clean up old join tokens:", err);
      } else if (this.changes > 0) {
        console.log(`Removed ${this.changes} expired join tokens`);
      }
    },
  );
};

// Run cleanup every day
setInterval(cleanupOldJoinTokens, 24 * 60 * 60 * 1000);
cleanupOldJoinTokens();

// ===== Helper Functions =====
const handleError = (res, status, message) => {
  console.error(message);
  return res.status(status).json({ error: message });
};

const generateId = () => crypto.randomBytes(16).toString("hex");

const getOrderClause = () =>
  "ORDER BY value / POWER((strftime('%s', 'now') - strftime('%s', created_at)), 1.7) DESC";

const getUserByToken = (token, callback) => {
  if (!token) return callback(null, null);
  db.get("SELECT id FROM users WHERE token = ?", [token], callback);
};

const setAuthCookie = (res, token) => {
  res.cookie("token", token, {
    maxAge: 2147483647,
    httpOnly: true,
    sameSite: "none",
    secure: true,
    path: "/",
  });
};

const clearAuthCookie = (res) => res.clearCookie("token", { path: "/" });

const emitCounterUpdate = (counter, isPublic) => {
  const { id, name, value, created_at } = counter;
  const updateData = { id, name, value, created_at };

  io.to(id).emit("update", { id, value });

  if (isPublic) {
    io.to("public").emit("update", updateData);
  } else {
    db.all(
      "SELECT user_id FROM user_counters WHERE counter_id = ?",
      [id],
      (err, users) => {
        if (!err && users) {
          users.forEach((user) => {
            io.to(`private:${user.user_id}`).emit("private:update", updateData);
          });
        }
      },
    );
  }
};

// Generate a join token as counter-slug-1234
const generateJoinToken = (counterName) => {
  // Create a slug from the counter name
  const slug = counterName
    .toLowerCase()
    .replace(/[^\w\s-]/g, "") // Remove non-word chars except spaces and hyphens
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .substring(0, 20); // Limit length

  // Generate a 4-digit code
  const code = Math.floor(1000 + Math.random() * 9000);

  return `${slug}-${code}`;
};

// Add these functions after the existing helper functions
const hashPassword = async (password) => {
  return await bcrypt.hash(password, SALT_ROUNDS);
};

const verifyPassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

const getUserByUsername = (username, callback) => {
  if (!username) return callback(null, null);
  db.get("SELECT * FROM users WHERE username = ?", [username], callback);
};

const associateCountersWithUser = (userId, callback) => {
  db.all(
    "SELECT id FROM counters WHERE created_by = ?",
    [userId],
    (err, counters) => {
      if (err) return callback(err);

      if (!counters || counters.length === 0) return callback(null);

      const values = counters.map((c) => `('${userId}', '${c.id}')`).join(",");
      db.run(
        `INSERT OR IGNORE INTO user_counters (user_id, counter_id) VALUES ${values}`,
        callback,
      );
    },
  );
};

// ===== Express Configuration =====
app.use(compression());
app.use(minify());
app.use(speed_limiter);
app.use(rate_limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const cacheTime = 86400000 * 7; // 7 days
app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: cacheTime,
    etag: true,
    lastModified: true,
  }),
);

app.use(cookieParser());

// ===== Authentication Middleware =====
app.use((req, res, next) => {
  req.token = req.cookies?.token || null;
  if (!req.token) {
    req.userId = null;
    return next();
  }
  getUserByToken(req.token, (err, user) => {
    if (err) console.error("Auth error:", err);
    req.userId = user?.id || null;
    next();
  });
});

// ===== Auto-Registration Middleware =====
app.use((req, res, next) => {
  // Skip for static resources and API endpoints
  if (
    req.path.startsWith("/css") ||
    req.path.startsWith("/js") ||
    req.path.startsWith("/dist") ||
    req.path.startsWith("/socket.io") ||
    req.path === "/favicon.ico"
  ) {
    return next();
  }

  // If user is already authenticated, proceed
  if (req.userId) {
    return next();
  }

  // Auto-register new users
  const userId = generateId();
  const token = generateId();

  db.run(
    "INSERT INTO users (id, token) VALUES (?, ?)",
    [userId, token],
    (err) => {
      if (err) {
        console.error("Failed to auto-register user:", err);
        return next(); // Continue anyway to avoid blocking the request
      }

      // Set the auth cookie
      setAuthCookie(res, token);

      // Update the request with the new user ID
      req.userId = userId;
      req.token = token;

      next();
    },
  );
});

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

// ===== Authentication Routes =====
app.post("/auth/register", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return handleError(res, 400, "Username and password are required");
  }

  if (!USERNAME_REGEX.test(username)) {
    return handleError(res, 400, "Invalid username format");
  }

  if (password.length < 6) {
    return handleError(res, 400, "Password must be at least 6 characters");
  }

  try {
    const passwordHash = await hashPassword(password);
    const userId = req.userId; // Use existing auto-registered ID

    db.run(
      "UPDATE users SET username = ?, password_hash = ? WHERE id = ?",
      [username, passwordHash, userId],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE")) {
            return handleError(res, 409, "Username already taken");
          }
          return handleError(res, 500, "Failed to register user");
        }

        // Associate any existing counters with the user
        associateCountersWithUser(userId, (err) => {
          if (err) console.error("Failed to associate counters:", err);
          res.json({ success: true });
        });
      },
    );
  } catch (err) {
    return handleError(res, 500, "Failed to hash password");
  }
});

app.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return handleError(res, 400, "Username and password are required");
  }

  getUserByUsername(username, async (err, user) => {
    if (err) return handleError(res, 500, "Internal server error");
    if (!user) return handleError(res, 401, "Invalid credentials");

    try {
      const validPassword = await verifyPassword(password, user.password_hash);
      if (!validPassword) {
        return handleError(res, 401, "Invalid credentials");
      }

      // Set the auth cookie with the user's token
      setAuthCookie(res, user.token);

      // Associate any counters from the current session with the logged-in account
      if (req.userId !== user.id) {
        associateCountersWithUser(req.userId, (err) => {
          if (err) console.error("Failed to associate counters:", err);
          // Update the user's ID for the current request
          req.userId = user.id;
          res.json({ success: true });
        });
      } else {
        res.json({ success: true });
      }
    } catch (err) {
      return handleError(res, 500, "Failed to verify password");
    }
  });
});

app.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  // Generate a new anonymous user
  const userId = generateId();
  const token = generateId();

  db.run(
    "INSERT INTO users (id, token) VALUES (?, ?)",
    [userId, token],
    (err) => {
      if (err) return handleError(res, 500, "Failed to create anonymous user");
      setAuthCookie(res, token);
      req.userId = userId;
      res.json({ success: true });
    },
  );
});

// Add auth status endpoint
app.get("/auth/status", (req, res) => {
  if (!req.userId) {
    return res.json({ authenticated: false });
  }

  db.get(
    "SELECT username FROM users WHERE id = ?",
    [req.userId],
    (err, user) => {
      if (err) return handleError(res, 500, "Internal server error");
      res.json({
        authenticated: !!user.username,
        username: user.username,
      });
    },
  );
});

// ===== View Routes =====
app.get("/", (req, res) => {
  db.all(
    `SELECT * FROM counters WHERE public = 1 ${getOrderClause()}`,
    (err, rows) => {
      if (err) return handleError(res, 500, "Internal server error");
      res.render("index", { counters: rows, path: req.path });
    },
  );
});

app.get("/private", (req, res) => {
  if (!req.token) {
    return res.render("private", { counters: [], path: req.path });
  }

  // Get the username for the authenticated user
  db.get(
    "SELECT username FROM users WHERE id = ?",
    [req.userId],
    (err, user) => {
      if (err) {
        console.error("Error fetching user:", err);
        return res.render("private", { counters: [], path: req.path });
      }

      // Fetch the user's private counters
      db.all(
        `SELECT c.id, c.name, c.value, DATE(c.created_at) as created_at 
         FROM counters c
         JOIN user_counters uc ON c.id = uc.counter_id
         WHERE uc.user_id = ? AND c.public = 0
         ${getOrderClause()}`,
        [req.userId],
        (err, rows) => {
          if (err) return handleError(res, 500, "Internal server error");
          res.render("private", {
            counters: rows,
            path: req.path,
            username: user ? user.username : null,
          });
        },
      );
    },
  );
});

// ===== API Routes =====
app.get("/join/:joinId", (req, res) => {
  const { joinId } = req.params;
  if (!joinId || !joinId.includes("-")) {
    // Check for valid format instead of fixed length
    return res.render("private", {
      error: "Invalid join link",
      path: req.path,
      counters: [],
    });
  }

  // If user is authenticated, get their username
  const getUserAndContinue = (callback) => {
    if (!req.userId) {
      return callback(null);
    }

    db.get(
      "SELECT username FROM users WHERE id = ?",
      [req.userId],
      (err, user) => {
        if (err) {
          console.error("Error fetching user:", err);
          return callback(null);
        }
        return callback(user ? user.username : null);
      },
    );
  };

  getUserAndContinue((username) => {
    // First verify the join token is valid
    db.get(
      "SELECT counter_id FROM join_tokens WHERE token = ?",
      [joinId],
      (err, row) => {
        if (err) {
          return res.render("private", {
            joinId,
            path: req.path,
            counters: [],
            error: "Database error",
            username,
          });
        }

        if (!row) {
          return res.render("private", {
            joinId,
            path: req.path,
            counters: [],
            error: "Invalid join token",
            username,
          });
        }

        const counterId = row.counter_id;

        // Check if the user is already joined to this counter
        db.get(
          "SELECT * FROM user_counters WHERE user_id = ? AND counter_id = ?",
          [req.userId, counterId],
          (err, existingRow) => {
            if (err) {
              return res.render("private", {
                joinId,
                path: req.path,
                counters: [],
                error: "Database error",
                username,
              });
            }

            if (existingRow) {
              return res.redirect("/private");
            }

            // Join the counter to the user's account
            db.run(
              "INSERT INTO user_counters (user_id, counter_id) VALUES (?, ?)",
              [req.userId, counterId],
              (err) => {
                if (err) {
                  return res.render("private", {
                    joinId,
                    path: req.path,
                    counters: [],
                    error: "Failed to join counter",
                    username,
                  });
                }
                res.redirect("/private");
              },
            );
          },
        );
      },
    );
  });
});

app.post("/counters", (req, res) => {
  let { name, public } = req.body;

  if (!req.token || !req.userId) {
    return handleError(res, 401, "Authentication required to create counters");
  }

  if (!name || name === "") {
    return handleError(res, 400, "Name is required");
  }

  public = ["true", "1", true].includes(public);

  if (!NAME_REGEX.test(name)) {
    return handleError(
      res,
      400,
      "Name must be alphanumeric and up to 32 characters long",
    );
  }

  const id = generateId();

  db.run(
    "INSERT INTO counters (id, name, public, created_by) VALUES (?, ?, ?, ?)",
    [id, name, public, req.userId],
    function (err) {
      if (err) return handleError(res, 500, err.message);

      const response = { id, name, public };

      if (!public) {
        db.run(
          "INSERT INTO user_counters (user_id, counter_id) VALUES (?, ?)",
          [req.userId, id],
          (err) => {
            if (err)
              console.error("Failed to create user_counter association:", err);
            res.json(response);
            io.to(`private:${req.userId}`).emit("private:new", {
              id,
              name,
              value: 0,
              created_at: new Date().toISOString().split("T")[0],
            });
          },
        );
      } else {
        res.json(response);
        io.to("public").emit("new", {
          id,
          name,
          value: 0,
          created_at: new Date().toISOString().split("T")[0],
        });
      }
    },
  );
});

app.post("/counters/:id/share", (req, res) => {
  const { id } = req.params;

  if (!req.token) {
    return handleError(res, 401, "Authentication required");
  }

  db.get(
    `SELECT c.id, c.name, c.public 
       FROM counters c 
       WHERE c.id = ? AND (
         c.public = 1 OR 
         c.created_by = ? OR 
         EXISTS (SELECT 1 FROM user_counters uc WHERE uc.counter_id = c.id AND uc.user_id = ?)
       )`,
    [id, req.userId, req.userId], // Fixed: req.userId instead of user.id
    (err, row) => {
      if (err) return handleError(res, 500, err.message);
      if (!row) return handleError(res, 403, "Cannot share this counter");

      const token = generateJoinToken(row.name); // Use counter name to generate token
      db.run(
        "INSERT INTO join_tokens (token, counter_id) VALUES (?, ?)",
        [token, id],
        (err) => {
          if (err) return handleError(res, 500, err.message);
          res.json({ token });
        },
      );
    },
  );
});

app.get("/counters", (req, res) => {
  db.all(
    `SELECT id, name, value, DATE(created_at) as created_at 
     FROM counters WHERE public = 1 ${getOrderClause()}`,
    (err, rows) => {
      if (err) return handleError(res, 500, err.message);
      res.json(rows);
    },
  );
});

app.get("/counters/private", (req, res) => {
  if (!req.token || !req.userId) {
    return handleError(res, 401, "Authentication required");
  }

  db.all(
    `SELECT c.id, c.name, c.value, DATE(c.created_at) as created_at 
       FROM counters c
       JOIN user_counters uc ON c.id = uc.counter_id
       WHERE uc.user_id = ? AND c.public = 0
       ${getOrderClause()}`,
    [req.userId],
    (err, rows) => {
      if (err) return handleError(res, 500, err.message);
      res.json(rows);
    },
  );
});

app.post("/counters/:id/increment", (req, res) => {
  const { id } = req.params;

  // First check if the counter is public or if the user has access to it
  db.get(
    `SELECT c.id, c.name, c.value, c.public, DATE(c.created_at) as created_at 
     FROM counters c 
     WHERE c.id = ? AND (
       c.public = 1 OR 
       (c.public = 0 AND ? IS NOT NULL AND EXISTS (
         SELECT 1 FROM user_counters uc 
         WHERE uc.counter_id = c.id AND uc.user_id = ?
       ))
     )`,
    [id, req.userId, req.userId],
    (err, counter) => {
      if (err) return handleError(res, 500, err.message);
      if (!counter) return handleError(res, 403, "You don't have access to this counter");

      // Proceed with incrementing the counter
      db.run("UPDATE counters SET value = value + 1 WHERE id = ?", [id], (err) => {
        if (err) return handleError(res, 500, err.message);

        // Get the updated counter value
        db.get(
          "SELECT id, name, value, public, DATE(created_at) as created_at FROM counters WHERE id = ?",
          [id],
          (err, updatedCounter) => {
            if (err) return handleError(res, 500, err.message);
            res.json({ id, name: updatedCounter.name, value: updatedCounter.value });
            emitCounterUpdate(updatedCounter, updatedCounter.public);
          }
        );
      });
    }
  );
});

// ===== Socket.IO Setup =====
io.on("connection", (socket) => {
  const authenticateSocket = (token) => {
    getUserByToken(token, (err, user) => {
      if (!err && user) {
        socket.join(`private:${user.id}`);
        socket.userId = user.id;
      }
    });
  };

  // Handle authentication
  if (socket.handshake.auth?.token) {
    authenticateSocket(socket.handshake.auth.token);
  } else if (socket.handshake.headers.cookie) {
    const token = socket.handshake.headers.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith("token="))
      ?.substring(6);
    if (token) authenticateSocket(token);
  }

  socket.on("subscribe", (room) => {
    socket.join(room);

    // Send counter states based on room type
    if (room === "public") {
      // Send public counters
      db.all(
        `SELECT id, name, value, DATE(created_at) as created_at 
         FROM counters 
         WHERE public = 1
         ${getOrderClause()}`,
        [],
        (err, counters) => {
          if (!err && counters) {
            socket.emit("counters:sync", counters);
          }
        },
      );
    } else if (room === "private" && socket.userId) {
      // Send private counters for authenticated user
      db.all(
        `SELECT c.id, c.name, c.value, DATE(c.created_at) as created_at 
         FROM counters c
         JOIN user_counters uc ON c.id = uc.counter_id
         WHERE uc.user_id = ? AND c.public = 0
         ${getOrderClause()}`,
        [socket.userId],
        (err, counters) => {
          if (!err && counters) {
            socket.emit("private:counters:sync", counters);
          }
        },
      );
    }
  });

  socket.on("unsubscribe", (room) => socket.leave(room));
});

// ===== Start Server =====
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
