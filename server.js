/* =========================================================
=  SendLike — Server (Express + Socket.IO)
=  Features:
=   • Online groups: 6-digit code, 10-min join window (default), disband only if host disbands/leaves
=   • Local discovery roster (same server): enterLocal/leaveLocal + roster broadcast
=   • Chat relay (per room)
=   • File transfer relay (meta/chunks/complete) with permissions:
=       - Online: host can toggle OpenShare; when OFF only host may send
=       - Local: anyone can send to anyone
=  NOTE: This uses Socket.IO relay (not WebRTC) for simplicity/compatibility
========================================================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, "public"))); // serve root (index.html, style.css, script.js)

/* -------------------------
   In-memory state
------------------------- */
const groups = {}; // code -> { hostId, createdAt, ttlMs, openShare, members:[{id,name}], timer }
const localPeers = new Map(); // socketId -> { name }

/* -------------------------
   Helpers
------------------------- */
function genCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
function disbandGroup(code, reason = "Group closed") {
  const g = groups[code];
  if (!g) return;
  io.to(code).emit("groupDisbanded", reason);
  clearTimeout(g.timer);
  delete groups[code];
  console.log("[Group] Disband", code, reason);
}
function startGroupTimer(code) {
  const g = groups[code];
  if (!g) return;
  clearTimeout(g.timer);
  if (g.ttlMs > 0) {
    g.timer = setTimeout(() => {
      // Only stop new joins; group persists for members.
      g.ttlMs = 0; // expired join window
      io.to(code).emit("joinClosed"); // Inform clients UI if needed
      console.log("[Group] Join window closed", code);
    }, g.ttlMs);
  }
}
function pushLocalRoster() {
  const roster = Array.from(localPeers.entries()).map(([id, o]) => ({ id, name: o.name }));
  io.to("local").emit("localRoster", roster);
}

/* -------------------------
   Socket handlers
------------------------- */
io.on("connection", (socket) => {

  /* ---- ONLINE GROUPS ---- */
  socket.on("createGroup", ({ name, ttlMinutes = 10 }, cb = () => {}) => {
    const code = genCode();
    const ttlMs = Math.max(0, (ttlMinutes || 10) * 60 * 1000);
    const createdAt = Date.now();
    groups[code] = {
      hostId: socket.id,
      createdAt,
      ttlMs,
      openShare: false, // default host-only send
      members: [{ id: socket.id, name: name || "Host" }],
      timer: null
    };
    socket.join(code);
    startGroupTimer(code);
    cb({ code, hostId: socket.id, openShare: false });
    io.to(code).emit("updateMembers", groups[code].members);
  });

  socket.on("joinGroup", ({ name, code }, cb = () => {}) => {
    const g = groups[code];
    if (!g) return cb({ error: "Group not found" });
    if (g.ttlMs > 0 && Date.now() > g.createdAt + g.ttlMs) {
      return cb({ error: "Join window closed" });
    }
    g.members.push({ id: socket.id, name: name || "Guest" });
    socket.join(code);
    io.to(code).emit("updateMembers", g.members);
    cb({ ok: true, hostId: g.hostId, openShare: g.openShare });
  });

  socket.on("disbandGroup", (code) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded");
  });

  socket.on("setOpenShare", ({ code, value }) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    g.openShare = !!value;
    io.to(code).emit("openShareState", g.openShare);
  });

  /* Chat relay (per room) */
  socket.on("chat", ({ room, name, text }) => {
    if (!room || !text) return;
    io.to(room).emit("chat", { id: socket.id, name, text, ts: Date.now() });
  });

  /* ---- LOCAL DISCOVERY ---- */
  socket.on("enterLocal", (name) => {
    localPeers.set(socket.id, { name: name || "Guest" });
    socket.join("local");
    pushLocalRoster();
  });
  socket.on("leaveLocal", () => {
    socket.leave("local");
    localPeers.delete(socket.id);
    pushLocalRoster();
  });

  /* ---- FILE RELAY ----
     Flow:
       sender -> server: fileMeta({targetId, room?, fileId, name, size, mime, chunkBytes})
       server -> target: fileMeta({fromId, ...})
       sender -> server: fileChunk({targetId, fileId, seq, chunk})   (chunk = ArrayBuffer)
       server -> target: fileChunk({fromId, fileId, seq, chunk})
       sender -> server: fileComplete({targetId, fileId})
       server -> target: fileComplete({fromId, fileId})
  -------------------------------- */
  socket.on("fileMeta", (p) => {
    const { targetId, room, fileId, name, size, mime, chunkBytes } = p || {};
    if (!targetId || !fileId || !name || !size) return;

    // Permission: if room present -> enforce openShare
    if (room && groups[room]) {
      const g = groups[room];
      const isHost = socket.id === g.hostId;
      if (!g.openShare && !isHost) {
        // Optional: allow members to send to host only
        if (targetId !== g.hostId) return; // drop silently
      }
    }
    io.to(targetId).emit("fileMeta", { fromId: socket.id, fileId, name, size, mime, chunkBytes });
  });

  socket.on("fileChunk", (p) => {
    const { targetId, fileId, seq, chunk } = p || {};
    if (!targetId || !fileId || typeof seq !== "number" || !chunk) return;
    io.to(targetId).emit("fileChunk", { fromId: socket.id, fileId, seq, chunk });
  });

  socket.on("fileComplete", (p) => {
    const { targetId, fileId } = p || {};
    if (!targetId || !fileId) return;
    io.to(targetId).emit("fileComplete", { fromId: socket.id, fileId });
  });

  /* ---- DISCONNECT CLEANUP ---- */
  socket.on("disconnect", () => {
    // local roster
    if (localPeers.has(socket.id)) { localPeers.delete(socket.id); pushLocalRoster(); }

    // groups
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
