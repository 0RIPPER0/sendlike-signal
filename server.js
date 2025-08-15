// ================================
//  SERVER SIDE - SendLike
// ================================
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));

// Groups storage
let groups = {};

// Generate random 6-digit code
function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Disband group helper
function disbandGroup(code, reason = "Group closed") {
  const g = groups[code];
  if (!g) return;
  io.to(code).emit("groupDisbanded", reason);
  clearTimeout(g.timer);
  delete groups[code];
}

// Start join window timer
function startGroupTimer(code) {
  const g = groups[code];
  if (!g) return;
  clearTimeout(g.timer);
  if (g.ttlMs > 0) {
    g.timer = setTimeout(() => {
      g.joinOpen = false; // mark join as closed, but group still exists
      io.to(code).emit("joinClosed");
    }, g.ttlMs);
  }
}

io.on("connection", (socket) => {
  
  // ================================
  //  CREATE GROUP
  // ================================
  socket.on("createGroup", ({ name, ttlMinutes = 10 }, cb) => {
    const code = genCode();
    const ttlMs = ttlMinutes * 60 * 1000;
    groups[code] = {
      hostId: socket.id,
      createdAt: Date.now(),
      ttlMs,
      joinOpen: true,
      members: [{ id: socket.id, name }],
      timer: null
    };
    socket.join(code);
    startGroupTimer(code);

    cb({ code, hostId: socket.id });
    io.to(code).emit("updateMembers", groups[code].members); // send to everyone
  });

  // ================================
  //  JOIN GROUP
  // ================================
  socket.on("joinGroup", ({ name, code }, cb) => {
    const g = groups[code];
    if (!g) return cb({ error: "Group not found" });
    if (!g.joinOpen) return cb({ error: "Join window closed" });

    g.members.push({ id: socket.id, name });
    socket.join(code);

    io.to(code).emit("updateMembers", g.members); // send to everyone including new joiner
    cb({ ok: true, hostId: g.hostId });
  });

  // ================================
  //  CHAT
  // ================================
  socket.on("chat", ({ room, name, text }) => {
    io.to(room).emit("chat", { name, text }); // send to all including sender
  });

  // ================================
  //  DISBAND
  // ================================
  socket.on("disbandGroup", (code) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded");
  });

  // ================================
  //  DISCONNECT
  // ================================
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

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
