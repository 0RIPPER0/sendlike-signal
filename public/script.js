/* =========================================================
=  SendLike — Client (Landing + Mode + Join/Create + People +
=                   Chat + Drag/Drop + File Transfer)
=  Uses Socket.IO relay. Local mode: 4MB chunks. Online: 64KB.
========================================================= */

/* ------------------------------
   Socket & Elements
------------------------------ */
const socket = io();

const app            = document.getElementById('app');
const landing        = document.getElementById('landing');
const aboutBtn       = document.getElementById('aboutBtn');

const modeSwitch     = document.getElementById('modeSwitch');
const modeLabel      = document.getElementById('modeLabel');

const openShareWrap  = document.getElementById('openShareWrap');
const openShareLabel = document.getElementById('openShareLabel');
const openShareSwitch= document.getElementById('openShareSwitch');

const cardOnlineJoin = document.getElementById('cardOnlineJoin');
const cardOnlineCreate = document.getElementById('cardOnlineCreate');

const nameOnline     = document.getElementById('nameOnline');
const joinCodeInput  = document.getElementById('joinCode');
const joinBtn        = document.getElementById('joinBtn');

const nameHost       = document.getElementById('nameHost');
const createBtn      = document.getElementById('createBtn');

const sessionInfo    = document.getElementById('sessionInfo');
const sessionStatus  = document.getElementById('sessionStatus');
const sessionCode    = document.getElementById('sessionCode');
const sessionRole    = document.getElementById('sessionRole');
const disbandBtn     = document.getElementById('disbandBtn');

const peopleTitle    = document.getElementById('peopleTitle');
const peopleList     = document.getElementById('peopleList');

const chatFab        = document.getElementById('chatToggleBtn');
const chatDot        = document.getElementById('chatNotifDot');
const chatBox        = document.getElementById('chatBox');
const chatClose      = document.getElementById('chatCloseBtn');
const chatMessages   = document.getElementById('chatMessages');
const chatInput      = document.getElementById('chatInput');
const sendChatBtn    = document.getElementById('sendChatBtn');

const filePicker     = document.getElementById('fileInput');

/* Drag overlay */
let dropOverlay = document.getElementById('dropOverlay');
if (!dropOverlay) {
  dropOverlay = document.createElement('div');
  dropOverlay.id = 'dropOverlay';
  dropOverlay.innerHTML = '<div>Drop files to send</div>';
  document.body.appendChild(dropOverlay);
}

/* ------------------------------
   State
------------------------------ */
let MODE_LOCAL = false;
let currentRoom = null;
let hostId = null;
let isHost = false;
let myName = '';
let openShare = false;

let people = []; // online: group members; local: local roster
let mySocketId = null;
socket.on('connect', () => { mySocketId = socket.id; });

/* For transfers */
const rndName = () => {
  const adj = ["Spicy","Sleepy","Bouncy","Shiny","Sneaky","Brave","Chill","Zippy","Fuzzy","Witty","Cosmic","Turbo","Sassy","Pixel","Mellow"];
  const ani = ["Panda","Otter","Falcon","Koala","Lemur","Tiger","Sloth","Fox","Yak","Marmot","Narwhal","Dolphin","Eagle","Moose","Gecko"];
  return `${adj[Math.floor(Math.random()*adj.length)]}${ani[Math.floor(Math.random()*ani.length)]}`;
};
let localName = rndName();

const KB = 1024, MB = KB * KB;

/* ========================================================
=  Landing (fade + plane loop)
======================================================== */
function loopPlane() {
  const plane = landing.querySelector('.plane');
  const trail = landing.querySelector('.contrail');
  if (!plane || !trail) return;
  plane.style.animation = 'none';
  trail.style.animation = 'none';
  // reflow
  void plane.offsetWidth; void trail.offsetWidth;
  plane.style.animation = 'planeCurve 1.5s ease-in forwards';
  trail.style.animation = 'contrailFade 1.5s ease-in forwards';
  setTimeout(loopPlane, 3800);
}
function startLanding() {
  loopPlane();
  setTimeout(() => landing.classList.add('hidden'), 2500);
  landing.addEventListener('transitionend', () => {
    landing.style.display = 'none';
    app.hidden = false;
  }, { once: true });
}
window.addEventListener('load', startLanding);

