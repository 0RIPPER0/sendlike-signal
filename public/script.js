/* =========================================================
=  SendLike — Client (Landing + Join/Create + Members + Chat)
=  Compatible with your server socket API
========================================================= */

// ------------------------------
// Socket
// ------------------------------
const socket = io(); // uses same origin

// ------------------------------
// Elements
// ------------------------------
const app           = document.getElementById('app');
const landing       = document.getElementById('landing');
const modeSwitch    = document.getElementById('modeSwitch');
const modeLabel     = document.getElementById('modeLabel');
const aboutBtn      = document.getElementById('aboutBtn');

const nameOnline    = document.getElementById('nameOnline');
const joinCodeInput = document.getElementById('joinCode');
const joinBtn       = document.getElementById('joinBtn');

const nameHost      = document.getElementById('nameHost');
const createBtn     = document.getElementById('createBtn');

const sessionInfo   = document.getElementById('sessionInfo');
const sessionStatus = document.getElementById('sessionStatus');
const sessionCode   = document.getElementById('sessionCode');
const sessionRole   = document.getElementById('sessionRole');
const disbandBtn    = document.getElementById('disbandBtn');

const membersList   = document.getElementById('membersList');

const chatFab       = document.getElementById('chatToggleBtn');
const chatDot       = document.getElementById('chatNotifDot');
const chatBox       = document.getElementById('chatBox');
const chatClose     = document.getElementById('chatCloseBtn');
const chatMessages  = document.getElementById('chatMessages');
const chatInput     = document.getElementById('chatInput');
const sendChatBtn   = document.getElementById('sendChatBtn');

// ------------------------------
// State
// ------------------------------
let currentRoom = null;
let hostId = null;
let isHost = false;
let myName = '';
let members = []; // [{id,name}]

// ------------------------------
// Utilities
// ------------------------------
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
}
function renderMembers(list) {
  membersList.innerHTML = '';
  list.forEach(m => {
    const card = document.createElement('div');
    card.className = 'member';
    const av = document.createElement('div');
    av.className = 'avatar';
    av.textContent = (m.name || '?').trim().charAt(0).toUpperCase() || '?';
    const nm = document.createElement('div');
    nm.textContent = m.name || '—';
    nm.style.fontSize = '.9rem';
    nm.style.color = 'var(--text)';
    nm.style.fontWeight = 600;
    card.appendChild(av);
    card.appendChild(nm);
    membersList.appendChild(card);
  });
}
function appendMsg({ you = false, name, text }) {
  const line = document.createElement('div');
  line.className = 'msg' + (you ? ' you' : '');
  line.textContent = `${name}: ${text}`;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatBox.style.display !== 'block') chatDot.hidden = false; // unread indicator
}

// ------------------------------
// Landing (robust fade + plane loop)
// ------------------------------
function startLanding() {
  loopPlane();
  setTimeout(() => {
    landing.classList.add('hidden');
  }, 2500);
  landing.addEventListener('transitionend', () => {
    landing.style.display = 'none';
    app.hidden = false;
  }, { once: true });
}
function loopPlane() {
  const plane = landing.querySelector('.plane');
  const trail = landing.querySelector('.contrail');
  plane.style.animation = 'none';
  trail.style.animation = 'none';
  void plane.offsetWidth; void trail.offsetWidth;
  plane.style.animation = 'planeCurve 1.5s ease-in forwards';
  trail.style.animation = 'contrailFade 1.5s ease-in forwards';
  setTimeout(loopPlane, 3800);
}

// ------------------------------
// Header actions
// ------------------------------
aboutBtn.addEventListener('click', () => {
  alert('SendLike — Simple group sharing via code or local network.');
});

// ------------------------------
// Mode toggle
// ------------------------------
modeSwitch.addEventListener('change', () => {
  modeLabel.textContent = modeSwitch.checked ? '📡 Local Mode' : '🌐 Online Mode';
});

// ------------------------------
// Create Group
// ------------------------------
createBtn.addEventListener('click', () => {
  const name = safeName(nameHost.value);
  if (!name) return alert('Enter your name');

  myName = name;
  socket.emit('createGroup', { name, ttlMinutes: 10 }, ({ code, hostId: hId }) => {
    currentRoom = code;
    hostId = hId;
    isHost = true;
    //joinCodeInput.value = code;
    setSessionUI({ code, roleText: 'Host', statusText: 'Active' });
  });
});

// ------------------------------
// Join Group
// ------------------------------
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
    setSessionUI({ code, roleText: 'Member', statusText: 'Active' });
  });
});

// ------------------------------
// Disband Group
// ------------------------------
disbandBtn.addEventListener('click', () => {
  if (!isHost || !currentRoom) return;
  socket.emit('disbandGroup', currentRoom);
});

// ------------------------------
// Chat toggle
// ------------------------------
chatFab.addEventListener('click', () => {
  chatBox.style.display = chatBox.style.display === 'block' ? 'none' : 'block';
  if (chatBox.style.display === 'block') chatDot.hidden = true;
});
chatClose.addEventListener('click', () => {
  chatBox.style.display = 'none';
});

// ------------------------------
// Send Chat (echo to self immediately)
// ------------------------------
function sendChat() {
  const text = (chatInput.value || '').trim();
  if (!text || !currentRoom) return;
  appendMsg({ you: true, name: myName || 'Me', text });
  socket.emit('chat', { room: currentRoom, name: myName || 'Guest', text });
  chatInput.value = '';
}
sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendChat();
});

// ------------------------------
// Socket events
// ------------------------------
socket.on('updateMembers', (list) => {
  members = Array.isArray(list) ? list : [];
  renderMembers(members);
});

socket.on('chat', ({ name, text }) => {
  if (name === myName) return; // Skip own messages
  appendMsg({ name: name || 'Guest', text: text || '' });
});

socket.on('groupDisbanded', (reason) => {
  alert(`Group closed: ${reason || 'Closed'}`);
  currentRoom = null;
  hostId = null;
  isHost = false;
  sessionInfo.hidden = true;
  disbandBtn.hidden = true;
  members = [];
  renderMembers(members);
});

// ------------------------------
// Boot
// ------------------------------
window.addEventListener('load', startLanding);
