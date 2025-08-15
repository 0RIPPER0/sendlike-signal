const socket = io();

// Landing page animation
function startLanding() {
  const landing = document.getElementById('landing');
  const container = document.querySelector('.container');
  setTimeout(() => {
    landing.style.opacity = '0';
    setTimeout(() => {
      landing.style.display = 'none';
      container.style.display = 'grid';
    }, 1000);
  }, 2500);
}

function loopPlane() {
  const plane = document.querySelector('.plane');
  const contrail = document.querySelector('.contrail');
  plane.style.animation = 'none';
  contrail.style.animation = 'none';
  plane.offsetHeight; contrail.offsetHeight;
  plane.style.animation = 'planeCurve 1.5s ease-in forwards';
  contrail.style.animation = 'contrailFade 1.5s ease-in forwards';
}

window.addEventListener('load', () => {
  startLanding();
  loopPlane();
  setInterval(loopPlane, 4000);
});

document.getElementById('joinBtn').addEventListener('click', () => {
  console.log('Join Group clicked');
});

document.getElementById('createBtn').addEventListener('click', () => {
  console.log('Create Group clicked');
});

document.getElementById('sendChatBtn').addEventListener('click', () => {
  console.log('Send Chat clicked');
});

function showAbout() {
  alert('SendLike - Simple P2P sharing via code or local network.');
}
