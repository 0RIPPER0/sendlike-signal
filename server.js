const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let groups = {};

function generateGroupCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("createGroup", (name) => {
        let code = generateGroupCode();
        groups[code] = { hostId: socket.id, members: [{ id: socket.id, name }] };
        socket.join(code);
        socket.emit("groupCreated", { code, members: groups[code].members });
        console.log(`Group ${code} created by ${name}`);
    });

    socket.on("joinGroup", ({ name, code }) => {
        if (!groups[code]) {
            socket.emit("errorMsg", "Group not found");
            return;
        }
        groups[code].members.push({ id: socket.id, name });
        socket.join(code);
        io.to(code).emit("updateMembers", groups[code].members);
        console.log(`${name} joined group ${code}`);
    });

    socket.on("sendFile", ({ code, fileName, fileBuffer }) => {
        if (!groups[code]) return;
        socket.to(code).emit("receiveFile", { fileName, fileBuffer });
    });

    socket.on("disbandGroup", (code) => {
        if (!groups[code] || groups[code].hostId !== socket.id) return;
        io.to(code).emit("groupDisbanded");
        delete groups[code];
        console.log(`Group ${code} disbanded`);
    });

    socket.on("disconnect", () => {
        for (let code in groups) {
            let group = groups[code];
            let index = group.members.findIndex((m) => m.id === socket.id);
            if (index !== -1) {
                group.members.splice(index, 1);
                io.to(code).emit("updateMembers", group.members);
                if (socket.id === group.hostId) {
                    io.to(code).emit("groupDisbanded");
                    delete groups[code];
                }
            }
        }
        console.log("User disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
