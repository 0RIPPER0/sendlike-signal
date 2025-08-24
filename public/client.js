/* ==================================================
   SendLike — P2P client (signaling + WebRTC DataChannel)
   - Uses Socket.IO for signaling only (SDP & ICE)
   - DataChannel carries file bytes (no server bandwidth)
   - Chunked streaming with backpressure control
   ================================================== */

// -------- CONFIGURATION --------
const STUN_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }]; // add TURN if necessary
const CHUNK_SIZE = 512 * 1024; // 512KB per chunk (changeable)
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16MB buffered amount threshold

// -------- DOM --------
const myNameEl = document.getElementById("myName");
const myIdEl = document.getElementById("myId");
const peersEl = document.getElementById("peers");
const peerSelect = document.getElementById("peerSelect");
const pickFileBtn = document.getElementById("pickFileBtn");
const fileInput = document.getElementById("fileInput");
const connectBtn = document.getElementById("connectBtn");
const statusEl = document.getElementById("status");
const transfersEl = document.getElementById("transfers");

function logStatus(t){ statusEl.textContent = t; }

// -------- Signaling (Socket.IO) --------
const socket = io();
let mySocketId = null;
let myRandomName = "Peer" + Math.floor(Math.random()*10000);
myNameEl.textContent = myRandomName;

socket.on("connect", () => {
  mySocketId = socket.id;
  myIdEl.textContent = mySocketId;
  socket.emit("announce", { name: myRandomName });
  logStatus("Connected to signaling server");
});

socket.on("roster", (list) => renderRoster(list));

// offer/answer/ice handlers
socket.on("offer", async ({ from, sdp }) => {
  console.log("offer from", from);
  const pc = createPeerConnection(from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { to: from, sdp: pc.localDescription });
});

socket.on("answer", async ({ from, sdp }) => {
  const pc = pcs.get(from);
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
});

socket.on("ice", ({ from, candidate }) => {
  const pc = pcs.get(from);
  if (!pc) return;
  pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e=>console.warn(e));
});

// -------- Roster UI --------
let roster = [];
function renderRoster(list){
  roster = list.filter(p => p.id !== mySocketId);
  peersEl.innerHTML = "";
  peerSelect.innerHTML = "<option value=''>Select peer</option>";
  roster.forEach(p => {
    const d = document.createElement("div");
    d.className = "peer";
    d.textContent = p.name + " — " + p.id.slice(0,6);
    d.onclick = () => choosePeer(p.id);
    peersEl.appendChild(d);

    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name + " (" + p.id.slice(0,6) + ")";
    peerSelect.appendChild(opt);
  });
}

function choosePeer(id){
  peerSelect.value = id;
  logStatus("Selected " + id);
}

// -------- WebRTC bookkeeping --------
const pcs = new Map();   // peerId -> RTCPeerConnection
const dctrl = new Map(); // peerId -> control channel
const dfile = new Map(); // peerId -> file channel

function createPeerConnection(peerId, isInitiator){
  if (pcs.has(peerId)) return pcs.get(peerId);
  const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
  pcs.set(peerId, pc);

  pc.onicecandidate = e => { if (e.candidate) socket.emit("ice", { to: peerId, candidate: e.candidate }); };
  pc.onconnectionstatechange = () => {
    console.log("pc state", peerId, pc.connectionState);
    if (pc.connectionState === "failed" || pc.connectionState === "disconnected" || pc.connectionState === "closed") {
      cleanupPeer(peerId);
    }
  };

  if (isInitiator){
    const ctrl = pc.createDataChannel("ctrl");
    setupControlChannel(peerId, ctrl);
    const fileCh = pc.createDataChannel("file");
    setupFileChannel(peerId, fileCh);
  } else {
    pc.ondatachannel = (e) => {
      if (e.channel.label === "ctrl") setupControlChannel(peerId, e.channel);
      if (e.channel.label === "file") setupFileChannel(peerId, e.channel);
    };
  }

  return pc;
}

function setupControlChannel(peerId, ch){
  dctrl.set(peerId, ch);
  ch.onopen = () => { console.log("ctrl open", peerId); markPeerConnected(peerId); };
  ch.onmessage = (ev) => {
    try { const msg = JSON.parse(ev.data); handleControlMessage(peerId, msg); }
    catch(e){ console.warn("ctrl parse", e); }
  };
  ch.onclose = () => { markPeerDisconnected(peerId); };
}

function setupFileChannel(peerId, ch){
  dfile.set(peerId, ch);
  ch.binaryType = "arraybuffer";
  ch.onopen = () => { console.log("file open", peerId); markPeerConnected(peerId); };
  ch.onmessage = (ev) => { handleFileMessage(peerId, ev.data); };
  ch.onclose = () => { markPeerDisconnected(peerId); };
}

// -------- Control protocol --------
function handleControlMessage(peerId, msg){
  if (msg.type === "meta") {
    createIncoming(peerId, msg.fileId, msg.name, msg.size, msg.mime);
  } else if (msg.type === "file-complete") {
    finalizeIncoming(peerId, msg.fileId);
  }
}

// -------- Incoming file state --------
const incoming = {}; // incoming[peerId][fileId] = { name,size,mime,received,parts[] }

function createIncoming(peerId, fileId, name, size, mime){
  if (!incoming[peerId]) incoming[peerId] = {};
  incoming[peerId][fileId] = { name, size, mime, received:0, parts:[] };
  addTransferUI(peerId, fileId, name, size, true);
}

