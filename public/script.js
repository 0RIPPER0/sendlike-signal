const socket = io();
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
const chatBox = document.getElementById("chatBox");
const chatToggleBtn = document.getElementById("chatToggleBtn");
const chatCloseBtn = document.getElementById("chatCloseBtn");
const chatNotifDot = document.getElementById("chatNotifDot");

let currentRoom = null;
let hostId = null;

modeSwitch.addEventListener("change", () => {
  modeLabel.textContent = modeSwitch.checked ? "📡 Local Mode" : "🌐 Online Mode";
});

createBtn.addEventListener("click", () => {
  const name = nameHost.value.trim();
  if (!name) return alert("Enter your name");
  socket.emit("createGroup", { name, ttlMinutes: 10 }, ({ code, hostId: hId }) => {
    currentRoom = code;
    hostId = hId;
    alert(`Group created! Code: ${code}`);
  });
});

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
  if (chatBox.style.display === "none") chatNotifDot.style.display = "block";
});

chatToggleBtn.addEventListener("click", () => {
  chatBox.style.display = "flex";
  chatNotifDot.style.display = "none";
});

chatCloseBtn.addEventListener("click", () => {
  chatBox.style.display = "none";
});

socket.on("updateMembers", (members) => {
  console.log("Members:", members);
});
// ================================
//  SPLASH SCREEN FADE
// ================================
window.addEventListener('load', () => {
  const landing = document.getElementById('landing');
  const container = document.querySelector('.container');

  setTimeout(() => {
    landing.style.opacity = '0';
    setTimeout(() => {
      landing.style.display = 'none';
      container.style.display = 'grid';
    }, 1000); // matches CSS transition time
  }, 2500); // delay before fade starts
});
socket.on("groupDisbanded", (reason) => {
  alert(`Group closed: ${reason}`);
  currentRoom = null;
  hostId = null;
});
