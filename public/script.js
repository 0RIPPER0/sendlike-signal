// ================================
//  SENDLIKE — CLIENT
// ================================

// ================================
//  SOCKET & STATE
// ================================
const socket = io();
let currentRoom = null;
let isHost = false;
let openShare = false;
let myDisplayName = "";
let joinClosesAt = 0;
let chatOpen = false;
let unread = 0;

// ================================
//  DOM REFERENCES
// ================================
const landing = document.getElementById("landing");
const container = document.querySelector(".container");

const modeSwitch = document.getElementById("modeSwitch");
const modeLabel = document.getElementById("modeLabel");

const createBtn = document.getElementById("createBtn");
const nameHost = document.getElementById("nameHost");
const hostControls = document.getElementById("hostControls");
const groupCodeEl = document.getElementById("groupCode");
const joinWindowInfo = document.getElementById("joinWindowInfo");
const openShareSwitch = document.getElementById("openShareSwitch");
const openShareLabel = document.getElementById("openShareLabel");
const disbandBtn = document.getElementById("disbandBtn");

const joinBtn = document.getElementById("joinBtn");
const nameOnline = document.getElementById("nameOnline");
const joinCode = document.getElementById("joinCode");

const membersEl = document.getElementById("members");

const chatBox = document.getElementById("chatBox");
const chatMessages = document.getElementById("chatMessages");
const chatInput = document.getElementById("chatInput");
const sendChatBtn = document.getElementById("sendChatBtn");
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifDot = document.getElementById("chatNotifDot");
const chatCloseBtn = document.getElementById("chatCloseBtn");

