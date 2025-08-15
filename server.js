// ================================
//  SENDLIKE — SERVER
//  Express + Socket.IO
// ================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ================================
//  STATIC FILES
// ================================
app.use(express.static(path.join(__dirname, "public")));

// ================================
//  IN-MEMORY GROUP STORE
// ================================
const JOIN_CUTOFF_MS = 10 * 60 * 1000; // 10 min join window
const groups = Object.create(null);     // { [code]: { hostId, createdAt, openShare, members:[] } }

function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Funny name pool (server-side)
const ADJ = ["Swift","Happy","Brave","Cosmic","Fuzzy","Mighty","Quiet","Zippy","Bubbly","Chill"];
const NOUN = ["Panda","Falcon","Otter","Phoenix","Badger","Koala","Eagle","Tiger","Llama","Whale"];
function funnyName() {
  return `${ADJ[Math.floor(Math.random()*ADJ.length)]} ${NOUN[Math.floor(Math.random()*NOUN.length)]}`;
}

// ================================
//  HELPERS
// ================================
function disbandGroup(code, reason = "Group closed") {
  const g = groups[code];
  if (!g) return;
  io.to(code).emit("groupDisbanded", reason);
  delete groups[code];
}

// ================================
//  SOCKET.IO
// ================================
io.on("connection", (socket) => {

  // ================================
  //  CREATE GROUP
  // ================================
  socket.on("createGroup", ({ name }, cb = () => {}) => {
    try {
      const code = genCode();
      const personName = (name || "").trim() || funnyName();
      const createdAt = Date.now();

      groups[code] = {
        hostId: socket.id,
        createdAt,
        openShare: false,
        members: [{ id: socket.id, name: personName }],
      };

      socket.join(code);

      cb({
        ok: true,
        code,
      hostId: socket.id,
        openShare: false,
        joinClosesAt: createdAt + JOIN_CUTOFF_MS,
      });

      io.to(code).emit("updateMembers", groups[code].members);
    } catch (err) {
      cb({ ok: false, error: "Failed to create group" });
    }
  });

  // ================================
  //  JOIN GROUP
  // ================================
  socket.on("joinGroup", ({ name, code }, cb = () => {}) => {
    try {
      const g = groups[code];
      if (!g) return cb({ ok: false, error: "Group not found" });

      const now = Date.now();
      if (now > g.createdAt + JOIN_CUTOFF_MS) {
        return cb({ ok: false, error: "Join window closed (10 min limit)" });
      }

      const personName = (name || "").trim() || funnyName();
      g.members.push({ id: socket.id, name: personName });

      socket.join(code);
      io.to(code).emit("updateMembers", g.members);

      cb({
        ok: true,
        hostId: g.hostId,
        openShare: g.openShare,
        joinClosesAt: g.createdAt + JOIN_CUTOFF_MS,
      });
    } catch (err) {
      cb({ ok: false, error: "Failed to join group" });
    }
  });

  // ================================
  //  DISBAND GROUP (HOST ONLY)
// ================================
  socket.on("disbandGroup", ({ code }) => {
    const g = groups[code];
    if (!g) return;
    if (g.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded the group");
  });

  // ================================
  //  OPENSHARE TOGGLE (HOST ONLY)
  // ================================
  socket.on("toggleOpenShare", ({ code, value }) => {
    const g = groups[code];
    if (!g) return;
    if (g.hostId !== socket.id) return;
    g.openShare = !!value;
    io.to(code).emit("openShare", g.openShare);
  });

  // ================================
  //  GROUP CHAT RELAY
  // ================================
  socket.on("chat", ({ room, name, text }) => {
    if (!room || !text) return;
    io.to(room).emit("chat", { id: socket.id, name: name || "Anonymous", text, ts: Date.now() });
  });

  // ================================
  //  DISCONNECT CLEANUP
  // ================================
  socket.on("disconnect", () => {
    for (const code of Object.keys(groups)) {
      const g = groups[code];
      if (!g) continue;

      const idx = g.members.findIndex(m => m.id === socket.id);
      if (idx !== -1) {
        const wasHost = g.hostId === socket.id;
        g.members.splice(idx, 1);
        if (wasHost) disbandGroup(code, "Host left");
        else io.to(code).emit("updateMembers", g.members);
      }
    }
  });
});

// ================================
//  START SERVER
// ================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SendLike] http://localhost:${PORT}`);
});
