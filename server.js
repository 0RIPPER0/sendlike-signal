
// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

let groups = {}; // { code: { hostId, members: [{id,name}], files: [] } }

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('create_group', (hostName, callback) => {
    let code = generateCode();
    groups[code] = { hostId: socket.id, members: [{ id: socket.id, name: hostName }], files: [] };
    socket.join(code);
    callback({ code });
    io.to(socket.id).emit('members_update', groups[code].members);
  });

  socket.on('join_group', ({ code, name }, callback) => {
    if (!groups[code]) {
      callback({ error: 'Group not found' });
      return;
    }
    groups[code].members.push({ id: socket.id, name });
    socket.join(code);
    callback({ success: true });
    io.to(groups[code].hostId).emit('members_update', groups[code].members);
  });

  socket.on('send_file', ({ code, fileName, fileBuffer }) => {
    if (!groups[code]) return;
    socket.to(code).emit('receive_file', { fileName, fileBuffer });
  });

  socket.on('disconnect', () => {
    for (let code in groups) {
      let group = groups[code];
      group.members = group.members.filter(m => m.id !== socket.id);
      if (socket.id === group.hostId) {
        io.to(code).emit('group_disbanded');
        delete groups[code];
      } else {
        io.to(group.hostId).emit('members_update', group.members);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
