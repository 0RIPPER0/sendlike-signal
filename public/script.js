
/* =========================================================
=  SendLike — Client (Landing + Mode + Join/Create + People +
=                   Chat + Drag/Drop + File Transfer)
=  Online: WebRTC P2P first (true speed), fallback to Socket.IO relay
=  Local: Socket.IO relay
========================================================= */

const socket = io();

/* Elements */
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
let dropOverlay = document.getElementById('dropOverlay');

/* State */
let MODE_LOCAL = false;
let currentRoom = null;
let hostId = null;
let isHost = false;
let myName = '';
let openShare = false;
let mySocketId = null;

let people = [];
socket.on('whoami', ({ id }) => { mySocketId = id; });
socket.on('connect', () => { mySocketId = socket.id; });

/* Names */
const rndName = () => {
  const adj = ["Spicy","Sleepy","Bouncy","Shiny","Sneaky","Brave","Chill","Zippy","Fuzzy","Witty","Cosmic","Turbo","Sassy","Pixel","Mellow"];
  const ani = ["Panda","Otter","Falcon","Koala","Lemur","Tiger","Sloth","Fox","Yak","Marmot","Narwhal","Dolphin","Eagle","Moose","Gecko"];
  return `${adj[Math.floor(Math.random()*adj.length)]}${ani[Math.floor(Math.random()*ani.length)]}`;
};
let localName = rndName();

const KB = 1024, MB = KB*KB;

