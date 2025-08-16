
/* =========================================================
=  SendLike — Server (Express + Socket.IO)
=  This server is *not* used for payload in Direct P2P mode.
=  It only serves static files and (optionally) signaling.
========================================================= */
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// Minimal in-memory room state for optional roster/chat (no file relays used in P2P mode)
const groups = {};
function code6(){ return Math.floor(100000+Math.random()*900000).toString(); }

io.on('connection', (socket) => {
  socket.on('createGroup', ({ name, ttlMinutes=10 }, cb=()=>{}) => {
    const code = code6();
    groups[code] = { hostId: socket.id, members: [{id:socket.id,name:name||'Host'}], openShare:false, createdAt:Date.now(), ttl:ttlMinutes*60*1000 };
    socket.join(code);
    cb({ code, hostId: socket.id, openShare:false });
    io.to(code).emit('updateMembers', groups[code].members);
  });
  socket.on('joinGroup', ({ name, code }, cb=()=>{}) => {
    const g = groups[code]; if(!g) return cb({error:'Group not found'});
    g.members.push({id:socket.id,name:name||'Guest'});
    socket.join(code);
    cb({ ok:true, hostId:g.hostId, openShare:g.openShare });
    io.to(code).emit('updateMembers', g.members);
  });
  socket.on('disbandGroup', (code) => {
    const g = groups[code]; if(!g || g.hostId!==socket.id) return;
    io.to(code).emit('groupDisbanded','Host disbanded');
    delete groups[code];
  });
  socket.on('setOpenShare', ({ code, value }) => {
    const g = groups[code]; if(!g || g.hostId!==socket.id) return;
    g.openShare = !!value; io.to(code).emit('openShareState', g.openShare);
  });
  socket.on('chat', ({ room, name, text }) => {
    if (!room || !text) return;
    io.to(room).emit('chat', { id: socket.id, name, text, ts: Date.now() });
  });

  // Optional: signaling helpers (not required if using manual paste)
  socket.on('rtc-offer', ({ room, to, offer }) => {
    if (to) io.to(to).emit('rtc-offer', { from: socket.id, offer });
    else if (room) socket.to(room).emit('rtc-offer', { from: socket.id, offer });
  });
  socket.on('rtc-answer', ({ to, answer }) => {
    if (to) io.to(to).emit('rtc-answer', { from: socket.id, answer });
  });
  socket.on('rtc-ice', ({ to, cand }) => {
    if (to) io.to(to).emit('rtc-ice', { from: socket.id, cand });
  });

  socket.on('disconnect', () => {
    Object.keys(groups).forEach(code => {
      const g = groups[code]; if(!g) return;
      const i = g.members.findIndex(m=>m.id===socket.id);
      if (i!==-1) {
        const wasHost = g.hostId===socket.id;
        g.members.splice(i,1);
        if (wasHost) { io.to(code).emit('groupDisbanded','Host left'); delete groups[code]; }
        else io.to(code).emit('updateMembers', g.members);
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('[SendLike] listening on', PORT));
