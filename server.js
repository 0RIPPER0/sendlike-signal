import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

let rooms = {};

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.type === 'join') {
        ws.room = data.room;
        if (!rooms[ws.room]) rooms[ws.room] = [];
        rooms[ws.room].push(ws);
        console.log(`Client joined room: ${ws.room}`);
      }

      // Relay messages within the room
      if (ws.room && rooms[ws.room]) {
        rooms[ws.room].forEach(client => {
          if (client !== ws && client.readyState === client.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
      }

    } catch (err) {
      console.error('Error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room] = rooms[ws.room].filter(c => c !== ws);
      if (rooms[ws.room].length === 0) delete rooms[ws.room];
    }
  });
});

server.listen(process.env.PORT || 3000, () => {
  console.log(`Signaling server running on port ${process.env.PORT || 3000}`);
});
