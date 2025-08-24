/* public/client.js
   Minimal no-UI P2P file transfer via WebRTC.
   Requires:
     <script src="/socket.io/socket.io.js"></script>
     <script src="https://unpkg.com/streamsaver@2.0.6/StreamSaver.min.js"></script>
   Then load this file.

   Usage example (in your page/app code):
     const p2p = createP2PClient({ signalingURL: location.origin, stun: ['stun:stun.l.google.com:19302'] });

     p2p.onRoster(roster => console.log('Roster:', roster));
     p2p.enterLocal('Alice');

     // Connect to a peerId you see in roster:
     const conn = await p2p.connect(peerId);
     // Send a File object (from <input type="file">):
     await conn.sendFile(file, { chunkSize: 1 * 1024 * 1024 });

     // Receive automatically prompts save; subscribe to progress:
     conn.on('recv-progress', p => console.log('recv %', p.percent));
     conn.on('send-progress', p => console.log('send %', p.percent));
*/

(function () {
  const KB = 1024, MB = KB * KB;

  function createEmitter() {
    const listeners = new Map();
    return {
      on(evt, cb) {
        if (!listeners.has(evt)) listeners.set(evt, new Set());
        listeners.get(evt).add(cb);
      },
      off(evt, cb) {
        listeners.get(evt)?.delete(cb);
      },
      emit(evt, data) {
        listeners.get(evt)?.forEach(cb => cb(data));
      }
    };
  }

  function createP2PClient({ signalingURL, stun = ['stun:stun.l.google.com:19302'] } = {}) {
    const socket = io(signalingURL || undefined, { transports: ['websocket'] });
    const appEmitter = createEmitter();
    let myName = 'Guest';

    // Roster
    socket.on('localRoster', roster => appEmitter.emit('roster', roster));

    // Map of peerId -> PeerConnection wrapper
    const peers = new Map();

    function onRoster(cb) { appEmitter.on('roster', cb); }

    function enterLocal(name = 'Guest') { myName = name; socket.emit('enterLocal', name); }
    function leaveLocal() { socket.emit('leaveLocal'); }

    // --- WebRTC helpers ---
    function createRTCPeer(peerId, isCaller, opts = {}) {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: stun }],
      });

      // DataChannel (caller creates)
      let dc = null;
      const conn = createEmitter();
      conn.peerId = peerId;

      const cleanup = () => {
        dc?.close();
        pc.close();
        peers.delete(peerId);
      };
      conn.close = cleanup;

      // Backpressure thresholds
      const DEFAULT_CHUNK = opts.chunkSize || 1 * MB;
      const BUFFER_LOW = 1 * MB;
      const BUFFER_HIGH = 16 * MB;

      function setupDC(channel) {
        dc = channel;
        // lower threshold so 'bufferedamountlow' fires when below this
        dc.bufferedAmountLowThreshold = BUFFER_LOW;

        dc.onopen = () => conn.emit('open');
        dc.onclose = () => { conn.emit('close'); cleanup(); };
        dc.onerror = (e) => conn.emit('error', e);

        // Receiver: streaming to disk
        let recvState = null; // { name, size, received, writer, stream }
        dc.onmessage = async (ev) => {
          // First message is JSON meta; then ArrayBuffer chunks; final "EOF"
          if (typeof ev.data === 'string') {
            const msg = JSON.parse(ev.data);
            if (msg.type === 'meta') {
              // Prepare a stream writer
              recvState = await createReceiveStream(msg.name, msg.size);
              conn.emit('recv-meta', msg);
            } else if (msg.type === 'eof') {
              // finalize
              await recvState?.writer?.close();
              conn.emit('recv-complete', { name: recvState?.name, size: recvState?.size });
              recvState = null;
            }
            return;
          }

          // Binary chunk
          if (ev.data instanceof ArrayBuffer || ev.data instanceof Blob) {
            const chunk = ev.data instanceof Blob ? await ev.data.arrayBuffer() : ev.data;
            if (!recvState) return; // ignore
            await recvState.writer.ready; // backpressure on WritableStream
            await recvState.writer.write(new Uint8Array(chunk));
            recvState.received += chunk.byteLength;
            const percent = recvState.size ? +((recvState.received / recvState.size) * 100).toFixed(2) : 0;
            conn.emit('recv-progress', {
              received: recvState.received,
              total: recvState.size,
              percent
            });
          }
        };
      }

      if (isCaller) {
        setupDC(pc.createDataChannel('data', { ordered: true }));
      } else {
        pc.ondatachannel = (ev) => setupDC(ev.channel);
      }

      // ICE
      pc.onicecandidate = (e) => {
        if (e.candidate) socket.emit('signal-ice', { to: peerId, candidate: e.candidate });
      };

      // --- Public sendFile API (chunked + backpressure) ---
      conn.sendFile = async function sendFile(file, { chunkSize = DEFAULT_CHUNK } = {}) {
        if (!dc || dc.readyState !== 'open') throw new Error('DataChannel not open');

        // Send meta first
        dc.send(JSON.stringify({ type: 'meta', name: file.name, size: file.size }));

        // Read & send in chunks, respecting backpressure
        let offset = 0;
        let lastT = Date.now(), bytesThisSecond = 0;

        while (offset < file.size) {
          const end = Math.min(offset + chunkSize, file.size);
          const blob = file.slice(offset, end);
          const buf = await blob.arrayBuffer();

          // Backpressure: pause when bufferedAmount is high
          await waitBuffered(dc, BUFFER_HIGH, BUFFER_LOW);

          dc.send(buf);

          offset = end;
          bytesThisSecond += buf.byteLength;

          const percent = +((offset / file.size) * 100).toFixed(2);
          const now = Date.now();
          if (now - lastT >= 1000) {
            const mbps = (bytesThisSecond / (1024 * 1024)).toFixed(2);
            conn.emit('send-speed', { MBps: mbps });
            bytesThisSecond = 0;
            lastT = now;
          }
          conn.emit('send-progress', { sent: offset, total: file.size, percent });
        }

        // EOF
        dc.send(JSON.stringify({ type: 'eof' }));
        conn.emit('send-complete', { name: file.name, size: file.size });
      };

      peers.set(peerId, { pc, dcRef: () => dc, conn });

      return { pc, conn, dcRef: () => dc };
    }

    async function waitBuffered(dc, high, low) {
      if (dc.bufferedAmount < high) return; // safe
      await new Promise((resolve) => {
        function onLow() {
          if (dc.bufferedAmount <= low) {
            dc.removeEventListener('bufferedamountlow', onLow);
            resolve();
          }
        }
        dc.addEventListener('bufferedamountlow', onLow);
      });
    }

    // Receiver: pick StreamSaver or FS Access stream
    async function createReceiveStream(filename, size) {
      // Try FS Access (Chrome/Edge)
      if (window.showSaveFilePicker) {
        try {
          const handle = await showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'All Files', accept: { '*/*': ['.*'] } }],
          });
          const stream = await handle.createWritable({ keepExistingData: false });
          // Wrap to match StreamSaver writer interface
          return {
            name: filename,
            size,
            received: 0,
            writer: {
              ready: Promise.resolve(),
              write: (chunk) => stream.write(new Blob([chunk])),
              close: () => stream.close()
            }
          };
        } catch (e) { /* fall through to StreamSaver */ }
      }

      // StreamSaver (works with service worker)
      // IMPORTANT: set .mitm to a page under same origin or use default
      if (!window.streamSaver) throw new Error("StreamSaver not loaded. Include StreamSaver.min.js");
      // optional: streamSaver.mitm = '/streamsaver/mitm.html'; // host this file if needed
      const fileStream = window.streamSaver.createWriteStream(filename, { size });
      const writer = fileStream.getWriter();
      return {
        name: filename,
        size,
        received: 0,
        writer: {
          ready: Promise.resolve(),
          write: (chunk) => writer.write(chunk),
          close: () => writer.close()
        }
      };
    }

    // --- Signaling glue ---
    socket.on('signal-offer', async ({ from, offer, fromName }) => {
      const { pc, conn } = createRTCPeer(from, false);
      const desc = new RTCSessionDescription(offer);
      await pc.setRemoteDescription(desc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal-answer', { to: from, answer });
      conn.emit('peer-info', { fromName });
    });

    socket.on('signal-answer', async ({ from, answer }) => {
      const peer = peers.get(from);
      if (!peer) return;
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('signal-ice', async ({ from, candidate }) => {
      const peer = peers.get(from);
      if (!peer) return;
      try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)); }
      catch (e) { /* ignore dupes */ }
    });

    // --- Public API ---
    return {
      onRoster,
      enterLocal,
      leaveLocal,
      // Create connection to a peer ID from roster
      connect: async function connect(peerId, options = {}) {
        const { pc, conn, dcRef } = createRTCPeer(peerId, true, options);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('signal-offer', { to: peerId, offer, fromName: myName });
        return conn; // emitter with: on('open'), sendFile(file), progress events, close()
      },
    };
  }

  // expose globally
  window.createP2PClient = createP2PClient;
})();
