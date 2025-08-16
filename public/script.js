
/* =========================================================
=  SendLike — Client (WebRTC P2P Fast-Path + Manual Signaling)
=  - Direct P2P DataChannel with STUN only (no TURN).
=  - Manual copy/paste signaling blocks; no server bandwidth for payload.
=  - Existing Socket.IO is only for optional roster/chat.
========================================================= */

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

/* Manual P2P UI */
const p2pCreateOfferBtn = document.getElementById('p2pCreateOffer');
const p2pOfferTA        = document.getElementById('p2pOffer');
const p2pAnswerInTA     = document.getElementById('p2pAnswerIn');
const p2pAcceptAnswerBtn= document.getElementById('p2pAcceptAnswer');
const p2pOfferInTA      = document.getElementById('p2pOfferIn');
const p2pMakeAnswerBtn  = document.getElementById('p2pMakeAnswer');
const p2pAnswerOutTA    = document.getElementById('p2pAnswerOut');

/* Drag overlay */
let dropOverlay = document.getElementById('dropOverlay');

/* ------------------------------
   State
------------------------------ */
let MODE_LOCAL = false;
let currentRoom = null;
let hostId = null;
let isHost = false;
let myName = '';
let openShare = false;

let people = [];
let mySocketId = null;
socket.on('connect', () => { mySocketId = socket.id; });

/* WebRTC */
let pc = null;
let dc = null;
let rtcReady = false;

const KB = 1024, MB = KB * KB;

/* Landing */
function loopPlane(){}
function startLanding(){
  landing.classList.add('hidden');
  landing.addEventListener('transitionend', () => { landing.style.display='none'; app.hidden=false; }, { once:true });
}
window.addEventListener('load', startLanding);

/* Helpers */
function safeName(raw){ const s=(raw||'').trim(); return s||'Guest'; }
function avatarColor(seed){ let h=0; for(let i=0;i<seed.length;i++) h=(h*31+seed.charCodeAt(i))%360; return `hsl(${h}deg 70% 55%)`; }

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
function personCard(id, name){
  const card = document.createElement('div');
  card.className='person';
  card.dataset.id=id;
  const av=document.createElement('div'); av.className='avatar'; av.textContent=(name||'?').slice(0,1).toUpperCase(); av.style.background=avatarColor(name||id);
  const nm=document.createElement('div'); nm.className='name'; nm.textContent=name||'—';
  const tiny=document.createElement('div'); tiny.className='tiny'; tiny.textContent='0%';
  const edgeBg=document.createElement('div'); edgeBg.className='edgeBg';
  const edge=document.createElement('div'); edge.className='edgeProg'; edge.style.transform='scaleX(0)';
  card.appendChild(av); card.appendChild(nm); card.appendChild(tiny); card.appendChild(edgeBg); card.appendChild(edge);
  return card;
}
function renderPeople(list){
  peopleList.innerHTML='';
  list.forEach(p => {
    if (MODE_LOCAL && p.id===mySocketId) return;
    const card = personCard(p.id, p.name);
    card.addEventListener('click', () => {
      filePicker.value=''; filePicker.click();
      targetForSend = p.id;
    });
    peopleList.appendChild(card);
  });
}

/* About + Mode */
aboutBtn.addEventListener('click', ()=> alert('SendLike — Simple group sharing.\nDirect P2P mode uses manual signaling; zero server bandwidth for file data.'));

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
});