/* ========================================================
=  Helpers
======================================================== */
function safeName(raw) {
  const s = (raw || '').trim();
  return s || 'Guest';
}
function setSessionUI({ code, roleText, statusText }) {
  sessionCode.textContent = code || '———';
  sessionRole.textContent = roleText || '—';
  sessionStatus.textContent = statusText || 'Active';
  sessionInfo.hidden = false;
  disbandBtn.hidden = !isHost;
  // show OpenShare toggle only if host + online mode
  openShareWrap.hidden = !(isHost && !MODE_LOCAL && currentRoom);
  openShareLabel.textContent = openShare ? '🟢 Open Share' : '🔒 Host-only sending';
  openShareSwitch.checked = !!openShare;
}
function avatarColor(seed) {
  // simple deterministic pastel
  let h = 0; for (let i=0;i<seed.length;i++) h = (h*31 + seed.charCodeAt(i)) % 360;
  return `hsl(${h}deg 70% 55%)`;
}
function renderPeople(list) {
  peopleList.innerHTML = '';
  list.forEach(p => {
    if (MODE_LOCAL && p.id === mySocketId) return; // don't show self in local roster
    const card = document.createElement('div');
    card.className = 'person';
    card.dataset.id = p.id;
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = (p.name||'?').slice(0,1).toUpperCase();
    av.style.background = avatarColor(p.name || p.id);
    const nm = document.createElement('div');
    nm.textContent = p.name || '—';
    card.appendChild(av); card.appendChild(nm);
    card.addEventListener('click', () => chooseTargetAndPickFiles(p.id, p.name));
    peopleList.appendChild(card);
  });
}

/* ========================================================
=  About + Mode Toggle
======================================================== */
aboutBtn.addEventListener('click', () => {
  alert('SendLike — Simple group sharing via code or local network.');
});

modeSwitch.addEventListener('change', () => {
  MODE_LOCAL = modeSwitch.checked;
  modeLabel.textContent = MODE_LOCAL ? '📡 Local Mode' : '🌐 Online Mode';

  // UI show/hide
  cardOnlineJoin.hidden = MODE_LOCAL;
  cardOnlineCreate.hidden = MODE_LOCAL;
  sessionInfo.hidden = MODE_LOCAL; // no group session UI for local
  disbandBtn.hidden = true;
  openShareWrap.hidden = true;
  currentRoom = null; hostId = null; isHost = false; openShare = false;

  // People title
  peopleTitle.textContent = MODE_LOCAL ? 'Nearby Devices' : 'Members';
  peopleList.innerHTML = '';

  if (MODE_LOCAL) {
    // enter local roster
    socket.emit('enterLocal', localName);
  } else {
    // leave local roster
    socket.emit('leaveLocal');
  }
});

/* ========================================================
=  Online: Create / Join / Disband
======================================================== */
createBtn.addEventListener('click', () => {
  const name = safeName(nameHost.value);
  if (!name) return alert('Enter your name');

  myName = name;
  socket.emit('createGroup', { name, ttlMinutes: 10 }, ({ code, hostId: hId, openShare: os }) => {
    currentRoom = code; 
    hostId = hId; 
    isHost = true; 
    openShare = !!os;
    setSessionUI({ code, roleText: 'Host', statusText: 'Active' });
    peopleTitle.textContent = 'Members';

    // Host keeps "Join" hidden, but we leave Create hidden too since group is already made
    cardOnlineJoin.hidden = true;
    cardOnlineCreate.hidden = true;
  });
});

joinBtn.addEventListener('click', () => {
  const name = safeName(nameOnline.value);
  const code = (joinCodeInput.value || '').trim();
  if (!name || !code) return alert('Enter name and 6-digit code');

  myName = name;
  socket.emit('joinGroup', { name, code }, (res) => {
    if (res.error) return alert(res.error);
    currentRoom = code; 
    hostId = res.hostId; 
    isHost = false; 
    openShare = !!res.openShare;
    setSessionUI({ code, roleText: 'Member', statusText: 'Active' });
    peopleTitle.textContent = 'Members';

    // 🔹 Hide join/create UI for members to prevent spam
    cardOnlineJoin.hidden = true;
    cardOnlineCreate.hidden = true;
  });
});

