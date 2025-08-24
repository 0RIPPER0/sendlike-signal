// server.js — Socket.IO signaling + simple LAN roster (zero file relaying)
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// Serve static assets
const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));

// Health
app.get("/health", (_, res) => res.status(200).send("ok"));

// -------- Local discovery roster --------
// Each connected socket can "enterLocal(name)" to join the local lobby.
// We keep a simple in-memory map and broadcast the roster to the "local" room.
const localPeers = new Map(); // socketId -> { id, name }

function pushLocalRoster() {
  const roster = Array.from(localPeers.values());
  io.to("local").emit("localRoster", roster);
}

io.on("connection", (socket) => {
  console.log("[io] connected", socket.id);

  socket.on("enterLocal", (name) => {
    localPeers.set(socket.id, { id: socket.id, name: (name || "Peer") });
    socket.join("local");
    pushLocalRoster();
  });

  socket.on("leaveLocal", () => {
    socket.leave("local");
    localPeers.delete(socket.id);
    pushLocalRoster();
  });

  // -------- Unified signaling channel --------
  // Client emits: socket.emit("signal", { target, data }) where data is { sdp } or { candidate }
  socket.on("signal", ({ target, data }) => {
    if (!target || !data) return;
    io.to(target).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    // Cleanup from local roster
    if (localPeers.has(socket.id)) {
      localPeers.delete(socket.id);
      pushLocalRoster();
    }
    console.log("[io] disconnected", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[sendlike] signaling server on :${PORT}`);
});
