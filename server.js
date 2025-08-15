/**
 * ===============================================
 *  SendLike — Server (Express + Socket.IO)
 *  - 6-digit groups
 *  - 10 min join window (group lives on)
 *  - Member roster + chat broadcast
 *  - OpenShare toggle (host-only)
 *  - Disband on host command or host disconnect
 * ===============================================
 */
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Serve static from /public (very important)
app.use(express.static(path.join(__dirname, "public")));

const JOIN_WINDOW_MIN = 10; // default join window

/** groups[code] shape:
 * {
 *   hostId, createdAt, ttlMs, joinOpenUntil,
 *   openShare: boolean,
 *   members: [{id,name}],
 *   chat: [{name,text,ts}],
 *   timer: NodeJS.Timeout | null
 * }
 */
const groups = Object.create(null);

// ---------- helpers ----------
const genCode = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

function disbandGroup(code, reason = "Group closed") {
  const g = groups[code];
  if (!g) return;
  io.to(code).emit("groupDisbanded", reason);
  if (g.timer) clearTimeout(g.timer);
  delete groups[code];
  console.log(`[Group] Disband ${code} — ${reason}`);
}

// only closes joining, does NOT disband
function startJoinTimer(code) {
  const g = groups[code];
  if (!g) return;
  if (g.timer) clearTimeout(g.timer);
  if (g.ttlMs > 0) {
    g.timer = setTimeout(() => {
      // join window closed; keep the group alive
      io.to(code).emit("joinWindowClosed");
      console.log(`[Group] Join window closed for ${code}`);
    }, g.ttlMs);
  }
}

// ---------- sockets ----------
io.on("connection", (socket) => {
  // ========== CREATE GROUP ==========
  socket.on("createGroup", ({ name = "Host" }, cb = () => {}) => {
    const code = genCode();
    const createdAt = Date.now();
    const ttlMs = JOIN_WINDOW_MIN * 60 * 1000;

    groups[code] = {
      hostId: socket.id,
      createdAt,
      ttlMs,
      joinOpenUntil: createdAt + ttlMs,
      openShare: false,
      members: [{ id: socket.id, name }],
      chat: [],
      timer: null,
    };

    socket.join(code);
    startJoinTimer(code);

    cb({
      ok: true,
      code,
      hostId: socket.id,
      joinOpenUntil: groups[code].joinOpenUntil,
      openShare: groups[code].openShare,
      members: groups[code].members,
      chat: groups[code].chat,
    });

    io.to(code).emit("updateMembers", groups[code].members);
    console.log(`[Group] Create ${code} by ${socket.id}`);
  });

  // ========== JOIN GROUP ==========
  socket.on("joinGroup", ({ name = "Guest", code }, cb = () => {}) => {
    const g = groups[code];
    if (!g) return cb({ error: "Group not found." });

    // check join window
    if (Date.now() > g.joinOpenUntil) {
      return cb({ error: "Join window closed." });
    }

    // add member + broadcast
    g.members.push({ id: socket.id, name });
    socket.join(code);

    cb({
      ok: true,
      hostId: g.hostId,
      members: g.members,
      chat: g.chat, // give existing chat history
      joinOpenUntil: g.joinOpenUntil,
      openShare: g.openShare,
    });

    io.to(code).emit("updateMembers", g.members);
    console.log(`[Group] ${socket.id} joined ${code} as ${name}`);
  });

  // ========== CHAT ==========
  socket.on("chat", ({ room, name, text }) => {
    if (!room || !text) return;
    const g = groups[room];
    if (!g) return;

    const msg = { name, text, ts: Date.now() };
    g.chat.push(msg);
    // keep last 100
    if (g.chat.length > 100) g.chat.shift();

    // echo to everyone including sender
    io.to(room).emit("chat", msg);
  });

  // ========== HOST: OpenShare toggle ==========
  socket.on("toggleOpenShare", ({ code, value }) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    g.openShare = !!value;
    io.to(code).emit("openShareUpdated", g.openShare);
  });

  // ========== HOST: Disband ==========
  socket.on("disbandGroup", (code) => {
    const g = groups[code];
    if (!g || g.hostId !== socket.id) return;
    disbandGroup(code, "Host disbanded");
  });

  // ========== Disconnect cleanup ==========
  socket.on("disconnect", () => {
    for (const code of Object.keys(groups)) {
      const g = groups[code];
      if (!g) continue;
      const idx = g.members.findIndex((m) => m.id === socket.id);
      if (idx !== -1) {
        const wasHost = g.hostId === socket.id;
        g.members.splice(idx, 1);
        if (wasHost) {
          disbandGroup(code, "Host left");
        } else {
          io.to(code).emit("updateMembers", g.members);
        }
      }
    }
  });
});

// ---------- start ----------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SendLike] listening on http://localhost:${PORT}`);
});
