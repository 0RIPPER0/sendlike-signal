// server.js
// Minimal signaling server + local roster (no media relay)
// Run: npm i express socket.io && node server.js

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// (optional) serve a public folder to host client code
app.use(express.static(path.join(__dirname, "public")));

const localPeers = new Map(); // socketId -> { name }

function pushLocalRoster() {
  const roster = Array.from(localPeers.entries()).map(([id, v]) => ({ id, name: v.name }));
  io.to("local").emit("localRoster", roster);
}

io.on("connection", (socket) => {
  // ---- Local discovery (same server/WiFi) ----
  socket.on("enterLocal", (name = "Guest") => {
    localPeers.set(socket.id, { name });
    socket.join("local");
    pushLocalRoster();
  });

  socket.on("leaveLocal", () => {
    socket.leave("local");
    localPeers.delete(socket.id);
    pushLocalRoster();
  });

  // ---- Raw signaling (offer/answer/ice) ----
  socket.on("signal-offer", ({ to, offer, fromName }) => {
    if (!to || !offer) return;
    io.to(to).emit("signal-offer", { from: socket.id, offer, fromName });
  });

  socket.on("signal-answer", ({ to, answer }) => {
    if (!to || !answer) return;
    io.to(to).emit("signal-answer", { from: socket.id, answer });
  });

  socket.on("signal-ice", ({ to, candidate }) => {
    if (!to || !candidate) return;
    io.to(to).emit("signal-ice", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    if (localPeers.has(socket.id)) {
      localPeers.delete(socket.id);
      pushLocalRoster();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("[Signaling] listening on", PORT));