disbandBtn.addEventListener('click', () => {
  if (!isHost || !currentRoom) return;
  socket.emit('disbandGroup', currentRoom);
});

/* Host-only: Open Share toggle */
openShareSwitch.addEventListener('change', () => {
  if (!isHost || !currentRoom) return;
  socket.emit('setOpenShare', { code: currentRoom, value: openShareSwitch.checked });
});

/* ========================================================
=  People roster updates
======================================================== */
socket.on('updateMembers', (members) => {
  if (MODE_LOCAL) return; // ignore in local
  people = Array.isArray(members) ? members : [];
  renderPeople(people);
});
socket.on('localRoster', (roster) => {
  if (!MODE_LOCAL) return;
  people = Array.isArray(roster) ? roster : [];
  renderPeople(people);
});
socket.on('openShareState', (value) => {
  openShare = !!value;
  openShareLabel.textContent = openShare ? '🟢 Open Share' : '🔒 Host-only sending';
});

/* ========================================================
=  Chat (no double echo)
======================================================== */
function appendMsg({ you=false, name, text }) {
  const line = document.createElement('div');
  line.className = 'msg' + (you ? ' you' : '');
  line.textContent = `${name}: ${text}`;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatBox.hidden && !you) chatDot.style.display = 'block';
}
function sendChat() {
  const text = (chatInput.value || '').trim();
  if (!text) return;
  // Local chat only makes sense in online rooms; still allow if local -> ephemeral
  const name = myName || localName || 'Me';
  appendMsg({ you:true, name, text });
  if (currentRoom) socket.emit('chat', { room: currentRoom, name, text });
  chatInput.value = '';
}
sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
socket.on('chat', ({ id, name, text }) => {
  if (id === socket.id) return; // prevent duplicate
  appendMsg({ name: name || 'Guest', text: text || '' });
});

chatFab.addEventListener('click', () => {
  chatBox.hidden = !chatBox.hidden;
  if (!chatBox.hidden) chatDot.style.display = 'none';
});
chatClose.addEventListener('click', () => chatBox.hidden = true);

socket.on('groupDisbanded', (reason) => {
  alert(`Group closed: ${reason || 'Closed'}`);
  currentRoom = null; hostId = null; isHost = false; openShare = false;
  sessionInfo.hidden = true; disbandBtn.hidden = true; openShareWrap.hidden = true;
  people = []; renderPeople(people);
});

/* ========================================================
=  Drag & Drop + Click to send (multi)
======================================================== */
let targetForSend = null; // socketId of selected person

function chooseTargetAndPickFiles(targetId, targetName) {
  // Permission (online)
  if (!MODE_LOCAL && currentRoom) {
    const iAmHost = isHost;
    if (!openShare && !iAmHost && targetId !== hostId) {
      return alert('Host-only sending is enabled. You can only send files to the host.');
    }
  }
  targetForSend = targetId;
  filePicker.value = ''; // reset
  filePicker.click();
}
filePicker.addEventListener('change', () => {
  if (!targetForSend || !filePicker.files?.length) return;
  sendFilesTo(targetForSend, Array.from(filePicker.files));
});

['dragenter','dragover'].forEach(evt => {
  document.addEventListener(evt, (e) => {
    e.preventDefault(); e.stopPropagation();
    dropOverlay.classList.add('show');
  });
});
['dragleave','drop'].forEach(evt => {
  document.addEventListener(evt, (e) => {
    if (evt !== 'drop') e.preventDefault();
    e.stopPropagation();
    if (evt === 'drop') {
      dropOverlay.classList.remove('show');
      const dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) {
        if (!people.length) { alert('Pick a person first (click a card) then drop again.'); return; }
        if (!targetForSend) { alert('Click a person to target, then drop files.'); return; }
        sendFilesTo(targetForSend, Array.from(dt.files));
      }
    } else {
      // leave
      if (e.target === document || e.target === document.body) dropOverlay.classList.remove('show');
    }
  });
});

