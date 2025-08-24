/* script.js — P2P core for same-WiFi discovery + huge (>5GB) WebRTC file transfer.
   Uses Socket.IO ONLY for signaling (SDP/ICE) and roster. Bytes go P2P via DataChannel.
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
    pcs: new Map(),     // peerId -> RTCPeerConnection
    dcs: new Map(),     // peerId -> RTCDataChannel
    inflightRecv: new Map(), // peerId -> {meta, received, sink, useFS}
    listeners: new Map(),    // event -> Set<fn>
    cfg: {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      chunkBytes: 1 * MB,            // sender chunk size
      bufferedLowThreshold: 16 * MB, // bufferedAmount flow-control
      autoEnterLocal: true,
      autoConnect: false
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

  // ----------- Socket lifecycle -----------
  socket.on('connect', () => {
    state.myId = socket.id;
    emit("socket:connect", { myId: state.myId }); // << let UI know (fix blank ID)
    if (state.cfg.autoEnterLocal) {
      socket.emit("enterLocal", state.myName);
    }
  });
  socket.on('disconnect', () => {
    emit("socket:disconnect", {});
  });

  // ----------- Roster -----------
  socket.on('localRoster', roster => {
    state.peers = Array.isArray(roster) ? roster.filter(p => p.id !== socket.id) : [];
    emit('roster', state.peers.slice());
    if (state.cfg.autoConnect) {
      const first = state.peers[0];
      if (first && !state.pcs.has(first.id)) connect(first.id);
    }
  });

  // ----------- Unified signaling relay -----------
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
      setupDC(peerId, ev.channel);
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

    dc.onopen = () => { state.dcs.set(peerId, dc); };
    dc.onclose = () => { state.dcs.delete(peerId); };
    dc.onerror = (e) => emit('error', { peerId, scope: 'dc', error: e?.error || e });

    // Control messages (JSON string): {type:'file-meta',name,size,mime}, {type:'file-done'}
    dc.onmessage = async (ev) => {
      const data = ev.data;

      if (typeof data === 'string') {
        let msg;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === 'file-meta') {
          const meta = { name: msg.name, size: msg.size, mime: msg.mime || 'application/octet-stream' };
          emit('recv:file:meta', { peerId, meta });

          // Prefer File System Access API for huge files
          let writer = null;
          let streamWriter = null;
          if (window.showSaveFilePicker && meta.size > 100*MB) {
            try {
              const fh = await window.showSaveFilePicker({
                suggestedName: meta.name,
                types: [{ description: 'All files', accept: { '*/*': ['.*'] } }]
              });
              writer = await fh.createWritable();
            } catch (e) {
              emit('error', { peerId, scope: 'fsapi', error: e });
            }
          }
          if (!writer) {
            // Fallback to in-memory (OK for small/medium files)
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

          state.inflightRecv.set(peerId, {
            meta, received: 0, sink: writer || streamWriter, useFS: !!writer
          });
          return;
        }

        if (msg.type === 'file-done') {
          const r = state.inflightRecv.get(peerId);
          if (!r) return;
          try { await r.sink.close(); } catch {}
          state.inflightRecv.delete(peerId);
          emit('recv:file:done', { peerId, meta: r.meta });
          return;
        }

        return;
      }

      // Binary chunk
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

    const r = state.inflightRecv.get(peerId);
    if (r) {
      try { r.sink.close(); } catch {}
      state.inflightRecv.delete(peerId);
    }
  }

  // ----------- Connect / Disconnect -----------
  async function connect(peerId) {
    if (state.pcs.has(peerId)) return peerId;
    const pc = createPC(peerId, true);
    state.pcs.set(peerId, pc);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { target: peerId, data: { sdp: offer } });
    return peerId;
  }
  function disconnect(peerId) {
    if (peerId) cleanupPeer(peerId);
    else for (const id of Array.from(state.pcs.keys())) cleanupPeer(id);
  }

  // ----------- Send File (streams + flow control) -----------
  async function sendFile(peerId, fileOrFiles) {
    const files = Array.isArray(fileOrFiles) ? fileOrFiles : [fileOrFiles];
    const dc = state.dcs.get(peerId);
    if (!dc || dc.readyState !== 'open') throw new Error("DataChannel not open");

    for (const file of files) {
      // meta first
      dc.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' }));

      // Stream if supported (doesn't load whole file to RAM)
      const reader = file.stream && file.stream().getReader ? file.stream().getReader() : null;
      let offset = 0;
      const cBytes = state.cfg.chunkBytes;
      const start = performance.now();
      let lastTick = start, sentSinceTick = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          // Flow control: wait until bufferedAmount is low
          if (dc.bufferedAmount > state.cfg.bufferedLowThreshold) {
            await waitEventOnce(dc, 'bufferedamountlow');
          }
          dc.send(value.buffer);
          offset += value.byteLength;

          // progress / rate
          const now = performance.now();
          sentSinceTick += value.byteLength;
          if (now - lastTick >= 1000 || offset === file.size) {
            const mbps = (sentSinceTick * 8) / (now - lastTick) / 1000;
            emit('send:progress', {
              peerId, name: file.name, sent: offset, total: file.size,
              pct: (offset / file.size) * 100, rateMbps: mbps
            });
            sentSinceTick = 0; lastTick = now;
          }
        }
      } else {
        // Fallback: slice/chunk
        while (offset < file.size) {
          if (dc.bufferedAmount > state.cfg.bufferedLowThreshold) {
            await waitEventOnce(dc, 'bufferedamountlow');
          }
          const end = Math.min(offset + cBytes, file.size);
          const chunk = await file.slice(offset, end).arrayBuffer();
          dc.send(chunk);
          offset = end;

          const now = performance.now();
          sentSinceTick += chunk.byteLength;
          if (now - lastTick >= 1000 || offset === file.size) {
            const mbps = (sentSinceTick * 8) / (now - lastTick) / 1000;
            emit('send:progress', {
              peerId, name: file.name, sent: offset, total: file.size,
              pct: (offset / file.size) * 100, rateMbps: mbps
            });
            sentSinceTick = 0; lastTick = now;
          }
        }
      }

      // complete
      dc.send(JSON.stringify({ type: 'file-done' }));
    }
  }

  // ----------- Public API -----------
  const SL = {
    init(opts = {}) {
      Object.assign(state.cfg, opts || {});
      // If already connected, enter local now; otherwise handled on 'connect'
      if (socket.connected && state.cfg.autoEnterLocal) {
        socket.emit("enterLocal", state.myName);
      }
      return { id: state.myId, name: state.myName, config: { ...state.cfg } };
    },
    on,
    listPeers() { return state.peers.slice(); },
    connect,
    disconnect,
    sendFile,
    setName(name) {
      state.myName = (name || '').trim() || state.myName;
      socket.emit("leaveLocal");
      socket.emit("enterLocal", state.myName);
    },
    setConfig(partial) {
      Object.assign(state.cfg, partial || {});
      for (const dc of state.dcs.values()) {
        dc.bufferedAmountLowThreshold = state.cfg.bufferedLowThreshold;
      }
    }
  };

  // expose
  window.SL = SL;
})();
