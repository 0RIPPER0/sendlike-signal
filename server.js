// SendLike — Server (Express + Socket.IO)
// Features: 6-digit groups, disband, local roster for same Wi-Fi, simple chat relay.
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

let groups = {};              // code -> { hostId, createdAt, ttlMs, members:[{id,name}], timer }
let localPeers = new Map();   // socketId -> { name }

function genCode(){ return Math.floor(100000 + Math.random() * 900000).toString(); }

function disbandGroup(code, reason="Group closed"){
  const g = groups[code];
  if (!g) return;
  io.to(code).emit("groupDisbanded", reason);
  clearTimeout(g.timer);
  delete groups[code];
  console.log("[Group] Disband", code, reason);
}

function startGroupTimer(code){
  const g = groups[code];
  if (!g) return;
  clearTimeout(g.timer);
  if (g.ttlMs > 0) g.timer = setTimeout(() => disbandGroup(code, "Time limit reached"), g.ttlMs);
}

function pushLocalRoster(){
  const roster = Array.from(localPeers.entries()).map(([id, o]) => ({ id, name: o.name }));
  io.to("local").emit("localRoster", roster);
}

io.on("connection", (socket) => {
  // ---- Online (code) ----
  socket.on("createGroup", ({ name, ttlMinutes = 10 }, cb = ()=>{}) => {
    const code = genCode();
    const ttlMs = ttlMinutes === 0 ? 0 : Math.max(0, (ttlMinutes||10) * 60 * 1000);
    const createdAt = Date.now();
    groups[code] = { hostId: socket.id, createdAt, ttlMs, members: [{ id: socket.id, name }], timer: null };
    socket.join(code);
    startGroupTimer(code);
    cb({ code, expiresAt: ttlMs ? createdAt + ttlMs : 0, hostId: socket.id });
    io.to(code).emit("updateMembers", groups[code].members);
  });

  socket.on("joinGroup", ({ name, code }, cb = ()=>{}) => {
    const g = groups[code];
    if (!g) return cb({ error: "Group not found" });
    g.members.push({ id: socket.id, name });
    socket.join(code);
    io.to(code).emit("updateMembers", g.members);
    cb({ ok: true, expiresAt: g.ttlMs ? g.createdAt + g.ttlMs : 0, hostId: g.hostId });
  });

  socket.on("disbandGroup", (code) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded");
  });

  // Group chat relay
  socket.on("chat", ({ room, name, text }) => {
    if (!room || !text) return;
    io.to(room).emit("chat", { id: socket.id, name, text, ts: Date.now() });
  });

  // ---- Local (same Wi-Fi discovery) ----
  socket.on("enterLocal", (name) => {
    localPeers.set(socket.id, { name });
    socket.join("local");
    pushLocalRoster();
  });
  socket.on("leaveLocal", () => {
    socket.leave("local");
    localPeers.delete(socket.id);
    pushLocalRoster();
  });

  // ---- WebRTC signaling ----
  socket.on("signal", ({ targetId, data }) => {
    io.to(targetId).emit("signal", { from: socket.id, data });
  });

  // Cleanup
  socket.on("disconnect", () => {
    if (localPeers.has(socket.id)) { localPeers.delete(socket.id); pushLocalRoster(); }
    Object.keys(groups).forEach(code => {
      const g = groups[code];
      if (!g) return;
      const idx = g.members.findIndex(m => m.id === socket.id);
      if (idx !== -1) {
        const wasHost = g.hostId === socket.id;
        g.members.splice(idx, 1);
        if (wasHost) disbandGroup(code, "Host left");
        else io.to(code).emit("updateMembers", g.members);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("[SendLike] Listening on", PORT));
