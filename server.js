/* =========================================================
   SendLike — Minimal Signaling Server (Socket.IO)
   - Pure signaling only (SDP + ICE). File bytes never pass server.
   - Serves files from ./public
   ========================================================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;

// serve client from public/
app.use(express.static(path.join(__dirname, "public")));

// in-memory roster: socketId -> { id, name }
const roster = new Map();

function broadcastRoster(){
  const list = Array.from(roster.values()).map(x => ({ id: x.id, name: x.name }));
  io.emit("roster", list);
}

io.on("connection", (socket) => {
  console.log("socket connected", socket.id);

  socket.on("announce", ({ name }) => {
    roster.set(socket.id, { id: socket.id, name: name || ("Peer"+Math.floor(Math.random()*9999)) });
    broadcastRoster();
  });

  socket.on("disconnect", () => {
    roster.delete(socket.id);
    broadcastRoster();
    console.log("socket disconnected", socket.id);
  });

  // Signaling messages: forward to target
  socket.on("offer", ({ to, sdp }) => { io.to(to).emit("offer", { from: socket.id, sdp }); });
  socket.on("answer", ({ to, sdp }) => { io.to(to).emit("answer", { from: socket.id, sdp }); });
  socket.on("ice", ({ to, candidate }) => { io.to(to).emit("ice", { from: socket.id, candidate }); });
});

server.listen(PORT, () => console.log("Signaling server listening on", PORT));
