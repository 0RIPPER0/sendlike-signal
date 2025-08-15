const socket = io();
let myName = "";
let myCode = "";
let isHost = false;

function createGroup() {
    myName = document.getElementById("nameInput").value.trim();
    if (!myName) return alert("Enter your name");
    isHost = true;
    socket.emit("createGroup", myName);
}

function joinGroup() {
    myName = document.getElementById("nameInput").value.trim();
    let code = document.getElementById("joinCodeInput").value.trim();
    if (!myName || !code) return alert("Enter your name and code");
    socket.emit("joinGroup", { name: myName, code });
}

socket.on("groupCreated", (data) => {
    myCode = data.code;
    document.getElementById("groupCode").innerText = myCode;
    document.getElementById("startScreen").style.display = "none";
    document.getElementById("groupScreen").style.display = "block";
    if (isHost) document.getElementById("disbandBtn").style.display = "inline-block";
    updateMembers(data.members);
});

socket.on("updateMembers", (members) => {
    updateMembers(members);
});

socket.on("errorMsg", (msg) => {
    alert(msg);
});

function updateMembers(members) {
    const list = document.getElementById("membersList");
    list.innerHTML = "";
    members.forEach(m => {
        let div = document.createElement("div");
        div.className = "member";
        div.textContent = m.name.charAt(0).toUpperCase();
        list.appendChild(div);
    });
}

function sendFile() {
    const file = document.getElementById("fileInput").files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        socket.emit("sendFile", { code: myCode, fileName: file.name, fileBuffer: reader.result });
    };
    reader.readAsArrayBuffer(file);
}

socket.on("receiveFile", ({ fileName, fileBuffer }) => {
    const blob = new Blob([fileBuffer]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
});

function disbandGroup() {
    socket.emit("disbandGroup", myCode);
}

socket.on("groupDisbanded", () => {
    alert("Group has been disbanded.");
    location.reload();
});
