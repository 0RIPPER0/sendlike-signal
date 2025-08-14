// Signaling + group control (no file data). Host-only disband.
// Uses Socket.IO for easy signaling. WebRTC handles the actual file bytes P2P.

const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.get("/", (_, res) => res.send("SendLike signaling server running"));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

// Simple single-room model (code can be added later)
let users = [];            // [{id, name}]
let hostId = null;         // socket.id of host (first user)
let createdAt = null;
const TEN_MIN = 10 * 60 * 1000;

function roster() {
  return users.map(u => ({ id: u.id, name: u.name }));
}
function resetRoom(emitDisband = true) {
  if (emitDisband) io.emit("group-disbanded");
  users = [];
  hostId = null;
  createdAt = null;
}

function scheduleExpiry() {
  if (!createdAt) return;
  const left = createdAt + TEN_MIN - Date.now();
  if (left <= 0) return resetRoom(true);
  setTimeout(() => {
    if (createdAt && Date.now() >= createdAt + TEN_MIN) resetRoom(true);
  }, left + 50);
}

io.on("connection", (socket) => {
  // client calls "join-group" with { name }
  socket.on("join-group", ({ name }) => {
    if (!name || typeof name !== "string") return;
    users.push({ id: socket.id, name: name.trim() || "Anon" });

    // first user becomes host
    if (!hostId) {
      hostId = socket.id;
      createdAt = Date.now();
      scheduleExpiry();
      io.to(socket.id).emit("host-status", true);
    } else {
      io.to(socket.id).emit("host-status", false);
    }

    // let everyone see roster + expiry countdown
    io.emit("update-users", roster());
    io.emit("expires-at", createdAt ? createdAt + TEN_MIN : null);
  });

  // WebRTC signaling relay
  // sender -> server -> recipient
  socket.on("signal", ({ to, data }) => {
    if (!to || !data) return;
    io.to(to).emit("signal", { from: socket.id, data });
  });

  // Host disbands the group
  socket.on("disband-group", () => {
    if (socket.id !== hostId) {
      io.to(socket.id).emit("error-message", "Only the host can disband the group.");
      return;
    }
    resetRoom(true);
  });

  socket.on("disconnect", () => {
    const wasHost = socket.id === hostId;
    users = users.filter(u => u.id !== socket.id);

    if (wasHost) {
      // host left → disband
      resetRoom(true);
    } else {
      io.emit("update-users", roster());
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Signaling server on :" + PORT));
