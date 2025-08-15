// ================================
//  CLIENT-SIDE SCRIPT
// ================================
const socket = io();

// --- DOM Elements ---
const modeSwitch = document.getElementById("modeSwitch");
const joinBtn = document.getElementById("joinBtn");
const createBtn = document.getElementById("createBtn");
const sendChatBtn = document.getElementById("sendChatBtn");

const nameOnline = document.getElementById("nameOnline");
const joinCode = document.getElementById("joinCode");
const nameHost = document.getElementById("nameHost");
const chatInput = document.getElementById("chatInput");
const chatMessages = document.getElementById("chatMessages");
const chatSection = document.getElementById("chatSection");

let currentRoom = null;
let hostId = null;

// ================================
//  MODE SWITCH
// ================================
modeSwitch.addEventListener("change", () => {
  modeSwitch.previousSibling.textContent = modeSwitch.checked
    ? "📡 Local Mode "
    : "🌐 Online Mode ";
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
    chatSection.style.display = "block";
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
    chatSection.style.display = "block";
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
  chatSection.style.display = "none";
  currentRoom = null;
  hostId = null;
});
