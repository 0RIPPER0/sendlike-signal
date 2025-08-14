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
  },
  maxHttpBufferSize: 1e8 // ~100MB per transfer
});

let users = [];
let hostId = null;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("join-group", (username) => {
    users.push({ id: socket.id, name: username });

    // Assign host if none exists
    if (!hostId) hostId = socket.id;

    // Tell this user if they are host
    socket.emit("host-status", socket.id === hostId);

    // Update user list for everyone
    io.emit("update-users", users);
  });

  socket.on("send-file", (fileData) => {
    if (fileData.target) {
      // Send to specific user
      io.to(fileData.target).emit("receive-file", {
        name: fileData.name,
        size: fileData.size,
        type: fileData.type,
        data: fileData.data
      });
    } else {
      // Broadcast to all except sender
      socket.broadcast.emit("receive-file", {
        name: fileData.name,
        size: fileData.size,
        type: fileData.type,
        data: fileData.data
      });
    }
  });

  socket.on("disband-group", () => {
    if (socket.id === hostId) {
      io.emit("group-disbanded");
      users = [];
      hostId = null;
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    users = users.filter(u => u.id !== socket.id);

    // If host leaves without disbanding, assign new host
    if (socket.id === hostId) {
      if (users.length > 0) {
        hostId = users[0].id;
        io.to(hostId).emit("host-status", true);
      } else {
        hostId = null;
      }
    }

    io.emit("update-users", users);
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running...");
});
