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

app.use(minify());
app.use(express.json());
app.use(express.urlencoded());
app.use(express.static(path.join(__dirname, "public")));

const db = new sqlite.Database("counters.db");

db.serialize(() => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS counters (
      id TEXT PRIMARY KEY,
      name TEXT,
      value UNSIGNED BIG INT DEFAULT 0,
      public BOOLEAN,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Returns a bearer token for the user
app.post("/register", (req, res) => {
  const id = crypto.randomBytes(16).toString("hex");
  const token = crypto.randomBytes(16).toString("hex");

  db.run("INSERT INTO users (id, token) VALUES (?, ?)", [id, token], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ id, token });
  });
});

// Create counter
app.post("/counters", (req, res) => {
  let { name, public } = req.body;

  if (!name || name === "") {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  public =
    public === "true" || public === true || public === "1" ? true : false;

  // Validate name (alphanumeric and up to 32 characters long)
  const nameRegex = /^[a-zA-Z0-9 ]{1,32}$/;
  if (!nameRegex.test(name)) {
    res.status(400).json({
      error: "Name must be alphanumeric and up to 32 characters long",
    });
    return;
  }
  const id = crypto.randomBytes(16).toString("hex");
  db.run(
    "INSERT INTO counters (id, name, public) VALUES (?, ?, ?)",
    [id, name, public],
    (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ id, name, public });

      if (public === true) {
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

// Endpoint to share a counter (can only be shared by users that are joined to the counter)
app.post("/counters/:id/share", (req, res) => {
  const { id } = req.params;
  const { user_id } = req.body;
  db.get(
    "SELECT * FROM user_counters WHERE user_id = ? AND counter_id = ?",
    [user_id, id],
    (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      if (!row) {
        res.status(403).json({ error: "User is not joined to the counter" });
        return;
      }
      const token = crypto.randomBytes(16).toString("hex");
      db.run(
        "INSERT INTO join_tokens (token, counter_id) VALUES (?, ?)",
        [token, id],
        (err) => {
          if (err) {
            res.status(500).json({ error: err.message });
            return;
          }
          res.json({ token });
        },
      );
    },
  );
});

// Return public counters
app.get("/counters", (req, res) => {
  const orderBy = req.query.orderBy;
  let orderClause = "";

  if (orderBy === "value") {
    orderClause = "ORDER BY value";
  } else if (orderBy === "name") {
    orderClause = "ORDER BY name";
  }

  db.all(
    `SELECT id, name, value, DATE(created_at) as created_at FROM counters WHERE public = 1 ${orderClause}`,
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json(rows);
    },
  );
});
// Endpoint to increment a counter
app.post("/counters/:id/increment", (req, res) => {
  const { id } = req.params;
  // Increment the value of the counter and return the new value
  db.run("UPDATE counters SET value = value + 1 WHERE id = ?", [id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    db.get(
      "SELECT id, name, value, public FROM counters WHERE id = ?",
      [id],
      (err, row) => {
        if (err) {
          res.status(500).json({ error: err.message });
          return;
        }
        res.json({ id, name: row.name, value: row.value });

        io.to(id).emit("update", { id, value: row.value });

        if (row.public) {
          io.to("public").emit("update", {
            id,
            name: row.name,
            value: row.value,
          });
        }
      },
    );
  });
});

// Endpoint for sockets to get realtime updates for public counters
io.on("connection", (socket) => {
  // Print a log with number of connected clients
  console.log("a user connected", io.sockets.adapter.rooms.size);

  socket.on("subscribe", (counter) => {
    if (counter === "public") {
      socket.join(counter);
      return;
    } else {
      socket.join(counter);
    }
  });

  socket.on("unsubscribe", (counter) => {
    console.log("unsubscribing from", counter);
    socket.leave(counter);
  });
});

// Start server
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log("listening on *:" + port);
});
