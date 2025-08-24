/* =========================================================
=  SendLike — Signaling Server (Express + Socket.IO)
=  - Purpose: signaling only (SDP & ICE), roster, lightweight
=  - Does NOT relay file bytes (WebRTC DataChannels carry file data)
=  - Events supported:
=      client -> server:  announce, offer, answer, ice
=      server -> clients: roster, offer, answer, ice
=  - Simple in-memory state (ok for small deployments / demo)
========================================================= */

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

// Allow any origin (Railway). You may lock this down in production.
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 1e8 // increase if you accidentally send big payloads via signaling
});

// Serve static files from ./public (optional)
app.use(express.static(path.join(__dirname, "public")));

/* -------------------------
   In-memory roster
   Map socketId -> { id, name, announcedAt }
------------------------- */
const roster = new Map();

/* -------------------------
   Helpers
------------------------- */
function broadcastRoster() {
  const list = Array.from(roster.entries()).map(([id, obj]) => ({ id, name: obj.name }));
  io.emit("roster", list);
}

function safeName(name) {
  if (!name) return `Peer-${Math.floor(Math.random() * 10000)}`;
  return String(name).slice(0, 80);
}

/* -------------------------
   Socket handlers
------------------------- */
io.on("connection", (socket) => {
  console.log("[ws] connect", socket.id);

  // Client announces itself (name). We'll store and broadcast roster.
  socket.on("announce", (payload) => {
    try {
      const name = safeName(payload && payload.name);
      roster.set(socket.id, { name, announcedAt: Date.now() });
      console.log("[ws] announce", socket.id, name);
      broadcastRoster();
    } catch (err) {
      console.warn("[ws] announce err", err);
    }
  });

  // Relay an offer to a specific target
  // payload: { to, sdp } where 'to' is target socket id
  socket.on("offer", (payload) => {
    try {
      const to = payload && payload.to;
      const sdp = payload && payload.sdp;
      if (!to || !sdp) return;
      // send to target
      io.to(to).emit("offer", { from: socket.id, sdp });
      console.log(`[ws] offer ${socket.id} -> ${to}`);
    } catch (err) {
      console.warn("[ws] offer err", err);
    }
  });

  // Relay an answer back to offerer
  // payload: { to, sdp }
  socket.on("answer", (payload) => {
    try {
      const to = payload && payload.to;
      const sdp = payload && payload.sdp;
      if (!to || !sdp) return;
      io.to(to).emit("answer", { from: socket.id, sdp });
      console.log(`[ws] answer ${socket.id} -> ${to}`);
    } catch (err) {
      console.warn("[ws] answer err", err);
    }
  });

  // Relay ICE candidates
  // payload: { to, candidate }
  socket.on("ice", (payload) => {
    try {
      const to = payload && payload.to;
      const candidate = payload && payload.candidate;
      if (!to || !candidate) return;
      io.to(to).emit("ice", { from: socket.id, candidate });
      // don't log too heavily for ice floods
    } catch (err) {
      console.warn("[ws] ice err", err);
    }
  });

  // Optional: allow client request for roster
  socket.on("getRoster", () => {
    const list = Array.from(roster.entries()).map(([id, obj]) => ({ id, name: obj.name }));
    socket.emit("roster", list);
  });

  // Clean disconnect
  socket.on("disconnect", (reason) => {
    console.log("[ws] disconnect", socket.id, reason);
    if (roster.has(socket.id)) {
      roster.delete(socket.id);
      broadcastRoster();
    }
  });

  // Safety: if a client hasn't announced after some time, we keep them but they will be displayed with generated name.
  // If you want to force an announce, implement that here.
});

/* -------------------------
   Simple HTTP endpoints for health / debug
------------------------- */
app.get("/health", (req, res) => res.json({ ok: true, time: Date.now(), peers: roster.size }));

/* -------------------------
   Start
------------------------- */
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[SendLike Signaling] Listening on port ${PORT}`);
});