/* Landing */
function loopPlane() {
  const plane = landing.querySelector('.plane');
  const trail = landing.querySelector('.contrail');
  if (!plane || !trail) return;
  plane.style.animation = 'none'; trail.style.animation = 'none';
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

/* Helpers */
function safeName(raw){ const s=(raw||'').trim(); return s||'Guest'; }
function setSessionUI({ code, roleText, statusText }) {
  sessionCode.textContent = code || '———';
  sessionRole.textContent = roleText || '—';
  sessionStatus.textContent = statusText || 'Active';
  sessionInfo.hidden = false;
  disbandBtn.hidden = !isHost;
  openShareWrap.hidden = !(isHost && !MODE_LOCAL && currentRoom);
  openShareLabel.textContent = openShare ? '🟢 Open Share' : '🔒 Host-only sending';
  openShareSwitch.checked = !!openShare;
}
function avatarColor(seed){ let h=0; for(let i=0;i<seed.length;i++) h=(h*31+seed.charCodeAt(i))%360; return `hsl(${h}deg 70% 55%)`; }

/* People rendering with bottom progress bar */
function getPersonCardEl(id){ return peopleList.querySelector(`.person[data-id="${id}"]`); }
function ensureProgressBar(card){
  let po = card.querySelector('.progressOverlay');
  if (!po){
    po = document.createElement('div');
    po.className = 'progressOverlay';
    po.innerHTML = '<div class="bar"></div>';
    card.appendChild(po);
  }
  return po;
}
function updateProgressOnCard(id, percent, done=false){
  const card = getPersonCardEl(id);
  if (!card) return;
  const po = ensureProgressBar(card);
  const bar = po.querySelector('.bar');
  bar.style.width = `${Math.max(0,Math.min(100,percent))}%`;
  po.classList.add('show');
  if (done){
    setTimeout(()=>{ po.classList.remove('show'); bar.style.width='0%'; }, 1200);
  }
}

function renderPeople(list) {
  peopleList.innerHTML = '';
  list.forEach(p => {
    if (MODE_LOCAL && p.id === mySocketId) return;
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

    card.addEventListener('click', () => chooseTargetAndPickFiles(p.id));

    // progress overlay holder
    ensureProgressBar(card);

    peopleList.appendChild(card);
  });
}

/* About + Mode toggle */
aboutBtn.addEventListener('click', () => alert('SendLike — Simple group sharing via code or local network.'));

modeSwitch.addEventListener('change', () => {
  MODE_LOCAL = modeSwitch.checked;
  modeLabel.textContent = MODE_LOCAL ? '📡 Local Mode' : '🌐 Online Mode';
  cardOnlineJoin.hidden = MODE_LOCAL;
  cardOnlineCreate.hidden = MODE_LOCAL;
  sessionInfo.hidden = MODE_LOCAL;
  disbandBtn.hidden = true;
  openShareWrap.hidden = true;
  currentRoom = null; hostId = null; isHost = false; openShare = false;
  peopleTitle.textContent = MODE_LOCAL ? 'Nearby Devices' : 'Members';
  peopleList.innerHTML = '';
  if (MODE_LOCAL) {
    socket.emit('enterLocal', localName);
    teardownAllPeers(); // make sure WebRTC is not in use for local
  } else {
    socket.emit('leaveLocal');
  }
});

/* Online: create/join/disband */
createBtn.addEventListener('click', () => {
  const name = safeName(nameHost.value);
  if (!name) return alert('Enter your name');
  myName = name;
  socket.emit('createGroup', { name, ttlMinutes: 10 }, ({ code, hostId: hId, openShare: os }) => {
    currentRoom = code; hostId = hId; isHost = true; openShare = !!os;
    setSessionUI({ code, roleText: 'Host', statusText: 'Active' });
    peopleTitle.textContent = 'Members';
  });
});
joinBtn.addEventListener('click', () => {
  const name = safeName(nameOnline.value);
  const code = (joinCodeInput.value || '').trim();
  if (!name || !code) return alert('Enter name and 6-digit code');
  myName = name;
  socket.emit('joinGroup', { name, code }, (res) => {
    if (res.error) return alert(res.error);
    currentRoom = code; hostId = res.hostId; isHost = false; openShare = !!res.openShare;
    setSessionUI({ code, roleText: 'Member', statusText: 'Active' });
    peopleTitle.textContent = 'Members';
  });
});
disbandBtn.addEventListener('click', () => {
  if (!isHost || !currentRoom) return;
  socket.emit('disbandGroup', currentRoom);
});
openShareSwitch.addEventListener('change', () => {
  if (!isHost || !currentRoom) return;
  socket.emit('setOpenShare', { code: currentRoom, value: openShareSwitch.checked });
});

/* Roster updates */
socket.on('updateMembers', (members) => {
  if (MODE_LOCAL) return;
  people = Array.isArray(members) ? members : [];
  renderPeople(people);
  // Initiate/refresh P2P connections to others
  refreshPeerTargets();
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
socket.on('groupDisbanded', () => {
  currentRoom = null; hostId = null; isHost = false; openShare = false;
  sessionInfo.hidden = true; disbandBtn.hidden = true; openShareWrap.hidden = true;
  people = []; renderPeople(people);
  teardownAllPeers();
});

/* Chat */
function appendMsg({ you=false, name, text }){
  const line=document.createElement('div'); line.className='msg'+(you?' you':''); line.textContent=`${name}: ${text}`;
  chatMessages.appendChild(line); chatMessages.scrollTop = chatMessages.scrollHeight;
  if (chatBox.hidden && !you) chatDot.style.display='block';
}
function sendChat(){
  const text=(chatInput.value||'').trim(); if(!text) return;
  const name = myName || localName || 'Me';
  appendMsg({ you:true, name, text });
  if (currentRoom) socket.emit('chat', { room: currentRoom, name, text });
  chatInput.value='';
}
sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', e=>{ if(e.key==='Enter') sendChat(); });
socket.on('chat', ({ id, name, text }) => { if(id===socket.id) return; appendMsg({ name: name||'Guest', text:text||'' }); });
chatFab.addEventListener('click', ()=>{ chatBox.hidden=!chatBox.hidden; if(!chatBox.hidden) chatDot.style.display='none'; });
chatClose.addEventListener('click', ()=> chatBox.hidden=true );

/* Drag & Drop + picker */
let targetForSend = null;
function chooseTargetAndPickFiles(targetId){
  if (!MODE_LOCAL && currentRoom){
    if (!openShare && !isHost && targetId !== hostId) return alert('Host-only sending is enabled. You can only send files to the host.');
  }
  targetForSend = targetId;
  filePicker.value = '';
  filePicker.click();
}
filePicker.addEventListener('change', ()=>{
  if (!targetForSend || !filePicker.files?.length) return;
  sendFilesTo(targetForSend, Array.from(filePicker.files));
});
['dragenter','dragover'].forEach(evt=>{
  document.addEventListener(evt, (e)=>{ e.preventDefault(); e.stopPropagation(); dropOverlay.classList.add('show'); });
});
['dragleave','drop'].forEach(evt=>{
  document.addEventListener(evt, (e)=>{
    if (evt!=='drop') e.preventDefault();
    e.stopPropagation();
    if (evt==='drop'){
      dropOverlay.classList.remove('show');
      const dt=e.dataTransfer;
      if (dt && dt.files && dt.files.length){
        if (!targetForSend){ alert('Click a person to target first.'); return; }
        sendFilesTo(targetForSend, Array.from(dt.files));
      }
    } else {
      if (e.target===document || e.target===document.body) dropOverlay.classList.remove('show');
    }
  });
});

/* =========================================================
=  WebRTC (Online mode only)
========================================================= */
const STUN = [{ urls: "stun:stun.l.google.com:19302" }];
const peers = new Map(); // peerId -> { pc, dc, ready }
function teardownAllPeers(){
  peers.forEach(({pc,dc})=>{ try{dc&&dc.close();}catch{} try{pc&&pc.close();}catch{} });
  peers.clear();
}

function refreshPeerTargets(){
  if (!currentRoom) return; // only online
  (people||[]).forEach(p=>{
    if (p.id===mySocketId) return;
    if (!peers.has(p.id)) initPeer(p.id, true); // polite=true to avoid glare
  });
}

// Create pc and dc (if caller)
function initPeer(peerId, polite){
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const state = { pc, dc: null, ready:false, polite };
  peers.set(peerId, state);

  // ICE
  pc.onicecandidate = (e)=>{
    if (e.candidate) socket.emit('webrtc-ice', { to: peerId, candidate: e.candidate, room: currentRoom });
  };
  // DataChannel from remote
  pc.ondatachannel = (e)=>{
    const dc = e.channel;
    wireDataChannel(peerId, dc);
    state.dc = dc;
  };

  // We are the eager side: create datachannel and offer
  const dc = pc.createDataChannel("sendlike", { ordered:true });
  wireDataChannel(peerId, dc);
  state.dc = dc;

  // Start negotiation
  negotiate(peerId).catch(()=>{});
}

async function negotiate(peerId){
  const st = peers.get(peerId); if (!st) return;
  try{
    const offer = await st.pc.createOffer();
    await st.pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { to: peerId, offer, room: currentRoom });
  }catch(e){ console.warn('negotiation failed', e); }
}

socket.on('webrtc-offer', async ({ from, offer })=>{
  if (MODE_LOCAL) return;
  let st = peers.get(from);
  if (!st){ st = initPeer(from, false); st = peers.get(from); }
  try{
    await st.pc.setRemoteDescription(offer);
    const answer = await st.pc.createAnswer();
    await st.pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { to: from, answer, room: currentRoom });
  }catch(e){ console.warn('offer handle failed', e); }
});
socket.on('webrtc-answer', async ({ from, answer })=>{
  const st = peers.get(from); if (!st) return;
  try{ await st.pc.setRemoteDescription(answer); }catch(e){ console.warn('answer set failed', e); }
});
socket.on('webrtc-ice', async ({ from, candidate })=>{
  const st = peers.get(from); if (!st) return;
  try{ await st.pc.addIceCandidate(candidate); }catch(e){ console.warn('ice add failed', e); }
});

function wireDataChannel(peerId, dc){
  dc.binaryType = "arraybuffer";
  dc.onopen = ()=>{ const st=peers.get(peerId); if(st){ st.ready=true; } };
  dc.onclose = ()=>{ const st=peers.get(peerId); if(st){ st.ready=false; } };
  dc.onmessage = (e)=> handleRTCMessage(peerId, e.data);
}

/* Simple RTC protocol: JSON control + binary chunks
   {t:'meta', id, name, size, mime, chunkBytes}
   {t:'complete', id}
   Binary payloads are Uint8Array chunks tagged by current incomingTransfer map
*/
const incoming = new Map(); // key = peerId|fileId -> { name, size, mime, parts:[], received }
function handleRTCMessage(fromId, data){
  if (typeof data === 'string'){
    try{
      const msg = JSON.parse(data);
      if (msg.t === 'meta'){
        const key = `${fromId}|${msg.id}`;
        incoming.set(key, { name: msg.name, size: msg.size, mime: msg.mime || 'application/octet-stream', parts: [], received: 0 });
        appendMsg({ name:'System', text:`Incoming: ${msg.name} (${(msg.size/MB).toFixed(2)} MB)` });
        // show receiver progress
        updateProgressOnCard(fromId, 0);
      } else if (msg.t === 'complete'){
        const key = `${fromId}|${msg.id}`;
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
        setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);

        appendMsg({ name:'System', text:`Saved: ${rec.name}` });
        updateProgressOnCard(fromId, 100, true);
      }
    }catch{}
  } else if (data instanceof ArrayBuffer){
    // We don't know which transfer; use the most recent active from this peer
    let latestKey = null;
    for (const k of incoming.keys()){ if (k.startsWith(fromId+"|")) latestKey = k; }
    if (!latestKey) return;
    const rec = incoming.get(latestKey);
    const u8 = new Uint8Array(data);
    rec.parts.push(u8);
    rec.received += u8.byteLength;
    const percent = (rec.received/rec.size)*100;
    updateProgressOnCard(fromId, percent);
  }
}

