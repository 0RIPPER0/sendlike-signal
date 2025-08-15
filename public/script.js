// SendLike — PWA UI + Local/Online toggle + WebRTC DC + Chat + Sounds
const VERSION = "1.0.0";
const socket = io();

let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); deferredPrompt = e;
  const btn = document.getElementById('installBtn'); btn.classList.remove('hidden');
  btn.onclick = async () => { btn.classList.add('hidden'); deferredPrompt.prompt(); deferredPrompt = null; };
});

// About modal
const aboutBtn = document.getElementById('aboutBtn');
const aboutModal = document.getElementById('aboutModal');
const aboutClose = document.getElementById('aboutClose');
const okAbout = document.getElementById('okAbout');
document.getElementById('ver').textContent = VERSION;
[aboutBtn, document.getElementById('cornerRocket')].forEach(el => el.onclick = ()=>aboutModal.classList.remove('hidden'));
[aboutClose, okAbout].forEach(el => el.onclick = ()=>aboutModal.classList.add('hidden'));

// Typewriter tagline
const TL = "Fast Enough to Make Wi-Fi Blush… Because Your Files Deserve a First-Class Trip. 📶😳🛫📂";
function typeTagline(){ const el = document.getElementById('tagline'); el.textContent=""; let i=0; (function tick(){ if (i<=TL.length){ el.textContent = TL.slice(0,i++); setTimeout(tick,14);} })(); }
typeTagline();

// SPA nav
document.getElementById('startApp').onclick = () => { document.querySelector('.landing').classList.add('hidden'); document.getElementById('app').classList.remove('hidden'); };
document.getElementById('howWorks').onclick = () => document.getElementById('howSection').classList.toggle('hidden');

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
function shortId(id){ return (id||"").slice(0,6).toUpperCase(); }

// ---------- WebRTC base ----------
const peers = {}; const channels = {};
function ensurePeer(targetId){
  if (peers[targetId]) return peers[targetId];
  const pc = new RTCPeerConnection({ iceServers: [] }); // LAN-first
  peers[targetId] = pc;
  if (socket.id < targetId) { const ch = pc.createDataChannel("file"); setupChannel(targetId, ch); }
  pc.ondatachannel = (e) => setupChannel(targetId, e.channel);
  pc.onicecandidate = (e) => { if (e.candidate) socket.emit("signal", { targetId, data:{ candidate: e.candidate }}); };
  return pc;
}
function setupChannel(targetId, channel){
  channels[targetId] = channel; channel.binaryType = "arraybuffer";
  channel.onopen = ()=>console.log("DC open", targetId);
  channel.onclose = ()=>console.log("DC close", targetId);
  let incoming = null;
  channel.onmessage = (e)=>{
    if (typeof e.data === "string"){
      const meta = JSON.parse(e.data);
      if (meta.type==="meta"){
        incoming = { name: meta.name, size: meta.size, chunks: [], received: 0, scope: meta.scope };
        showProgress(meta.scope, `Receiving ${meta.name}`, 0, 0, meta.size);
        playReceive();
      }
    } else {
      if (!incoming) return;
      incoming.chunks.push(e.data);
      incoming.received += e.data.byteLength;
      showProgress(incoming.scope, `Receiving ${incoming.name}`, incoming.received/incoming.size*100, incoming.received, incoming.size);
      if (incoming.received >= incoming.size){
        const blob = new Blob(incoming.chunks); const url = URL.createObjectURL(blob);
        const a=document.createElement('a'); a.href=url; a.download=incoming.name; a.click(); hideProgress(incoming.scope); incoming=null;
      }
    }
  };
}
socket.on("signal", async ({ from, data }) => {
  const pc = ensurePeer(from);
  if (data.desc){ await pc.setRemoteDescription(data.desc);
    if (data.desc.type==="offer"){ const answer=await pc.createAnswer(); await pc.setLocalDescription(answer);
      socket.emit("signal", { targetId: from, data:{ desc: pc.localDescription }}); } }
  else if (data.candidate){ try{ await pc.addIceCandidate(data.candidate);}catch(e){console.warn(e);} }
});
async function connectTo(targetId){ const pc = ensurePeer(targetId); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); socket.emit("signal", { targetId, data:{ desc: pc.localDescription }}); }

