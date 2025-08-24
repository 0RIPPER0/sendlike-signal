/* public/client.js
   Auto: join same-WiFi roster with random nickname
   Pure P2P file transfer via WebRTC DataChannel
*/

(function () {
  const KB = 1024, MB = KB * KB;

  // ---- random nickname ----
  function rndName() {
    const adj = ["Brave","Chill","Turbo","Mellow","Pixel","Zippy","Witty","Cosmic","Sassy","Fuzzy"];
    const ani = ["Otter","Falcon","Fox","Panda","Moose","Gecko","Yak","Dolphin","Tiger","Koala"];
    return adj[Math.floor(Math.random()*adj.length)] + ani[Math.floor(Math.random()*ani.length)];
  }

  function createEmitter() {
    const listeners = new Map();
    return {
      on(evt, cb) {
        if (!listeners.has(evt)) listeners.set(evt, new Set());
        listeners.get(evt).add(cb);
      },
      emit(evt, data) {
        listeners.get(evt)?.forEach(cb => cb(data));
      }
    };
  }

  function createP2PClient({ signalingURL, stun = ['stun:stun.l.google.com:19302'] } = {}) {
    const socket = io(signalingURL || undefined, { transports: ['websocket'] });
    const appEmitter = createEmitter();
    const myName = rndName();

    // auto enter local mode on connect
    socket.on('connect', () => socket.emit('enterLocal', myName));

    // roster updates
    socket.on('localRoster', roster => appEmitter.emit('roster', roster));

    const peers = new Map();

    function createRTCPeer(peerId, isCaller) {
      const pc = new RTCPeerConnection({ iceServers: [{ urls: stun }] });
      let dc;
      const conn = createEmitter();

      if (isCaller) {
        dc = pc.createDataChannel('data', { ordered: true });
        setupDC(dc);
      } else {
        pc.ondatachannel = (ev) => setupDC(ev.channel);
      }

      function setupDC(channel) {
        dc = channel;
        dc.bufferedAmountLowThreshold = 1 * MB;
        dc.onopen = () => conn.emit('open');
        dc.onclose = () => conn.emit('close');
        dc.onmessage = (ev) => handleMessage(ev.data);
      }

      // incoming stream state
      let recv = null;
      async function handleMessage(data) {
        if (typeof data === 'string') {
          const msg = JSON.parse(data);
          if (msg.type === 'meta') {
            recv = await createReceiveStream(msg.name, msg.size);
            conn.emit('recv-meta', msg);
          } else if (msg.type === 'eof') {
            await recv.writer.close();
            conn.emit('recv-complete', { name: recv.name, size: recv.size });
            recv = null;
          }
          return;
        }
        if (data instanceof ArrayBuffer) {
          if (!recv) return;
          await recv.writer.write(new Uint8Array(data));
          recv.received += data.byteLength;
          conn.emit('recv-progress', {
            received: recv.received, total: recv.size,
            percent: ((recv.received/recv.size)*100).toFixed(2)
          });
        }
      }

      conn.sendFile = async function(file, { chunkSize = 1*MB } = {}) {
        dc.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size }));
        let offset = 0;
        while (offset < file.size) {
          const end = Math.min(offset + chunkSize, file.size);
          const buf = await file.slice(offset, end).arrayBuffer();
          await waitBuffered(dc, 16*MB, 1*MB);
          dc.send(buf);
          offset = end;
          conn.emit('send-progress', { sent: offset, total: file.size, percent: ((offset/file.size)*100).toFixed(2) });
        }
        dc.send(JSON.stringify({ type: 'eof' }));
        conn.emit('send-complete', { name: file.name, size: file.size });
      };

      pc.onicecandidate = e => { if (e.candidate) socket.emit('signal-ice', { to: peerId, candidate: e.candidate }); };
      peers.set(peerId, { pc, conn });
      return { pc, conn };
    }

    async function waitBuffered(dc, high, low) {
      if (dc.bufferedAmount < high) return;
      await new Promise(res => {
        const fn = () => { if (dc.bufferedAmount <= low) { dc.removeEventListener('bufferedamountlow', fn); res(); } };
        dc.addEventListener('bufferedamountlow', fn);
      });
    }

    async function createReceiveStream(name, size) {
      if (window.showSaveFilePicker) {
        const handle = await showSaveFilePicker({ suggestedName: name });
        const stream = await handle.createWritable();
        return { name, size, received: 0, writer: { write: c => stream.write(new Blob([c])), close: () => stream.close() } };
      }
      const fileStream = streamSaver.createWriteStream(name, { size });
      const writer = fileStream.getWriter();
      return { name, size, received: 0, writer };
    }

    // signaling
    socket.on('signal-offer', async ({ from, offer }) => {
      const { pc, conn } = createRTCPeer(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal-answer', { to: from, answer });
    });
    socket.on('signal-answer', async ({ from, answer }) => {
      const peer = peers.get(from);
      if (peer) await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
    });
    socket.on('signal-ice', async ({ from, candidate }) => {
      const peer = peers.get(from);
      if (peer) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
    });

    return {
      myName,
      onRoster: cb => appEmitter.on('roster', cb),
      connect: async peerId => {
        const { pc, conn } = createRTCPeer(peerId, true);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal-offer', { to: peerId, offer });
        return conn;
      }
    };
  }

  window.createP2PClient = createP2PClient;
})();
