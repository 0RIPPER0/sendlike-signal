/**
 * ======================================================
 *  SendLike — Client script
 *  - Landing splash fade
 *  - Mode label toggle
 *  - Create / Join groups (10 min join window)
 *  - Live member list
 *  - Floating chat (with red dot when minimized)
 *  - OpenShare + Disband controls (host-only)
 * ======================================================
 */
(() => {
  // ---------- SOCKET ----------
  const socket = io();

  // ---------- DOM HOOKS ----------
  const landing = document.getElementById("landing");
  const container = document.querySelector(".container");

  // mode
  const modeSwitch = document.getElementById("modeSwitch");
  const modeLabel = document.getElementById("modeLabel");

  // create
  const nameHost = document.getElementById("nameHost");
  const createBtn = document.getElementById("createBtn");

  // join
  const nameOnline = document.getElementById("nameOnline");
  const joinCode = document.getElementById("joinCode");
  const joinBtn = document.getElementById("joinBtn");

  // host controls (must exist in your HTML)
  const hostControls = document.getElementById("hostControls");     // wrapper (display: none/block)
  const groupCodeEl = document.getElementById("groupCodeEl");       // shows code
  const joinExpiryEl = document.getElementById("joinExpiryEl");     // shows time
  const openShareToggle = document.getElementById("openShareToggle");
  const disbandBtn = document.getElementById("disbandBtn");

  // members
  const membersList = document.getElementById("membersList");

  // chat
  const chatToggleBtn = document.getElementById("chatToggleBtn");
  const chatNotifDot = document.getElementById("chatNotifDot");
  const chatBox = document.getElementById("chatBox");
  const chatCloseBtn = document.getElementById("chatCloseBtn");
  const chatMessages = document.getElementById("chatMessages");
  const chatInput = document.getElementById("chatInput");
  const sendChatBtn = document.getElementById("sendChatBtn");

  // ---------- STATE ----------
  let currentRoom = null;
  let hostId = null;
  let myName = "";
  let isHost = false;

  // ----------------------------------------------------
  //  LANDING SPLASH
  // ----------------------------------------------------
  window.addEventListener("load", () => {
    // fade after a short delay
    setTimeout(() => {
      landing.style.opacity = "0";
      setTimeout(() => {
        landing.style.display = "none";
        container.style.display = "grid";
      }, 600);
    }, 2000);
  });

  // ----------------------------------------------------
  //  MODE LABEL
  // ----------------------------------------------------
  if (modeSwitch && modeLabel) {
    modeSwitch.addEventListener("change", () => {
      modeLabel.textContent = modeSwitch.checked ? "📡 Local Mode" : "🌐 Online Mode";
    });
  }

  // ----------------------------------------------------
  //  UTILS
  // ----------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, "0");

  function formatTime(ms) {
    const d = new Date(ms);
    const hh = d.getHours();
    const mm = pad2(d.getMinutes());
    const ss = pad2(d.getSeconds());
    const hour12 = ((hh + 11) % 12) + 1;
    const ampm = hh >= 12 ? "PM" : "AM";
    return `${hour12}:${mm}:${ss} ${ampm}`;
  }

  function renderMembers(members = []) {
    if (!membersList) return;
    membersList.innerHTML = "";
    members.forEach((m) => {
      const chip = document.createElement("div");
      chip.className = "member-chip";
      const initials = (m.name || "?")
        .split(" ")
        .map((s) => s[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();

      chip.innerHTML = `
        <div class="avatar">${initials}</div>
        <div class="name">${m.name}</div>
      `;
      membersList.appendChild(chip);
    });
  }

  function appendChat({ name, text, ts }) {
    const row = document.createElement("div");
    row.className = "chat-row";
    const time = ts ? new Date(ts) : new Date();
    row.innerHTML = `<span class="who">${name}</span><span class="what">${text}</span><span class="when">${time.toLocaleTimeString()}</span>`;
    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // red dot when minimized
    if (chatBox.classList.contains("hidden")) {
      chatNotifDot.style.display = "block";
    }
  }

  function setHostUI({ code, joinOpenUntil, openShare }) {
    if (!hostControls) return;
    hostControls.style.display = "block";
    if (groupCodeEl) groupCodeEl.textContent = code;
    if (joinExpiryEl) joinExpiryEl.textContent = formatTime(joinOpenUntil);
    if (openShareToggle) openShareToggle.checked = !!openShare;
    // put code into join field for convenience
    if (joinCode) joinCode.value = code;
  }

  function resetAll() {
    currentRoom = null;
    hostId = null;
    myName = "";
    isHost = false;
    if (hostControls) hostControls.style.display = "none";
    if (membersList) membersList.innerHTML = "";
    if (chatMessages) chatMessages.innerHTML = "";
    if (chatNotifDot) chatNotifDot.style.display = "none";
  }

  // ----------------------------------------------------
  //  CREATE GROUP
  // ----------------------------------------------------
  if (createBtn) {
    createBtn.addEventListener("click", () => {
      myName = (nameHost?.value || "").trim() || "Host";
      socket.emit("createGroup", { name: myName }, (res) => {
        if (!res || !res.ok) {
          alert(res?.error || "Failed to create group.");
          return;
        }
        currentRoom = res.code;
        hostId = res.hostId;
        isHost = true;

        setHostUI({
          code: res.code,
          joinOpenUntil: res.joinOpenUntil,
          openShare: res.openShare,
        });

        renderMembers(res.members || []);
        (res.chat || []).forEach(appendChat);
      });
    });
  }

  // ----------------------------------------------------
  //  JOIN GROUP
  // ----------------------------------------------------
  if (joinBtn) {
    joinBtn.addEventListener("click", () => {
      myName = (nameOnline?.value || "").trim() || "Guest";
      const code = (joinCode?.value || "").trim();
      if (!code) return alert("Enter the 6-digit code.");

      socket.emit("joinGroup", { name: myName, code }, (res) => {
        if (!res || res.error) {
          alert(res?.error || "Failed to join.");
          return;
        }
        currentRoom = code;
        hostId = res.hostId;
        isHost = socket.id === hostId;

        renderMembers(res.members || []);
        chatMessages.innerHTML = "";
        (res.chat || []).forEach(appendChat);
        if (typeof res.openShare === "boolean" && openShareToggle) {
          openShareToggle.checked = res.openShare;
        }
      });
    });
  }

  // ----------------------------------------------------
  //  HOST CONTROLS
  // ----------------------------------------------------
  if (openShareToggle) {
    openShareToggle.addEventListener("change", () => {
      if (!isHost || !currentRoom) return;
      socket.emit("toggleOpenShare", { code: currentRoom, value: openShareToggle.checked });
    });
  }

  if (disbandBtn) {
    disbandBtn.addEventListener("click", () => {
      if (!isHost || !currentRoom) return;
      if (confirm("Disband this group for everyone?")) {
        socket.emit("disbandGroup", currentRoom);
      }
    });
  }

  // ----------------------------------------------------
  //  CHAT UI
  // ----------------------------------------------------
  if (chatToggleBtn) {
    chatToggleBtn.addEventListener("click", () => {
      chatBox.classList.remove("hidden");
      chatNotifDot.style.display = "none";
    });
  }
  if (chatCloseBtn) {
    chatCloseBtn.addEventListener("click", () => {
      chatBox.classList.add("hidden");
    });
  }

  function sendChat() {
    const text = (chatInput?.value || "").trim();
    if (!text || !currentRoom) return;
    socket.emit("chat", { room: currentRoom, name: myName || "Me", text });
    chatInput.value = "";
  }
  if (sendChatBtn) sendChatBtn.addEventListener("click", sendChat);
  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendChat();
    });
  }

  // ----------------------------------------------------
  //  SOCKET EVENTS
  // ----------------------------------------------------
  // members roster
  socket.on("updateMembers", (members) => renderMembers(members || []));

  // chat message (includes sender)
  socket.on("chat", (msg) => appendChat(msg));

  // host toggled openShare
  socket.on("openShareUpdated", (value) => {
    if (openShareToggle) openShareToggle.checked = !!value;
  });

  // join window closed (informational)
  socket.on("joinWindowClosed", () => {
    if (currentRoom && !isHost) return; // members don’t need the banner
    // You can show a soft note in UI if you want
    console.log("Join window closed for this group.");
  });

  // group disbanded
  socket.on("groupDisbanded", (reason) => {
    alert(`Group closed: ${reason}`);
    resetAll();
  });
})();