// ---------- Online (code) ----------
let group = { code:null, isHost:false, expiresAt:0, members:[] };
const peersOnline = $("peersOnline");
function renderOnlinePeers(){
  peersOnline.innerHTML = "";
  group.members.forEach(m => {
    const d = document.createElement('div'); d.className="peer"+(m.id===socket.id?" me":""); d.dataset.id=m.id;
    d.innerHTML = `<div>${(m.name||"?").slice(0,1).toUpperCase()}</div><div class="name">${m.name} (${shortId(m.id)})</div>`;
    d.addEventListener("dragenter", e=>{e.preventDefault(); d.classList.add("drop");});
    d.addEventListener("dragover", e=>e.preventDefault());
    d.addEventListener("dragleave", ()=>d.classList.remove("drop"));
    d.addEventListener("drop", e=>{ e.preventDefault(); d.classList.remove("drop"); const f=e.dataTransfer?.files?.[0]; if(f) sendFile([m.id], f, "online"); });
    d.addEventListener("click", async ()=>{ if (m.id!==socket.id) await connectTo(m.id); });
    peersOnline.appendChild(d);
  });
  group.members.forEach(m => { if (m.id!==socket.id && !peers[m.id]) connectTo(m.id); });
}
function formatTime(ts){ if(!ts) return "no limit"; const left=ts-Date.now(); if(left<=0) return "expired"; const m=Math.floor(left/60000), s=Math.floor((left%60000)/1000); return `${m}:${String(s).padStart(2,"0")} left`; }
$("createBtn").onclick = () => {
  const name = $("nameOnline").value.trim(); if (!name) return alert("Enter your name");
  const ttlMinutes = parseInt(localStorage.getItem("ttl") || $("ttlSelect").value,10);
  group.isHost = true;
  socket.emit("createGroup",{name, ttlMinutes}, ({code,expiresAt})=>{
    group.code=code; group.expiresAt=expiresAt; $("groupCode").textContent=code;
    $("expires").textContent = ttlMinutes ? "Expires in "+formatTime(expiresAt) : "Unlimited";
    $("groupArea").classList.remove("hidden"); $("disband").classList.remove("hidden");
    $("onlineInfo").textContent = "Share the code with friends to join."; localStorage.setItem("lastMode","online");
    joinChatRoom(code, name);
  });
};
$("joinBtn").onclick = () => {
  const name = $("nameOnline").value.trim(); const code = $("joinCode").value.trim();
  if(!name || !code) return alert("Enter name and code");
  socket.emit("joinGroup",{name, code}, (res)=>{
    if(res?.error) return alert(res.error);
    group.code=code; group.expiresAt=res.expiresAt; group.isHost=false;
    $("groupCode").textContent=code; $("expires").textContent = res.expiresAt ? "Expires in "+formatTime(res.expiresAt) : "Unlimited";
    $("groupArea").classList.remove("hidden"); $("disband").classList.add("hidden"); $("onlineInfo").textContent="Connected."; localStorage.setItem("lastMode","online");
    joinChatRoom(code, name);
  });
};
socket.on("updateMembers", (list)=>{ group.members=list; renderOnlinePeers(); });
$("disband").onclick = ()=> socket.emit("disbandGroup", group.code);
socket.on("groupDisbanded", (reason="Group closed")=>{ $("disbandReason").textContent=reason; $("disbanded").classList.remove("hidden"); $("app").classList.add("hidden"); });

// Online send
$("sendAll").onclick = () => {
  const f = $("fileOnline").files[0]; if(!f) return alert("Choose a file");
  const targets = group.members.filter(m=>m.id!==socket.id).map(m=>m.id);
  sendFile(targets, f, "online");
};
document.addEventListener("dragover", e=>e.preventDefault());
document.addEventListener("drop", e=>{
  const f = e.dataTransfer?.files?.[0];
  const onlineVisible = !document.getElementById('onlinePanel').classList.contains('hidden');
  if (f && onlineVisible && group.code){
    const targets = group.members.filter(m => m.id !== socket.id).map(m => m.id);
    sendFile(targets, f, "online");
  }
});

