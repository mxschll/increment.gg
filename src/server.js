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

// ===== Configuration =====
const PORT = process.env.PORT || 3000;
const NAME_REGEX = /^[a-zA-Z0-9 ]{1,32}$/;

// ===== Middleware Configuration =====
const rate_limiter = ratelimit({
  windowMs: 60 * 1000,
  limit: 120,
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (counter_id) REFERENCES counters(id)
    );
  `);
});

// Add periodic cleanup of old join tokens
const cleanupOldJoinTokens = () => {
  const expirationHours = 1; // Tokens expire after 1 hour
  console.log("Cleaning up old join tokens...");
  db.run(
    "DELETE FROM join_tokens WHERE datetime(created_at) < datetime('now', ?)",
    [`-${expirationHours} hours`],
    function(err) {
      if (err) {
        console.error("Failed to clean up old join tokens:", err);
      } else if (this.changes > 0) {
        console.log(`Removed ${this.changes} expired join tokens`);
      }
    }
  );
};

// Run cleanup every hour
setInterval(cleanupOldJoinTokens, 60 * 60 * 1000);
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
    sameSite: "strict",
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
    .replace(/[^\w\s-]/g, '') // Remove non-word chars except spaces and hyphens
    .replace(/\s+/g, '-')     // Replace spaces with hyphens
    .substring(0, 20);        // Limit length
  
  // Generate a 4-digit code
  const code = Math.floor(1000 + Math.random() * 9000);
  
  return `${slug}-${code}`;
};

// ===== Express Configuration =====
app.use(speed_limiter);
app.use(rate_limiter);
app.use(minify());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
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

  db.all(
    `SELECT c.id, c.name, c.value, DATE(c.created_at) as created_at 
     FROM counters c
     JOIN user_counters uc ON c.id = uc.counter_id
     WHERE uc.user_id = ? AND c.public = 0
     ${getOrderClause()}`,
    [req.userId],
    (err, rows) => {
      if (err) return handleError(res, 500, "Internal server error");
      res.render("private", { counters: rows, path: req.path });
    },
  );
});

// ===== API Routes =====
app.get("/join/:joinId", (req, res) => {
  const { joinId } = req.params;
  if (!joinId || !joinId.includes('-')) { // Check for valid format instead of fixed length
    return res.render("private", {
      error: "Invalid join link",
      path: req.path,
      counters: [],
    });
  }

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
        });
      }

      if (!row) {
        return res.render("private", {
          joinId,
          path: req.path,
          counters: [],
          error: "Invalid join token",
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

  db.run("UPDATE counters SET value = value + 1 WHERE id = ?", [id], (err) => {
    if (err) return handleError(res, 500, err.message);

    db.get(
      "SELECT id, name, value, public, DATE(created_at) as created_at FROM counters WHERE id = ?",
      [id],
      (err, counter) => {
        if (err) return handleError(res, 500, err.message);
        res.json({ id, name: counter.name, value: counter.value });
        emitCounterUpdate(counter, counter.public);
      },
    );
  });
});

app.post("/auth/logout", (req, res) => {
  clearAuthCookie(res);
  res.json({ success: true, message: "Logged out successfully" });
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

  socket.on("subscribe", (room) => socket.join(room));
  socket.on("unsubscribe", (room) => socket.leave(room));
});

// ===== Start Server =====
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
