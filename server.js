// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// ✅ CORS: allow your web app to connect over WSS from your Railway domain
const io = new Server(server, {
  cors: {
    origin: "*",            // you can tighten this to your Railway URL later
    methods: ["GET", "POST"]
  }
});

// serve static client
app.use(express.static(path.join(__dirname, "public")));

const peers = new Map(); // id -> { id, name }

io.on("connection", socket => {
  console.log("Peer connected:", socket.id);

  socket.on("join", name => {
    peers.set(socket.id, { id: socket.id, name });
    pushRoster();
  });

  // WebRTC signaling relay
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