// ---------- Local (auto-discovery) ----------
let localState = { roster: [] };
const peersLocal = $("peersLocal");
function cuteName(){
  const adj=["Golden","Sunny","Peachy","Bouncy","Chill","Lucky","Happy","Swift","Minty","Cozy","Snappy","Jazzy"];
  const nouns=["Mango","Panda","Tiger","Dolphin","Falcon","Owl","Otter","Koala","Yak","Robin","Lynx","Orca"];
  return `${adj[Math.floor(Math.random()*adj.length)]} ${nouns[Math.floor(Math.random()*nouns.length)]}`;
}
function renderLocalPeers(){
  peersLocal.innerHTML = "";
  localState.roster.forEach(p=>{
    const d=document.createElement('div'); d.className="peer"+(p.id===socket.id?" me":""); d.dataset.id=p.id;
    d.innerHTML = `<div>${(p.name||"?").slice(0,1).toUpperCase()}</div><div class="name">${p.name} (${shortId(p.id)})</div>`;
    d.addEventListener("dragenter", e=>{e.preventDefault(); d.classList.add("drop");});
    d.addEventListener("dragover", e=>e.preventDefault());
    d.addEventListener("dragleave", ()=>d.classList.remove("drop"));
    d.addEventListener("drop", e=>{ e.preventDefault(); d.classList.remove("drop"); const f=e.dataTransfer?.files?.[0]; if(f) sendFile([p.id], f, "local"); });
    d.addEventListener("click", async ()=>{ if (p.id!==socket.id) await connectTo(p.id); });
    peersLocal.appendChild(d);
  });
  localState.roster.forEach(p=>{ if (p.id!==socket.id && !peers[p.id]) connectTo(p.id); });
}
$("enterLocal").onclick = () => {
  const name = $("nameLocal").value.trim() || cuteName(); $("nameLocal").value = name;
  socket.emit("enterLocal", name);
  $("enterLocal").classList.add("hidden"); $("leaveLocal").classList.remove("hidden");
  $("localArea").classList.remove("hidden"); $("localInfo").textContent="Discovering devices on LAN...";
  localStorage.setItem("lastMode","local");
  joinChatRoom("local", name);
};
$("leaveLocal").onclick = () => {
  socket.emit("leaveLocal"); $("enterLocal").classList.remove("hidden"); $("leaveLocal").classList.add("hidden");
  $("localArea").classList.add("hidden"); $("localInfo").textContent="Devices on this Wi-Fi will appear below.";
};
socket.on("localRoster", (roster)=>{ localState.roster = roster; renderLocalPeers(); });

$("sendAllLocal").onclick = ()=>{
  const f = $("fileLocal").files[0]; if(!f) return alert("Choose a file");
  const targets = localState.roster.filter(p=>p.id!==socket.id).map(p=>p.id);
  sendFile(targets, f, "local");
};

// ---------- Send + Progress + Sounds ----------
function showProgress(scope, title, pct, bytes, total=0){
  const wrap = scope==="online" ? $("progressWrap") : $("progressWrapLocal");
  const bar  = scope==="online" ? $("progressBar")  : $("progressBarLocal");
  const t    = scope==="online" ? $("progressTitle"): $("progressTitleLocal");
  const s    = scope==="online" ? $("speedLine")    : $("speedLineLocal");
  const runway = scope==="online" ? $("jet") : $("jetLocal");
  wrap.classList.remove("hidden"); bar.style.width = `${Math.max(0,Math.min(100,pct)).toFixed(1)}%`; t.textContent = title;
  if (total) s.textContent = `${fmt(bytes)} / ${fmt(total)}`;
  if (pct===0){ runway.classList.remove("takeoff"); void runway.offsetWidth; runway.classList.add("takeoff"); rocketAcross(); }
}
function hideProgress(scope){ (scope==="online" ? $("progressWrap") : $("progressWrapLocal")).classList.add("hidden"); }
function fmt(b){ if (b<1024) return b+" B"; const u=["KB","MB","GB","TB"]; let i=-1; do{ b/=1024; i++; } while(b>=1024 && i<u.length-1); return b.toFixed(1)+" "+u[i]; }

function rocketAcross(){
  const r = document.createElement('div'); r.textContent="🚀"; r.style.position="fixed"; r.style.left="-40px"; r.style.top="30%"; r.style.fontSize="28px"; r.style.transition="transform 1.6s ease-in-out"; r.style.zIndex="9999";
  document.body.appendChild(r); requestAnimationFrame(()=>{ r.style.transform = `translateX(${window.innerWidth+80}px)`; });
  setTimeout(()=>r.remove(), 1700);
}

function playSend(){
  try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(), g=ctx.createGain();
    o.type="triangle"; o.frequency.setValueAtTime(440, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(880, ctx.currentTime+.15);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.04, ctx.currentTime+.05); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+.25);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+.26);}catch{}
}
function playReceive(){
  try{ const ctx=new (window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(), g=ctx.createGain();
    o.type="sine"; o.frequency.setValueAtTime(660, ctx.currentTime); o.frequency.exponentialRampToValueAtTime(330, ctx.currentTime+.2);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime+.05); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+.28);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime+.3);}catch{}
}