/* Online create/join (optional roster/chat) */
createBtn.addEventListener('click', () => {
  const name = safeName(nameHost.value); if (!name) return alert('Enter your name');
  myName = name;
  socket.emit('createGroup', { name, ttlMinutes: 10 }, ({ code, hostId: hId, openShare: os }) => {
    currentRoom = code; hostId = hId; isHost = true; openShare = !!os;
    setSessionUI({ code, roleText: 'Host', statusText: 'Active' });
    peopleTitle.textContent='Members';
  });
});
joinBtn.addEventListener('click', () => {
  const name = safeName(nameOnline.value);
  const code = (joinCodeInput.value||'').trim();
  if (!name || !code) return alert('Enter name and 6-digit code');
  myName = name;
  socket.emit('joinGroup', { name, code }, (res) => {
    if (res.error) return alert(res.error);
    currentRoom = code; hostId = res.hostId; isHost = false; openShare = !!res.openShare;
    setSessionUI({ code, roleText: 'Member', statusText: 'Active' });
    peopleTitle.textContent='Members';
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

socket.on('updateMembers', (members) => { if (MODE_LOCAL) return; people = Array.isArray(members)?members:[]; renderPeople(people); });
socket.on('openShareState', (value) => { openShare=!!value; openShareLabel.textContent = openShare ? '🟢 Open Share' : '🔒 Host-only sending'; });
socket.on('groupDisbanded', (reason) => {
  alert(`Group closed: ${reason||'Closed'}`);
  currentRoom=null; hostId=null; isHost=false; openShare=false;
  sessionInfo.hidden=true; disbandBtn.hidden=true; openShareWrap.hidden=true;
  people=[]; renderPeople(people);
});

/* Chat */
function appendMsg({ you=false, name, text }){
  const line=document.createElement('div'); line.className='msg'+(you?' you':''); line.textContent=`${name}: ${text}`;
  chatMessages.appendChild(line); chatMessages.scrollTop=chatMessages.scrollHeight;
  if (chatBox.hidden && !you) chatDot.style.display='block';
}
function sendChat(){
  const text=(chatInput.value||'').trim(); if(!text) return;
  const name=myName||'Me'; appendMsg({you:true,name,text});
  if (currentRoom) socket.emit('chat',{room:currentRoom,name,text});
  chatInput.value='';
}
sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') sendChat(); });
socket.on('chat', ({id,name,text}) => { if (id===socket.id) return; appendMsg({name:name||'Guest', text:text||''}); });
chatFab.addEventListener('click', ()=>{ chatBox.hidden=!chatBox.hidden; if(!chatBox.hidden) chatDot.style.display='none'; });
chatClose.addEventListener('click', ()=> chatBox.hidden=true );

/* -------------
   WebRTC Setup
------------- */
const rtcConfig = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302'] }
  ],
  // Only STUN -> ensures *no* relay bandwidth. If behind symmetric NAT, connection may fail.
  // To maximize success while still not using YOUR bandwidth, you could add a paid TURN you control.
};
function newPeer(){
  if (pc) try{ pc.close(); }catch{}
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = (e)=>{
    // For manual signaling we wait for ICE to complete within the SDP itself (bundle).
    // No need to stream candidates unless you want to paste updates. Do nothing.
  };
  pc.onconnectionstatechange = ()=>{
    if (pc.connectionState==='connected'){ rtcReady=true; }
  };
  pc.ondatachannel = (e)=>{
    if (e.channel?.label==='sl-file') attachDataChannel(e.channel);
  };
}
function attachDataChannel(channel){
  dc = channel;
  dc.binaryType='arraybuffer';
  dc.bufferedAmountLowThreshold = 1 * MB;
  dc.onopen = ()=> appendMsg({ name:'System', text:'P2P ready (DataChannel open)' });
  dc.onclose= ()=> appendMsg({ name:'System', text:'P2P closed' });
  dc.onbufferedamountlow = ()=> { /* wake send loops if any */ };
  dc.onmessage = onDCMessage;
}

/* Manual signaling (copy/paste) */
p2pCreateOfferBtn.addEventListener('click', async () => {
  newPeer();
  const channel = pc.createDataChannel('sl-file', { ordered: true });
  attachDataChannel(channel);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  // wait for ICE gathering to finish so SDP is self-contained (trickle=false feel)
  await waitForIceComplete(pc);
  p2pOfferTA.value = JSON.stringify(pc.localDescription);
});

p2pAcceptAnswerBtn.addEventListener('click', async () => {
  try{
    const answer = JSON.parse(p2pAnswerInTA.value.trim());
    await pc.setRemoteDescription(answer);
    appendMsg({ name:'System', text:'Answer accepted. Connecting…' });
  }catch(e){ alert('Bad answer JSON'); }
});

p2pMakeAnswerBtn.addEventListener('click', async () => {
  try{
    newPeer();
    const offer = JSON.parse(p2pOfferInTA.value.trim());
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceComplete(pc);
    p2pAnswerOutTA.value = JSON.stringify(pc.localDescription);
    appendMsg({ name:'System', text:'Answer created. Send it back to the sender.' });
  }catch(e){ alert('Bad offer JSON'); }
});

function waitForIceComplete(pc){
  return new Promise(res=>{
    if (pc.iceGatheringState==='complete') return res();
    const check=()=>{
      if (pc.iceGatheringState==='complete'){ pc.removeEventListener('icegatheringstatechange', check); res(); }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(res, 1500); // fail-safe
  });
}

/* Drag & drop + picker */
let targetForSend = null; // unused in manual mode, kept for UI consistency
filePicker.addEventListener('change', () => {
  if (!filePicker.files?.length) return;
  sendFilesRTC(Array.from(filePicker.files));
});
document.addEventListener('dragover', (e)=>{ e.preventDefault(); dropOverlay.classList.add('show'); });
document.addEventListener('dragleave', (e)=>{ e.preventDefault(); if(e.target===document||e.target===document.body) dropOverlay.classList.remove('show'); });
document.addEventListener('drop', (e)=>{
  e.preventDefault(); dropOverlay.classList.remove('show');
  const dt=e.dataTransfer; if (!dt?.files?.length) return;
  sendFilesRTC(Array.from(dt.files));
});

/* Combined edge progress per "active" peer (we'll use a single 'peer' card if none) */
function setEdgeProgress(percentText, frac){
  // if there are people cards, update the first one (or target). If none, create a temp card at top.
  let card = peopleList.querySelector('.person');
  if (!card) {
    const tmp = personCard('p2p','Peer');
    peopleList.appendChild(tmp);
    card = tmp;
  }
  const edge = card.querySelector('.edgeProg');
  const tiny = card.querySelector('.tiny');
  tiny.textContent = percentText;
  edge.style.transform = `scaleX(${Math.max(0,Math.min(1,frac))})`;
  edge.classList.remove('hide');
  // auto-hide after complete
  if (frac >= 1) setTimeout(()=> edge.classList.add('hide'), 1500);
}

/* File send over RTC with backpressure */
async function sendFilesRTC(files){
  if (!dc || dc.readyState!=='open') { alert('P2P channel not open yet. Create/paste the offer/answer first.'); return; }
  const cBytes = 256 * KB;
  for (const file of files) {
    const meta = { t:'meta', name:file.name, size:file.size, mime:file.type||'application/octet-stream' };
    dc.send(JSON.stringify(meta));
    let offset=0, lastTime=Date.now(), bytesThisSecond=0;
    while (offset < file.size) {
      const end = Math.min(offset + cBytes, file.size);
      const chunk = await file.slice(offset, end).arrayBuffer();
      // backpressure
      while (dc.bufferedAmount > dc.bufferedAmountLowThreshold) {
        await new Promise(r=> setTimeout(r, 1));
      }
      dc.send(chunk);
      offset=end; bytesThisSecond += chunk.byteLength;
      const percent = (offset/file.size);
      const now = Date.now();
      if (now - lastTime >= 250) {
        const mbps = (bytesThisSecond*8/((now-lastTime)/1000)/1e6).toFixed(2);
        setEdgeProgress(`${(percent*100).toFixed(1)}% • ${mbps} Mbps`, percent);
        lastTime = now; bytesThisSecond = 0;
      }
    }
    dc.send(JSON.stringify({ t:'complete' }));
    setEdgeProgress('100% • Done', 1);
  }
}

/* Receiver assembly */
const rxState = { name:null, size:0, mime:'application/octet-stream', parts:[], received:0 };
function onDCMessage(e){
  const data = e.data;
  if (typeof data === 'string') {
    try{
      const msg = JSON.parse(data);
      if (msg.t==='meta') {
        rxState.name = msg.name; rxState.size = msg.size|0; rxState.mime = msg.mime || 'application/octet-stream';
        rxState.parts = []; rxState.received = 0;
        appendMsg({ name:'System', text:`Incoming: ${rxState.name} (${(rxState.size/MB).toFixed(2)} MB)` });
        setEdgeProgress('0%', 0);
      } else if (msg.t==='complete') {
        const blob = new Blob(rxState.parts, { type: rxState.mime });
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=rxState.name||'download';
        a.style.display='none'; document.body.appendChild(a); a.click();
        setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
        appendMsg({ name:'System', text:`Saved: ${rxState.name}` });
        setEdgeProgress('100% • Saved', 1);
      }
    }catch{}
  } else {
    const u8 = new Uint8Array(data);
    rxState.parts.push(u8); rxState.received += u8.byteLength;
    const frac = rxState.size ? (rxState.received / rxState.size) : 0;
    setEdgeProgress(`${(frac*100).toFixed(1)}%`, frac);
  }
}

/* Boot */
modeLabel.textContent='🌐 Online Mode';
peopleTitle.textContent='Members';
