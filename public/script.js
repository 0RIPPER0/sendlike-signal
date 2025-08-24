/* script.js — UI-free P2P core for same-WiFi discovery + >5GB WebRTC file transfer.
   Requires: <script src="/socket.io/socket.io.js"></script> loaded first.
*/
(() => {
  const socket = io();

  // ----------- Utils -----------
  const KB = 1024, MB = KB * KB;
  const rndName = () => {
    const adj = ["Spicy","Sleepy","Bouncy","Shiny","Sneaky","Brave","Chill","Zippy","Fuzzy","Witty","Cosmic","Turbo","Sassy","Pixel","Mellow"];
    const ani = ["Panda","Otter","Falcon","Koala","Lemur","Tiger","Sloth","Fox","Yak","Marmot","Narwhal","Dolphin","Eagle","Moose","Gecko"];
    return `${adj[Math.floor(Math.random()*adj.length)]}${ani[Math.floor(Math.random()*ani.length)]}`;
  };
  const waitEventOnce = (target, ev) => new Promise(res => target.addEventListener(ev, res, { once: true }));

  // ----------- State -----------
  const state = {
    myId: null,
    myName: rndName(),
    peers: [], // [{id,name}]
    pcs: new Map(),  // peerId -> RTCPeerConnection
    dcs: new Map(),  // peerId -> RTCDataChannel
    inflightRecv: new Map(), // key peerId -> current receiving {meta, received, writer}
    listeners: new Map(), // event -> Set<fn>
    cfg: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      chunkBytes: 1 * MB, // sender chunk size
      bufferedLowThreshold: 8 * MB, // flow-control
      autoEnterLocal: true,
      autoConnect: false, // if true, auto connect to first other peer
    }
  };

  // ----------- Events -----------
  function emit(ev, payload) {
    const s = state.listeners.get(ev);
    if (!s) return;
    for (const fn of s) { try { fn(payload); } catch(_){} }
  }
  function on(ev, fn) {
    if (!state.listeners.has(ev)) state.listeners.set(ev, new Set());
    state.listeners.get(ev).add(fn);
    return () => state.listeners.get(ev)?.delete(fn);
  }

  // ----------- Roster -----------
  socket.on('connect', () => { state.myId = socket.id; });
  socket.on('localRoster', roster => {
    // roster: [{id,name}]
    state.peers = Array.isArray(roster) ? roster.filter(p => p.id !== socket.id) : [];
    emit('roster', state.peers.slice());
    if (state.cfg.autoConnect) {
      const first = state.peers[0];
      if (first && !state.pcs.has(first.id)) connect(first.id);
    }
  });

  // ----------- Signaling relay -----------
  socket.on("signal", async ({ from, data }) => {
    let pc = state.pcs.get(from);
    if (!pc) {
      pc = createPC(from, /*isCaller*/ false);
      state.pcs.set(from, pc);
    }
    if (data.sdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      if (data.sdp.type === "offer") {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { target: from, data: { sdp: answer } });
      }
    } else if (data.candidate) {
      try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch (e) {}
    }
  });

  // ----------- Peer Connection / DataChannel -----------
  function createPC(peerId, isCaller) {
    const pc = new RTCPeerConnection({ iceServers: state.cfg.iceServers });
    pc.onicecandidate = e => {
      if (e.candidate) socket.emit("signal", { target: peerId, data: { candidate: e.candidate } });
    };
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'connected') emit('connected', { peerId });
      if (st === 'disconnected' || st === 'failed' || st === 'closed') {
        cleanupPeer(peerId);
        emit('disconnected', { peerId, state: st });
      }
    };
    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      setupDC(peerId, dc);
    };
    if (isCaller) {
      const dc = pc.createDataChannel("file", { ordered: true });
      setupDC(peerId, dc);
    }
    return pc;
  }

  function setupDC(peerId, dc) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = state.cfg.bufferedLowThreshold;
    dc.onopen = () => {
      state.dcs.set(peerId, dc);
    };
    dc.onclose = () => {
      state.dcs.delete(peerId);
    };
    dc.onerror = (e) => emit('error', { peerId, scope: 'dc', error: e?.error || e });

    // Simple framing: JSON control messages as UTF-8 strings, file chunks as ArrayBuffer
    // Control messages: {type:'file-meta',name,size,mime}, {type:'file-done'}
    let recv = state.inflightRecv.get(peerId);

    dc.onmessage = async (ev) => {
      const data = ev.data;
      if (typeof data === 'string') {
        // control
        let msg;
        try { msg = JSON.parse(data); } catch { return; }
        if (msg.type === 'file-meta') {
          // Prepare sink
          const meta = { name: msg.name, size: msg.size, mime: msg.mime || 'application/octet-stream' };
          emit('recv:file:meta', { peerId, meta });

          // Try File System Access API for streaming
          let writer = null;
          let streamWriter = null;
          if (window.showSaveFilePicker && meta.size > 100*MB) {
            try {
              const fh = await window.showSaveFilePicker({
                suggestedName: meta.name,
                types: [{ description: 'All files', accept: { '*/*': ['.*'] } }]
              });
              const ws = await fh.createWritable();
              writer = ws;
            } catch (e) {
              emit('error', { peerId, scope: 'fsapi', error: e });
            }
          }

          if (!writer) {
            // Fallback to in-memory (dangerous for huge files, but keeps compatibility)
            streamWriter = {
              bufs: [],
              async write(buf) { this.bufs.push(buf); },
              async close() {
                const blob = new Blob(this.bufs, { type: meta.mime });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = meta.name || 'download';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
              }
            };
          }

          recv = {
            meta,
            received: 0,
            sink: writer || streamWriter,
            useFS: !!writer
          };
          state.inflightRecv.set(peerId, recv);
        } else if (msg.type === 'file-done') {
          const r = state.inflightRecv.get(peerId);
          if (!r) return;
          if (r.useFS) {
            try { await r.sink.close(); } catch {}
          } else {
            await r.sink.close();
          }
          state.inflightRecv.delete(peerId);
          emit('recv:file:done', { peerId, meta: r.meta });
        }
        return;
      }

      // binary chunk
      const r = state.inflightRecv.get(peerId);
      if (!r) return;
      try {
        await r.sink.write(new Uint8Array(data));
      } catch (e) {
        emit('error', { peerId, scope: 'write', error: e });
        return;
      }
      r.received += data.byteLength;
      emit('recv:file:progress', {
        peerId, received: r.received, total: r.meta.size,
        pct: (r.received / r.meta.size) * 100
      });
    };
  }

  function cleanupPeer(peerId) {
    state.dcs.get(peerId)?.close();
    state.dcs.delete(peerId);
    const pc = state.pcs.get(peerId);
    try { pc?.close(); } catch {}
    state.pcs.delete(peerId);
    // abort receive if any
    const r = state.inflightRecv.get(peerId);
    if (r) {
      try { r.useFS ? r.sink.close() : r.sink.close(); } catch {}
      state.inflightRecv.delete(peerId);
    }
  }

  // ----------- Connect / Disconnect -----------
  async function connect(peerId) {
    if (state.pcs.has(peerId)) return;
    const pc = createPC(peerId, true);
    state.pcs.set(peerId, pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { target: peerId, data: { sdp: offer } });
    return peerId;
  }
  function disconnect(peerId) {
    if (peerId) {
      cleanupPeer(peerId);
    } else {
      for (const id of Array.from(state.pcs.keys())) cleanupPeer(id);
    }
  }

  // ----------- Send File (streams + flow control) -----------
  async function sendFile(peerId, fileOrFiles) {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const dc = state.dcs.get(peerId);
    if (!dc || dc.readyState !== 'open') throw new Error("DataChannel not open");

    for (const file of files) {
      // meta
      dc.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' }));

      let offset = 0;
      const cBytes = state.cfg.chunkBytes;
      const start = performance.now();
      let lastTick = start, sentSinceTick = 0;

      while (offset < file.size) {
        // flow control: if buffer is high, wait for low event
        if (dc.bufferedAmount > state.cfg.bufferedLowThreshold) {
          await waitEventOnce(dc, 'bufferedamountlow');
        }

        const end = Math.min(offset + cBytes, file.size);
        const chunk = await file.slice(offset, end).arrayBuffer();
        dc.send(chunk);
        offset = end;

        // progress event
        const now = performance.now();
        sentSinceTick += chunk.byteLength;
        if (now - lastTick >= 1000 || offset === file.size) {
          const mbps = (sentSinceTick * 8) / (now - lastTick) / 1000; // Mbit/s approx
          emit('send:progress', {
            peerId,
            name: file.name,
            sent: offset,
            total: file.size,
            pct: (offset / file.size) * 100,
            rateMbps: mbps
          });
          sentSinceTick = 0;
          lastTick = now;
        }
      }
      // done
      dc.send(JSON.stringify({ type: 'file-done' }));
    }
  }

  // ----------- Public API -----------
  const SL = {
    init(opts = {}) {
      Object.assign(state.cfg, opts || {});
      // enter local discovery by default
      if (state.cfg.autoEnterLocal) {
        socket.emit("enterLocal", state.myName);
      }
      return {
        id: state.myId,
        name: state.myName,
        config: { ...state.cfg }
      };
    },
    on,
    listPeers() { return state.peers.slice(); },
    connect,
    disconnect,
    sendFile,
    setName(name) {
      state.myName = (name || '').trim() || state.myName;
      // re-enter to update name (optional)
      socket.emit("leaveLocal");
      socket.emit("enterLocal", state.myName);
    },
    // advanced: change chunk size / thresholds at runtime
    setConfig(partial) {
      Object.assign(state.cfg, partial || {});
      // apply to existing DCs
      for (const dc of state.dcs.values()) {
        dc.bufferedAmountLowThreshold = state.cfg.bufferedLowThreshold;
      }
    }
  };

  // expose
  window.SL = SL;
})();
