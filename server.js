const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let users = {}; // socket.id -> username

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Join group
  socket.on("join", (username) => {
    users[socket.id] = username;
    console.log(username, "joined");
    io.emit("updateUsers", Object.values(users));
  });

  // Send file to all
  socket.on("fileToAll", ({ fileName, data }) => {
    socket.broadcast.emit("receiveFile", { from: users[socket.id], fileName, data });
  });

  // Send file to specific user
  socket.on("fileToUser", ({ to, fileName, data }) => {
    const targetSocket = Object.keys(users).find(id => users[id] === to);
    if (targetSocket) {
      io.to(targetSocket).emit("receiveFile", { from: users[socket.id], fileName, data });
    }
  });

  // Disband group (host only for now — no check)
  socket.on("disband", () => {
    io.emit("disbanded");
    users = {};
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete users[socket.id];
    io.emit("updateUsers", Object.values(users));
  });
});

app.get("/", (req, res) => {
  res.send("SendLike backend running");
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
