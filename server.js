// server.js
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

// --- socket.io signaling ---
let roster = {}; // socket.id -> {id, name}

// helper to broadcast full roster
function sendRoster() {
  io.emit("roster", Object.values(roster));
}

io.on("connection", (socket) => {
  console.log("Peer connected:", socket.id);

  // give placeholder until announce
  roster[socket.id] = { id: socket.id, name: "Anon" };
  sendRoster();

  // client announces itself with a random name
  socket.on("announce", (data) => {
    roster[socket.id] = { id: socket.id, name: data.name || "Peer" };
    sendRoster();
  });

  // forward SDP offers/answers
  socket.on("offer", ({ to, sdp }) => {
    io.to(to).emit("offer", { from: socket.id, sdp });
  });

  socket.on("answer", ({ to, sdp }) => {
    io.to(to).emit("answer", { from: socket.id, sdp });
  });

  // forward ICE candidates
  socket.on("ice", ({ to, candidate }) => {
    io.to(to).emit("ice", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    console.log("Peer disconnected:", socket.id);
    delete roster[socket.id];
    sendRoster();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Signaling server running on port", PORT);
});
