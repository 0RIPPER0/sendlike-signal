const socket = io();

// random funny name
const adj = ["Brave","Chill","Zippy","Fuzzy","Witty","Cosmic","Turbo","Sassy","Pixel","Mellow"];
const ani = ["Panda","Otter","Falcon","Koala","Tiger","Sloth","Fox","Yak","Narwhal","Dolphin"];
const myName = adj[Math.floor(Math.random()*adj.length)] + ani[Math.floor(Math.random()*ani.length)];

document.getElementById("me").textContent = "You are: " + myName;
socket.emit("join", myName);

const peersEl = document.getElementById("peers");
const fileInput = document.getElementById("fileInput");

let pc = null, dc = null;
let targetPeer = null;

// Roster updates
socket.on("roster", list => {
  peersEl.innerHTML = "";
  list.forEach(p => {
    if (p.id === socket.id) return;
    const div = document.createElement("div");
    div.className = "peer";
    div.textContent = p.name;
    div.onclick = () => connectTo(p.id, p.name);
    peersEl.appendChild(div);
  });
});

// Signaling
socket.on("signal", async ({ from, data }) => {
  if (!pc) await setupPC(from);

  if (data.sdp) {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    if (data.sdp.type === "offer") {
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("signal", { to: from, data: { sdp: pc.localDescription } });
    }
  } else if (data.candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(data.candidate)); }
    catch (e) { console.error("ICE error", e); }
  }
});

async function connectTo(peerId, peerName) {
  targetPeer = peerId;
  await setupPC(peerId);

  dc = pc.createDataChannel("file");
  setupDC(dc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("signal", { to: peerId, data: { sdp: pc.localDescription } });

  // after connected -> file picker
  dc.onopen = () => fileInput.click();
}

async function setupPC(peerId) {
  pc = new RTCPeerConnection();
  pc.onicecandidate = e => {
    if (e.candidate) socket.emit("signal", { to: peerId, data: { candidate: e.candidate } });
  };
  pc.ondatachannel = e => {
    dc = e.channel;
    setupDC(dc);
  };
}

function setupDC(channel) {
  channel.onmessage = e => handleIncoming(e.data);
  channel.onopen = () => console.log("DataChannel open");
}

fileInput.addEventListener("change", () => {
  if (dc && dc.readyState === "open" && fileInput.files.length) {
    sendFile(fileInput.files[0]);
  }
});

// =======================
// File Sending
// =======================
function sendFile(file) {
  const chunkSize = 64 * 1024;
  let offset = 0;
  console.log("Sending", file.name, file.size);

  // send header
  dc.send(JSON.stringify({ header: true, name: file.name, size: file.size, type: file.type }));

  const reader = new FileReader();
  reader.onload = e => {
    dc.send(e.target.result);
    offset += e.target.result.byteLength;
    showProgress("Sending", offset, file.size);

    if (offset < file.size) readSlice(offset);
    else console.log("File sent");
  };

  function readSlice(o) {
    const slice = file.slice(offset, o + chunkSize);
    reader.readAsArrayBuffer(slice);
  }
  readSlice(0);
}

// =======================
// File Receiving
// =======================
let incoming = null, received = 0, buffers = [];

function handleIncoming(data) {
  if (typeof data === "string") {
    const meta = JSON.parse(data);
    if (meta.header) {
      incoming = meta;
      received = 0; buffers = [];
      console.log("Incoming file", incoming);
      return;
    }
  } else {
    buffers.push(data);
    received += data.byteLength;
    showProgress("Receiving", received, incoming.size);
    if (received >= incoming.size) {
      const blob = new Blob(buffers, { type: incoming.type });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = incoming.name;
      a.click();
      console.log("File received:", incoming.name);
      incoming = null;
    }
  }
}

// =======================
// Progress Display
// =======================
function showProgress(label, done, total) {
  let prog = document.querySelector(".progress");
  if (!prog) {
    prog = document.createElement("div");
    prog.className = "progress";
    document.body.appendChild(prog);
  }
  const pct = ((done / total) * 100).toFixed(1);
  prog.textContent = `${label}: ${pct}% of ${(total/1024/1024).toFixed(1)} MB`;
}
