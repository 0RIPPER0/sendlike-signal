// ======================================
//  IMPORTS & INITIAL SETUP
// ======================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ======================================
//  STATIC FILES
// ======================================
// Serve all static assets from 'public' folder
app.use(express.static(path.join(__dirname, "public")));

// Serve index.html on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ======================================
//  GROUP MANAGEMENT
// ======================================
let groups = {}; // Stores active groups

// Generate a random 6-digit group code
function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Disband a group and notify members
function disbandGroup(code, reason = "Group closed") {
  const group = groups[code];
  if (!group) return;

  io.to(code).emit("groupDisbanded", reason);
  clearTimeout(group.timer);
  delete groups[code];

  console.log(`❌ Group ${code} disbanded: ${reason}`);
}

// Start join window timer for the group
function startGroupTimer(code) {
  const group = groups[code];
  if (!group) return;

  clearTimeout(group.timer);
  if (group.ttlMs > 0) {
    group.timer = setTimeout(() => {
      disbandGroup(code, "Join time over");
    }, group.ttlMs);
  }
}

// ======================================
//  SOCKET.IO EVENTS
// ======================================
io.on("connection", (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // ---- CREATE GROUP ----
  socket.on("createGroup", ({ name, ttlMinutes = 10 }, callback) => {
    const code = generateCode();
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

    callback({ code, hostId: socket.id });
    io.to(code).emit("updateMembers", groups[code].members);

    console.log(`📌 Group created: ${code} by ${name}`);
  });

  // ---- JOIN GROUP ----
  socket.on("joinGroup", ({ name, code }, callback) => {
    const group = groups[code];
    if (!group) return callback({ error: "Group not found" });

    group.members.push({ id: socket.id, name });
    socket.join(code);

    io.to(code).emit("updateMembers", group.members);
    callback({ ok: true, hostId: group.hostId });

    console.log(`👤 ${name} joined group ${code}`);
  });

  // ---- CHAT ----
  socket.on("chat", ({ room, name, text }) => {
    io.to(room).emit("chat", { name, text });
  });

  // ---- DISBAND GROUP (HOST ONLY) ----
  socket.on("disbandGroup", (code) => {
    const group = groups[code];
    if (!group || group.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded");
  });

  // ---- DISCONNECT ----
  socket.on("disconnect", () => {
    Object.keys(groups).forEach((code) => {
      const group = groups[code];
      if (!group) return;

      const memberIndex = group.members.findIndex((m) => m.id === socket.id);
      if (memberIndex !== -1) {
        const wasHost = group.hostId === socket.id;
        group.members.splice(memberIndex, 1);

        if (wasHost) {
          disbandGroup(code, "Host left");
        } else {
          io.to(code).emit("updateMembers", group.members);
        }
      }
    });
  });
});

// ======================================
//  START SERVER
// ======================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
