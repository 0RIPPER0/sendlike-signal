const socket = io();
function showAbout() {
  alert("SendLike - Simple P2P sharing via code or local network.");
}
document.getElementById('modeSwitch').addEventListener('change', function() {
  document.getElementById('modeLabel').textContent = this.checked ? '📡 Local Mode' : '🌐 Online Mode';
});
window.addEventListener('load', () => {
  setTimeout(() => {
    document.getElementById('landing').style.opacity = '0';
    setTimeout(() => {
      document.getElementById('landing').style.display = 'none';
      document.querySelector('.container').style.display = 'grid';
    }, 1000);
  }, 2500);
});
document.getElementById('createBtn').addEventListener('click', () => {
  const name = document.getElementById('nameHost').value;
  socket.emit('createGroup', { name, ttlMinutes: 10 }, (res) => {
    if (res.code) alert('Group created. Code: ' + res.code);
  });
});
document.getElementById('joinBtn').addEventListener('click', () => {
  const name = document.getElementById('nameOnline').value;
  const code = document.getElementById('joinCode').value;
  socket.emit('joinGroup', { name, code }, (res) => {
    if (res.error) alert(res.error);
    else document.getElementById('chatSection').style.display = 'block';
  });
});
document.getElementById('sendChatBtn').addEventListener('click', () => {
  const msg = document.getElementById('chatInput').value;
  socket.emit('chat', { room: document.getElementById('joinCode').value, name: document.getElementById('nameOnline').value, text: msg });
  document.getElementById('chatInput').value = '';
});
socket.on('chat', (msg) => {
  const div = document.createElement('div');
  div.textContent = msg.name + ': ' + msg.text;
  document.getElementById('chatMessages').appendChild(div);
});
