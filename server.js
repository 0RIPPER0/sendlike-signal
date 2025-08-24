const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

const peers = new Map(); // id -> { id, name }

io.on("connection", socket => {
  console.log("Peer connected:", socket.id);

  // Peer joins with random name
  socket.on("join", name => {
    peers.set(socket.id, { id: socket.id, name });
    pushRoster();
  });

  // Relay WebRTC signaling messages
  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    peers.delete(socket.id);
    pushRoster();
    console.log("Peer disconnected:", socket.id);
  });

  function pushRoster() {
    const list = Array.from(peers.values());
    io.emit("roster", list);
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("[P2P] Signaling server on", PORT));
