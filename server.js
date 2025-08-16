
/* =========================================================
=  SendLike — Server (Express + Socket.IO)
=  Features:
=   • Online groups: 6-digit code, 10-min join window (default)
=   • Local discovery roster (same server): enterLocal/leaveLocal + roster broadcast
=   • Chat relay (per room)
=   • File transfer relay (meta/chunks/complete) with permissions:
=       - Online: host can toggle OpenShare; when OFF only host may send
=       - Local: anyone can send to anyone
=   • WebRTC signaling for true P2P (offer/answer/ice). Server sees no file data.
========================================================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Static files
app.use(express.static(path.join(__dirname, "public")));

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
      g.ttlMs = 0; // expired join window; room stays for members
      io.to(code).emit("joinClosed");
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
  // Whoami helper for client
  socket.emit("whoami", { id: socket.id });

  /* ---- ONLINE GROUPS ---- */
  socket.on("createGroup", ({ name, ttlMinutes = 10 }, cb = () => {}) => {
    const code = genCode();
    const ttlMs = Math.max(0, (ttlMinutes || 10) * 60 * 1000);
    const createdAt = Date.now();
    groups[code] = {
      hostId: socket.id,
      createdAt,
      ttlMs,
      openShare: false,
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

  /* ---- WebRTC Signaling (Online mode only) ---- */
  // Offer from A -> to B
  socket.on("webrtc-offer", ({ to, offer, room }) => {
    if (!to || !offer) return;
    io.to(to).emit("webrtc-offer", { from: socket.id, offer, room });
  });
  // Answer from B -> to A
  socket.on("webrtc-answer", ({ to, answer, room }) => {
    if (!to || !answer) return;
    io.to(to).emit("webrtc-answer", { from: socket.id, answer, room });
  });
  // ICE candidate
  socket.on("webrtc-ice", ({ to, candidate, room }) => {
    if (!to || !candidate) return;
    io.to(to).emit("webrtc-ice", { from: socket.id, candidate, room });
  });

  /* ---- FILE RELAY (fallback + local) ---- */
  socket.on("fileMeta", (p, ack = () => {}) => {
    const { targetId, room, fileId, name, size, mime, chunkBytes } = p || {};
    if (!targetId || !fileId || !name || !size) return ack({ ok:false });
    if (room && groups[room]) {
      const g = groups[room];
      const isHost = socket.id === g.hostId;
      if (!g.openShare && !isHost) {
        if (targetId !== g.hostId) return ack({ ok:false });
      }
    }
    io.to(targetId).emit("fileMeta", { fromId: socket.id, fileId, name, size, mime, chunkBytes });
    ack({ ok:true });
  });

  socket.on("fileChunk", (p, ack = () => {}) => {
    const { targetId, fileId, seq, chunk } = p || {};
    if (!targetId || !fileId || typeof seq !== "number" || !chunk) return ack({ ok:false });
    io.to(targetId).emit("fileChunk", { fromId: socket.id, fileId, seq, chunk });
    ack({ ok:true });
  });

  socket.on("fileComplete", (p, ack = () => {}) => {
    const { targetId, fileId } = p || {};
    if (!targetId || !fileId) return ack({ ok:false });
    io.to(targetId).emit("fileComplete", { fromId: socket.id, fileId });
    ack({ ok:true });
  });

  /* ---- DISCONNECT CLEANUP ---- */
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