/* ========================================================
=  File Transfer (Socket.IO relay)
=  Local: 4MB chunks, Online: 64KB chunks
======================================================== */
const incoming = new Map(); // key = fromId|fileId -> { name, size, mime, parts:[], expected, received }

function chunkSize() { return MODE_LOCAL ? 4*MB : 64*KB; }

async function sendFilesTo(targetId, files) {
  const room = MODE_LOCAL ? null : (currentRoom || null);

  for (const file of files) {
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const cBytes = chunkSize();

    socket.emit('fileMeta', {
      targetId,
      room,
      fileId,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      chunkBytes: cBytes
    });

    // --- Progress UI ---
    const progressElem = document.createElement('div');
    progressElem.className = 'progressItem';
    progressElem.innerHTML = `
      <div><strong>${file.name}</strong> <span class="percent">0%</span> (<span class="speed">0 MB/s</span>)</div>
      <div class="barWrap"><div class="bar"></div></div>
    `;
    document.body.appendChild(progressElem); // You can append to a nicer container if you want
    const bar = progressElem.querySelector('.bar');
    const percentSpan = progressElem.querySelector('.percent');
    const speedSpan = progressElem.querySelector('.speed');

    let offset = 0;
    let seq = 0;
    let lastTime = Date.now();
    let bytesThisSecond = 0;

    while (offset < file.size) {
      const end = Math.min(offset + cBytes, file.size);
      const chunk = await file.slice(offset, end).arrayBuffer();

      socket.emit('fileChunk', { targetId, fileId, seq, chunk });

      offset = end;
      seq++;
      bytesThisSecond += chunk.byteLength;

      // --- Update progress ---
      const percent = ((offset / file.size) * 100).toFixed(1);
      bar.style.width = `${percent}%`;
      percentSpan.textContent = `${percent}%`;

      // Speed calc every second
      const now = Date.now();
      if (now - lastTime >= 1000) {
        const speedMBs = (bytesThisSecond / (1024 * 1024)).toFixed(2);
        speedSpan.textContent = `${speedMBs} MB/s`;
        bytesThisSecond = 0;
        lastTime = now;
      }

      // Small delay to prevent overload
      await new Promise(r => setTimeout(r, MODE_LOCAL ? 2 : 0));
    }

    socket.emit('fileComplete', { targetId, fileId });

    // Finalize
    bar.style.width = '100%';
    percentSpan.textContent = '100%';
    speedSpan.textContent = 'Done';
  }
}

    // slice & send
    let offset = 0, seq = 0;
    while (offset < file.size) {
      const end = Math.min(offset + cBytes, file.size);
      const chunk = await file.slice(offset, end).arrayBuffer();
      socket.emit('fileChunk', { targetId, fileId, seq, chunk });
      offset = end; seq++;
    }
    socket.emit('fileComplete', { targetId, fileId });
  }
}

/* Receiving */
socket.on('fileMeta', ({ fromId, fileId, name, size, mime, chunkBytes }) => {
  const key = `${fromId}|${fileId}`;
  incoming.set(key, { name, size, mime: mime || 'application/octet-stream', parts: [], received: 0 });
  // Optional: show toast
  appendMsg({ name: 'System', text: `Incoming: ${name} (${(size/MB).toFixed(2)} MB)` });
});

socket.on('fileChunk', ({ fromId, fileId, seq, chunk }) => {
  const key = `${fromId}|${fileId}`;
  const rec = incoming.get(key);
  if (!rec) return;
  rec.parts.push(new Uint8Array(chunk));
  rec.received += (chunk.byteLength || 0);
});

socket.on('fileComplete', ({ fromId, fileId }) => {
  const key = `${fromId}|${fileId}`;
  const rec = incoming.get(key);
  if (!rec) return;
  const blob = new Blob(rec.parts, { type: rec.mime });
  incoming.delete(key);

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = rec.name || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);

  appendMsg({ name: 'System', text: `Saved: ${rec.name}` });
});

/* ========================================================
=  Boot
======================================================== */
modeLabel.textContent = '🌐 Online Mode'; // default
peopleTitle.textContent = 'Members';

window.addEventListener('beforeunload', () => {
  if (MODE_LOCAL) socket.emit('leaveLocal');
});