function handleFileMessage(peerId, data){
  // Expect binary chunk (ArrayBuffer)
  const buf = new Uint8Array(data);
  const map = incoming[peerId];
  if (!map) return console.warn("no incoming map for", peerId);

  // find first pending file
  const keys = Object.keys(map);
  if (!keys.length) return console.warn("no pending incoming file (chunk dropped?)");
  const fid = keys[0];
  const rec = map[fid];
  rec.parts.push(buf);
  rec.received += buf.byteLength;
  updateTransferUI(peerId, fid, rec.received, rec.size);

  if (rec.received >= rec.size) finalizeIncoming(peerId, fid);
}

function finalizeIncoming(peerId, fileId){
  const rec = incoming[peerId] && incoming[peerId][fileId];
  if (!rec) return;
  const blob = new Blob(rec.parts, { type: rec.mime || "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = rec.name || "download";
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ a.remove(); URL.revokeObjectURL(url); }, 2000);

  appendLog("Received " + rec.name + " from " + peerId);
  delete incoming[peerId][fileId];
  markTransferDone(peerId, fileId);
}

// -------- Sending file (chunking + backpressure) --------
async function sendFileToPeer(peerId, file){
  const ctrl = dctrl.get(peerId);
  const fileCh = dfile.get(peerId);
  if (!ctrl || !fileCh || fileCh.readyState !== "open") throw new Error("Channels not ready");

  const fileId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2,8);
  ctrl.send(JSON.stringify({ type:"meta", fileId, name:file.name, size:file.size, mime:file.type }));

  addTransferUI(peerId, fileId, file.name, file.size, false);

  // use readable stream if available to avoid allocating huge memory
  const reader = file.stream && file.stream().getReader ? file.stream().getReader() : null;
  let offset = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await sendChunkWithBackpressure(fileCh, value.buffer);
      offset += value.byteLength;
      updateTransferUI(peerId, fileId, offset, file.size);
    }
  } else {
    while (offset < file.size) {
      const end = Math.min(offset + CHUNK_SIZE, file.size);
      const chunk = await file.slice(offset, end).arrayBuffer();
      await sendChunkWithBackpressure(fileCh, chunk);
      offset = end;
      updateTransferUI(peerId, fileId, offset, file.size);
    }
  }

  ctrl.send(JSON.stringify({ type:"file-complete", fileId }));
  markTransferDone(peerId, fileId);
  appendLog("Sent " + file.name + " to " + peerId);
}

function sendChunkWithBackpressure(ch, arrayBuffer){
  return new Promise((resolve, reject) => {
    function trySend(){
      if (ch.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        setTimeout(trySend, 50);
        return;
      }
      try { ch.send(arrayBuffer); resolve(); } catch(e){ reject(e); }
    }
    trySend();
  });
}

// -------- UI helpers for transfers --------
function addTransferUI(peerId, fileId, name, size, incomingFlag){
  const el = document.createElement("div");
  el.className = "transfer";
  el.id = `tr-${peerId}-${fileId}`;
  el.innerHTML = `<div><strong>${incomingFlag ? "Receiving" : "Sending"}:</strong> ${name} <span class="small" id="sz-${peerId}-${fileId}">(${(size/1024/1024).toFixed(2)} MB)</span></div>
    <div class="bar"><i style="width:0%"></i></div>`;
  transfersEl.appendChild(el);
}
function updateTransferUI(peerId, fileId, doneBytes, total){
  const el = document.getElementById(`tr-${peerId}-${fileId}`);
  if (!el) return;
  const pct = Math.min(100, (doneBytes/total*100)).toFixed(1);
  el.querySelector(".bar > i").style.width = pct + "%";
  const sz = el.querySelector(`#sz-${peerId}-${fileId}`);
  if (sz) sz.textContent = `(${(total/1024/1024).toFixed(2)} MB) ${pct}%`;
}
function markTransferDone(peerId, fileId){
  const el = document.getElementById(`tr-${peerId}-${fileId}`);
  if (!el) return;
  el.querySelector(".bar > i").style.width = "100%";
  el.style.opacity = "0.7";
  // auto-hide after a while:
  setTimeout(()=> el.remove(), 30_000);
}

// -------- connection bookkeeping UI --------
function markPeerConnected(peerId){
  [...peersEl.children].forEach(div=>{
    if (div.textContent.includes(peerId.slice(0,6))) div.classList.add("connected");
  });
}
function markPeerDisconnected(peerId){
  [...peersEl.children].forEach(div=>{
    if (div.textContent.includes(peerId.slice(0,6))) div.classList.remove("connected");
  });
}
function cleanupPeer(peerId){
  const pc = pcs.get(peerId);
  if (pc) try{ pc.close(); }catch(e){}
  pcs.delete(peerId); dctrl.delete(peerId); dfile.delete(peerId);
  markPeerDisconnected(peerId);
}

// -------- utilities --------
function appendLog(msg){ console.log(msg); logStatus(msg); }

// -------- UI event handlers --------
pickFileBtn.addEventListener("click", ()=> fileInput.click());
fileInput.addEventListener("change", async (e)=>{
  const files = Array.from(e.target.files || []);
  const peerId = peerSelect.value;
  if (!peerId) return alert("Select peer first");
  for (const f of files) {
    try { await sendFileToPeer(peerId, f); } catch (err) { console.error("send err", err); appendLog("Error sending: "+err.message); }
  }
});

connectBtn.addEventListener("click", async ()=>{
  const target = peerSelect.value;
  if (!target) return alert("Select peer first");
  logStatus("Creating offer to " + target);
  const pc = createPeerConnection(target, true);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { to: target, sdp: pc.localDescription });
});
