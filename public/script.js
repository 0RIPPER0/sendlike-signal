// ================================
//  CLIENT-SIDE SCRIPT
// ================================
const socket = io();

// --- DOM Elements ---
const modeSwitch = document.getElementById("modeSwitch");
const modeLabel = document.getElementById("modeLabel");

const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const sendChatBtn = document.getElementById("sendChatBtn");

const nameOnline = document.getElementById("nameOnline");
const joinCode = document.getElementById("joinCode");
const nameHost = document.getElementById("nameHost");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");

const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatNotifDot = document.getElementById("chatNotifDot");
const chatBox = document.getElementById("chatBox");
const chatCloseBtn = document.getElementById("chatCloseBtn");

let currentRoom = null;
let hostId = null;
let chatOpen = false;

// ================================
//  SPLASH / LANDING SCREEN
// ================================
window.addEventListener("load", () => {
  const landing = document.getElementById("landing");
  const container = document.querySelector(".container");

  setTimeout(() => {
    landing.classList.add("fade-out");
    setTimeout(() => {
      landing.style.display = "none";
      container.style.display = "grid";
    }, 1000);
  }, 2500);
});

// ================================
//  MODE SWITCH
// ================================
modeSwitch.addEventListener("change", () => {
  modeLabel.textContent = modeSwitch.checked
    ? "📡 Local Mode"
    : "🌐 Online Mode";
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
  });
});

// ================================
//  CHAT MESSAGES
// ================================
sendChatBtn.addEventListener("click", () => {
  const text = chatInput.value.trim();
  if (!text || !currentRoom) return;

  socket.emit("chat", { room: currentRoom, name: nameOnline.value || nameHost.value, text });
  chatInput.value = "";
});

socket.on("chat", ({ name, text }) => {
  const msg = document.createElement("div");
  msg.textContent = `${name}: ${text}`;
  chatMessages.appendChild(msg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  if (!chatOpen) {
    chatNotifDot.style.display = "block";
  }
});

// ================================
//  FLOATING CHAT BUTTON
// ================================
chatToggleBtn.addEventListener("click", () => {
  chatOpen = !chatOpen;
  chatBox.style.display = chatOpen ? "flex" : "none";

  if (chatOpen) {
    chatNotifDot.style.display = "none";
  }
});

chatCloseBtn.addEventListener("click", () => {
  chatOpen = false;
  chatBox.style.display = "none";
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
  currentRoom = null;
  hostId = null;
  chatMessages.innerHTML = "";
});
