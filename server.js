// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// serve static files (index.html, script.js, etc.)
app.use(express.static(__dirname + "/public"));

// --- roster state ---
let localRoom = {}; // socket.id -> {id,name}

function sendRoster() {
  io.emit("localRoster", Object.values(localRoom));
}

io.on("connection", (socket) => {
  console.log("Peer connected:", socket.id);

  // client joins local discovery
  socket.on("enterLocal", (name) => {
    localRoom[socket.id] = { id: socket.id, name: name || "Peer" };
    sendRoster();
  });

  socket.on("leaveLocal", () => {
    delete localRoom[socket.id];
    sendRoster();
  });

  // forward generic signaling messages
  socket.on("signal", ({ target, data }) => {
    io.to(target).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    console.log("Peer disconnected:", socket.id);
    delete localRoom[socket.id];
    sendRoster();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Signaling server running on port", PORT);
});
