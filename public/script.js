// ================================
//  CLIENT-SIDE SCRIPT
// ================================
const socket = io();

// --- DOM Elements ---
const modeSwitch = document.getElementById("modeSwitch");
const modeLabel = document.getElementById("modeLabel");

const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");

const nameOnline = document.getElementById("nameOnline");
const joinCode = document.getElementById("joinCode");
const nameHost = document.getElementById("nameHost");

const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");

const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifDot = document.getElementById("chatNotifDot");
const chatBox = document.getElementById("chatBox");

const sendChatBtn = document.getElementById("sendChatBtn");

let currentRoom = null;
let hostId = null;
let chatOpen = false;

// ================================
//  MODE SWITCH
// ================================
modeSwitch.addEventListener("change", () => {
  modeLabel.textContent = modeSwitch.checked
    ? "모 Local Mode"
    : "ᯤ Online Mode";
});

// ================================
//  CREATE GROUP
// ================================
createBtn.addEventListener("click", () => {
  const name = nameHost.value.trim();
  if (!name) return alert("Enter your name");

  socket.emit("createGroup", { name, ttlMinutes: 10 }, ({ code, hostId: hId }) => {
    currentRoom = code;
    hostId = hId;
    alert(`Group created! Code: ${code}`);
    openChat();
  });
});

// ================================
//  JOIN GROUP
// ================================
joinBtn.addEventListener("click", () => {
  const name = nameOnline.value.trim();
  const code = joinCode.value.trim();
  if (!name || !code) return alert("Enter name and code");

  socket.emit("joinGroup", { name, code }, (res) => {
    if (res.error) return alert(res.error);

    currentRoom = code;
    hostId = res.hostId;
    alert(`Joined group: ${code}`);
    openChat();
  });
});

// ================================
//  SEND CHAT MESSAGE
// ================================
sendChatBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text || !currentRoom) return;

  const name = nameOnline.value || nameHost.value;
  socket.emit("chat", { room: currentRoom, name, text });
  chatInput.value = "";
});

// ================================
//  RECEIVE CHAT MESSAGE
// ================================
socket.on("chat", ({ name, text }) => {
  const msg = document.createElement("div");
  msg.textContent = `${name}: ${text}`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!chatOpen) {
    chatNotifDot.style.display = "block"; // Show red dot if chat closed
  }
});

// ================================
//  UPDATE MEMBERS LIST
// ================================
socket.on("updateMembers", (members) => {
  console.log("Members:", members);
});

// ================================
//  GROUP DISBANDED
// ================================
socket.on("groupDisbanded", (reason) => {
  alert(`Group closed: ${reason}`);
  closeChat();
  currentRoom = null;
  hostId = null;
});

// ================================
//  CHAT TOGGLE LOGIC
// ================================
chatToggleBtn.addEventListener("click", () => {
  if (chatOpen) {
    closeChat();
  } else {
    openChat();
  }
});

function openChat() {
  chatBox.style.display = "flex";
  chatNotifDot.style.display = "none";
  chatOpen = true;
}

function closeChat() {
  chatBox.style.display = "none";
  chatOpen = false;
}