/* =========================================================
=  File Transfer (choose P2P or relay)
========================================================= */
function chunkSize(){ return MODE_LOCAL ? 4*MB : 64*KB; }

function emitAck(event, payload){
  return new Promise((resolve, reject)=>{
    socket.timeout(10000).emit(event, payload, (err, res)=>{
      if (err) return reject(err);
      resolve(res);
    });
  });
}

async function sendFilesTo(targetId, files){
  const useP2P = (!MODE_LOCAL && peers.get(targetId)?.ready);
  const room = MODE_LOCAL ? null : currentRoom;

  for (const file of files){
    const fileId = `${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const cBytes = chunkSize();

    if (useP2P){
      // P2P path
      const st = peers.get(targetId);
      const dc = st?.dc;
      if (!dc || dc.readyState !== 'open'){ // fallback
        await sendViaRelay(targetId, room, file, fileId, cBytes);
        continue;
      }
      // meta
      dc.send(JSON.stringify({ t:'meta', id:fileId, name:file.name, size:file.size, mime:file.type || 'application/octet-stream', chunkBytes:cBytes }));

      let offset = 0, lastTime=Date.now(), bytesThisSecond=0;
      while (offset < file.size){
        const end = Math.min(offset + cBytes, file.size);
        const chunk = await file.slice(offset, end).arrayBuffer();
        dc.send(chunk);
        offset = end;
        bytesThisSecond += chunk.byteLength;

        const percent = (offset/file.size)*100;
        updateProgressOnCard(targetId, percent);

        const now=Date.now();
        if (now-lastTime>=1000){ bytesThisSecond=0; lastTime=now; }
      }
      dc.send(JSON.stringify({ t:'complete', id:fileId }));
      updateProgressOnCard(targetId, 100, true);
    } else {
      // Relay path (local mode, or P2P not ready)
      await sendViaRelay(targetId, room, file, fileId, cBytes);
    }
  }
}

async function sendViaRelay(targetId, room, file, fileId, cBytes){
  await emitAck('fileMeta', {
    targetId, room, fileId,
    name: file.name, size: file.size,
    mime: file.type || 'application/octet-stream',
    chunkBytes: cBytes
  });

  let offset=0, seq=0, lastTime=Date.now(), bytesThisSecond=0;
  while (offset < file.size){
    const end = Math.min(offset + cBytes, file.size);
    const chunk = await file.slice(offset, end).arrayBuffer();
    await emitAck('fileChunk', { targetId, fileId, seq, chunk });
    offset = end; seq++; bytesThisSecond += chunk.byteLength;

    const percent = (offset/file.size)*100;
    updateProgressOnCard(targetId, percent);

    const now=Date.now();
    if(now-lastTime>=1000){ bytesThisSecond=0; lastTime=now; }
  }
  await emitAck('fileComplete', { targetId, fileId });
  updateProgressOnCard(targetId, 100, true);
}

/* Relay receiving (local mode or fallback) */
const incomingRelay = new Map();
socket.on('fileMeta', ({ fromId, fileId, name, size, mime, chunkBytes })=>{
  const key = `${fromId}|${fileId}`;
  incomingRelay.set(key, { name, size, mime: mime||'application/octet-stream', parts:[], received:0 });
  appendMsg({ name:'System', text:`Incoming: ${name} (${(size/MB).toFixed(2)} MB)` });
  updateProgressOnCard(fromId, 0);
});
socket.on('fileChunk', ({ fromId, fileId, seq, chunk })=>{
  const key = `${fromId}|${fileId}`;
  const rec = incomingRelay.get(key); if(!rec) return;
  const u8 = new Uint8Array(chunk);
  rec.parts.push(u8);
  rec.received += u8.byteLength;
  updateProgressOnCard(fromId, (rec.received/rec.size)*100);
});
socket.on('fileComplete', ({ fromId, fileId })=>{
  const key = `${fromId}|${fileId}`;
  const rec = incomingRelay.get(key); if(!rec) return;
  const blob = new Blob(rec.parts, { type: rec.mime });
  incomingRelay.delete(key);

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = rec.name || 'download';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1000);

  appendMsg({ name:'System', text:`Saved: ${rec.name}` });
  updateProgressOnCard(fromId, 100, true);
});

/* Boot */
modeLabel.textContent = '🌐 Online Mode';
peopleTitle.textContent = 'Members';
window.addEventListener('beforeunload', ()=>{ if (MODE_LOCAL) socket.emit('leaveLocal'); });
