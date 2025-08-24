const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

// serve static files (index.html, script.js, style.css, etc.)
app.use(express.static(__dirname + "/public"));

let roster = {}; // socket.id -> {id, name}

io.on("connection", (socket) => {
  console.log("Peer connected:", socket.id);

  // announce peer
  socket.on("announce", (data) => {
    roster[socket.id] = { id: socket.id, name: data.name || "Peer" };
    io.emit("roster", Object.values(roster));
  });

  // unified signaling channel
  socket.on("signal", ({ target, data }) => {
    io.to(target).emit("signal", { from: socket.id, data });
  });

  // cleanup
  socket.on("disconnect", () => {
    console.log("Peer disconnected:", socket.id);
    delete roster[socket.id];
    io.emit("roster", Object.values(roster));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Signaling server running on port", PORT);
});
