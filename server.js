// ============================
//  IMPORTS & SETUP
// ============================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ============================
//  STATIC FILES
// ============================
// Serve all static assets from the 'public' folder
app.use(express.static(path.join(__dirname, "public")));

// Serve index.html on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ============================
//  GROUP LOGIC
// ============================
let groups = {};

// Generate a random 6-digit group code
function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Disband a group and notify members
function disbandGroup(code, reason = "Group closed") {
  const g = groups[code];
  if (!g) return;
  io.to(code).emit("groupDisbanded", reason);
  clearTimeout(g.timer);
  delete groups[code];
}

// Start the join window timer for a group
function startGroupTimer(code) {
  const g = groups[code];
  if (!g) return;
  clearTimeout(g.timer);
  if (g.ttlMs > 0) {
    g.timer = setTimeout(() => {
      disbandGroup(code, "Join time over");
    }, g.ttlMs);
  }
}

// ============================
//  SOCKET.IO EVENTS
// ============================
io.on("connection", (socket) => {
  console.log(`🔌 New client connected: ${socket.id}`);

  // Create a group
  socket.on("createGroup", ({ name, ttlMinutes = 10 }, cb) => {
    const code = genCode();
    const ttlMs = ttlMinutes * 60 * 1000;

    groups[code] = {
      hostId: socket.id,
      createdAt: Date.now(),
      ttlMs,
      members: [{ id: socket.id, name }],
      timer: null,
    };

    socket.join(code);
    startGroupTimer(code);

    cb({ code, hostId: socket.id });
    io.to(code).emit("updateMembers", groups[code].members);

    console.log(`📌 Group created: ${code} by ${name}`);
  });

  // Join a group
  socket.on("joinGroup", ({ name, code }, cb) => {
    const g = groups[code];
    if (!g) return cb({ error: "Group not found" });

    g.members.push({ id: socket.id, name });
    socket.join(code);
    io.to(code).emit("updateMembers", g.members);
    cb({ ok: true, hostId: g.hostId });

    console.log(`👤 ${name} joined group ${code}`);
  });

  // Send chat message
  socket.on("chat", ({ room, name, text }) => {
    io.to(room).emit("chat", { name, text });
  });

  // Disband group (host only)
  socket.on("disbandGroup", (code) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded");
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    Object.keys(groups).forEach((code) => {
      const g = groups[code];
      if (!g) return;

      const idx = g.members.findIndex((m) => m.id === socket.id);
      if (idx !== -1) {
        const wasHost = g.hostId === socket.id;
        g.members.splice(idx, 1);

        if (wasHost) {
          disbandGroup(code, "Host left");
        } else {
          io.to(code).emit("updateMembers", g.members);
        }
      }
    });
  });
});

// ============================
//  START SERVER
// ============================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