function sendFile(targetIds, file, scope){
  const outs = targetIds.map(id => channels[id]).filter(ch => ch && ch.readyState==="open");
  if (outs.length===0){ alert("No connected peers yet. Tap a device bubble to connect, then try again."); return; }
  const meta = JSON.stringify({ type:"meta", name:file.name, size:file.size, scope });
  outs.forEach(ch=>ch.send(meta));
  playSend();
  const reader = file.stream().getReader();
  let sent=0, total=file.size;
  const pump = () => reader.read().then(({done, value}) => {
    if (done){ hideProgress(scope); return; }
    let offset=0;
    while (offset < value.byteLength){
      const chunk = value.buffer.slice(value.byteOffset + offset, value.byteOffset + Math.min(offset + 64*1024, value.byteLength));
      outs.forEach(ch => ch.send(chunk));
      sent += chunk.byteLength; offset += 64*1024;
    }
    showProgress(scope, `Sending ${file.name}`, sent/total*100, sent, total); pump();
  });
  showProgress(scope, `Sending ${file.name}`, 0, 0, total); pump();
}

// Mode toggle + persistence
const modeSwitch = $("modeSwitch"); const onlinePanel = $("onlinePanel"); const localPanel = $("localPanel");
modeSwitch.addEventListener("change", ()=>{
  const localOn = modeSwitch.checked;
  $("modeLabel").textContent = localOn ? "📡 Local Mode" : "🌐 Online Mode";
  localPanel.classList.toggle("hidden", !localOn); onlinePanel.classList.toggle("hidden", localOn);
  localStorage.setItem("lastMode", localOn ? "local" : "online");
  if (!localOn) socket.emit("leaveLocal");
});
const ttlSelect = $("ttlSelect"); ttlSelect.addEventListener("change", ()=>localStorage.setItem("ttl", ttlSelect.value));
(function restore(){ const lastMode=localStorage.getItem("lastMode"); const ttl=localStorage.getItem("ttl"); if (ttl) ttlSelect.value=ttl; if (lastMode==="local"){ modeSwitch.checked=true; modeSwitch.dispatchEvent(new Event("change")); } })();

// PWA SW
if ('serviceWorker' in navigator) { window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(console.warn); }); }

// ---------- Chat ----------
const chatBtn=$("chatBtn"), chatPanel=$("chatPanel"), chatBody=$("chatBody"), chatInput=$("chatInput");
document.getElementById("closeChat").onclick = ()=>chatPanel.classList.add("hidden");
chatBtn.onclick = ()=>chatPanel.classList.toggle("hidden");
$("chatSend").onclick = ()=>{ const text = chatInput.value.trim(); if(!text) return; const name = $("nameOnline").value.trim() || $("nameLocal").value.trim() || "Me"; socket.emit("chat", { room: currentRoom(), name, text }); appendMsg({ me:true, name, text }); chatInput.value=""; };
socket.on("chat", (m)=>{ if (m.id===socket.id) return; appendMsg({ me:false, name:m.name, text:m.text }); });
function appendMsg({me, name, text}){
  const d=document.createElement('div'); d.className="msg"+(me?" me":""); d.innerHTML = `<b>${name}:</b> ${escapeHtml(text)}`; chatBody.appendChild(d); chatBody.scrollTop = chatBody.scrollHeight;
}
function escapeHtml(s){ return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function currentRoom(){ return (!localPanel.classList.contains("hidden") ? "local" : (group.code || "lobby")); }
function joinChatRoom(room, name){ socket.emit("chat", { room, name, text: `${name} joined` }); chatBtn.classList.remove("hidden"); chatPanel.classList.remove("hidden"); setTimeout(()=>chatPanel.classList.add("hidden"), 1200); }

/* ================================
   PATCH: Make all key inputs fully clickable
   ================================ */
document.addEventListener("DOMContentLoaded", function () {
  const clickableInputs = ["yourName", "localCode", "joinCode"];

  clickableInputs.forEach(id => {
    const inputEl = document.getElementById(id);
    if (inputEl) {
      const clickableArea = inputEl.closest(".row") || inputEl.parentElement;

      if (clickableArea) {
        clickableArea.style.cursor = "text";
        clickableArea.addEventListener("click", () => {
          inputEl.focus();
        });
      }

      // Auto-select content on focus
      inputEl.addEventListener("focus", function () {
        this.select();
      });
    }
  });
});