// ================================
//  UTILS (funny name, avatar color)
// ================================
const ADJ = ["Swift","Happy","Brave","Cosmic","Fuzzy","Mighty","Quiet","Zippy","Bubbly","Chill"];
const NOUN = ["Panda","Falcon","Otter","Phoenix","Badger","Koala","Eagle","Tiger","Llama","Whale"];
function funnyName() {
  return `${ADJ[Math.floor(Math.random()*ADJ.length)]} ${NOUN[Math.floor(Math.random()*NOUN.length)]}`;
}
function colorFromId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h} 80% 75%)`;
}
function formatTime(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleTimeString(); } catch { return ""; }
}
function resetState() {
  currentRoom = null;
  isHost = false;
  openShare = false;
  myDisplayName = "";
  joinClosesAt = 0;
  hostControls.style.display = "none";
  membersEl.innerHTML = "";
}

// ================================
//  LANDING / SPLASH
// ================================
function startLandingAnimation() {
  function loopPlane() {
    const plane = document.querySelector(".plane");
    const contrail = document.querySelector(".contrail");
    plane.style.animation = "none";
    contrail.style.animation = "none";
    // reflow to restart CSS animations
    // eslint-disable-next-line no-unused-expressions
    plane.offsetHeight; contrail.offsetHeight;
    plane.style.animation = "planeCurve 1.5s ease-in forwards";
    contrail.style.animation = "contrailFade 1.5s ease-in forwards";
  }
  loopPlane();
  const loop = setInterval(loopPlane, 4000);

  setTimeout(() => {
    landing.style.opacity = "0";
    setTimeout(() => {
      landing.style.display = "none";
      container.style.display = "grid";
      clearInterval(loop);
    }, 1000);
  }, 2200);
}
window.addEventListener("load", startLandingAnimation);

// ================================
//  MODE TOGGLE
// ================================
modeSwitch.addEventListener("change", () => {
  modeLabel.textContent = modeSwitch.checked ? "📡 Local Mode" : "🌐 Online Mode";
});

// ================================
//  CREATE GROUP
// ================================
createBtn.addEventListener("click", () => {
  const name = (nameHost.value || "").trim();
  myDisplayName = name || funnyName();

  socket.emit("createGroup", { name: myDisplayName }, (res) => {
    if (!res || !res.ok) return alert(res?.error || "Failed to create group");

    isHost = true;
    currentRoom = res.code;
    openShare = !!res.openShare;
    joinClosesAt = res.joinClosesAt || 0;

    hostControls.style.display = "block";
    groupCodeEl.textContent = currentRoom;
    updateOpenShareUI(openShare);
    joinWindowInfo.textContent = `• join open until ${formatTime(joinClosesAt)}`;

    alert(`Group created! Code: ${currentRoom}`);
  });
});

// ================================
//  HOST CONTROLS (OpenShare/Disband)
// ================================
openShareSwitch.addEventListener("change", () => {
  if (!isHost || !currentRoom) return;
  socket.emit("toggleOpenShare", { code: currentRoom, value: openShareSwitch.checked });
});
disbandBtn.addEventListener("click", () => {
  if (!isHost || !currentRoom) return;
  if (!confirm("Disband the group for everyone?")) return;
  socket.emit("disbandGroup", { code: currentRoom });
});
function updateOpenShareUI(value) {
  openShareSwitch.checked = !!value;
  openShareLabel.textContent = `OpenShare: ${value ? "ON" : "OFF"}`;
}

// ================================
//  JOIN GROUP
// ================================
joinBtn.addEventListener("click", () => {
  const name = (nameOnline.value || "").trim();
  const code = (joinCode.value || "").trim();
  if (!code) return alert("Enter the 6-digit group code");

  myDisplayName = name || funnyName();

  socket.emit("joinGroup", { name: myDisplayName, code }, (res) => {
    if (!res || !res.ok) return alert(res?.error || "Failed to join");

    isHost = socket.id === res.hostId;
    currentRoom = code;
    openShare = !!res.openShare;
    joinClosesAt = res.joinClosesAt || 0;

    if (isHost) hostControls.style.display = "block";
    updateOpenShareUI(openShare);

    alert(`Joined group: ${code}`);
  });
});

// ================================
//  MEMBERS LIST (render)
// ================================
socket.on("updateMembers", (members) => {
  membersEl.innerHTML = "";
  members.forEach((m) => {
    const card = document.createElement("div");
    card.className = "member";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.background = colorFromId(m.id);
    avatar.textContent = (m.name || "?").split(/\s+/).map(s => s[0] || "").join("").slice(0,2).toUpperCase();

    const name = document.createElement("div");
    name.textContent = m.name || "Anonymous";

    card.appendChild(avatar);
    card.appendChild(name);
    membersEl.appendChild(card);
  });
});

// ================================
//  CHAT: UI (open/close)
// ================================
function openChat() {
  chatBox.style.display = "block";
  chatOpen = true;
  unread = 0;
  chatNotifDot.style.display = "none";
  chatInput.focus();
}
function closeChat() {
  chatBox.style.display = "none";
  chatOpen = false;
}
chatToggleBtn.addEventListener("click", () => (chatOpen ? closeChat() : openChat()));
chatCloseBtn.addEventListener("click", closeChat);

// ================================
//  CHAT: SEND / RECEIVE
// ================================
sendChatBtn.addEventListener("click", sendChat);
chatInput.addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });

function sendChat() {
  const text = (chatInput.value || "").trim();
  if (!text || !currentRoom) return;
  socket.emit("chat", { room: currentRoom, name: myDisplayName, text });
  chatInput.value = "";
}

socket.on("chat", ({ name, text, ts }) => {
  const line = document.createElement("div");
  const time = ts ? new Date(ts).toLocaleTimeString() : "";
  line.textContent = `[${time}] ${name}: ${text}`;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!chatOpen) {
    unread += 1;
    chatNotifDot.style.display = "block";
  }
});

socket.on("openShare", (value) => updateOpenShareUI(value));

// ================================
//  GROUP DISBANDED
// ================================
socket.on("groupDisbanded", (reason) => {
  alert(`Group closed: ${reason}`);
  resetState();
});

// ================================
//  ABOUT
// ================================
window.showAbout = function () {
  alert("SendLike — Simple groups with chat. Join allowed for 10 minutes after host creates the group. OpenShare lets everyone send (coming soon).");
};
