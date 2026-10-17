"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const auth_1 = __importDefault(require("./auth"));
app.use('/auth', auth_1.default);
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const players = {};
io.on('connection', (socket) => {
    console.log(`[+] Player connected: ${socket.id}`);
    socket.on('join', (data) => {
        players[socket.id] = {
            id: socket.id,
            vehicleId: data.vehicleId,
            weaponId: data.weaponId || "minigun",
            vehicleColor: data.vehicleColor,
            position: { x: 0, y: 40, z: 0 },
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            health: 100
        };
        // Send all existing players to the new client
        socket.emit('currentPlayers', players);
        // Tell all other clients a new player joined
        socket.broadcast.emit('playerJoined', players[socket.id]);
        console.log(`Player ${socket.id} joined map ${data.mapId} with ${data.vehicleId}`);
    });
    socket.on('updateState', (state) => {
        if (players[socket.id]) {
            players[socket.id].position = state.position || players[socket.id].position;
            players[socket.id].rotation = state.rotation || players[socket.id].rotation;
            // Broadcast movement to other clients immediately
            socket.broadcast.emit('playerMoved', players[socket.id]);
        }
    });
    socket.on('shoot', (data) => {
        socket.broadcast.emit('playerShoot', { playerId: socket.id, origin: data.origin, hitPoint: data.hitPoint, targetId: data.targetId });
    });
    socket.on('abilityUsed', (data) => {
        socket.broadcast.emit('abilityUsed', { playerId: socket.id, abilityName: data.abilityName });
    });
    socket.on('hit', (data) => {
        const target = players[data.targetId];
        if (target && target.health > 0) {
            target.health -= data.damage;
            io.emit('healthUpdate', { playerId: target.id, health: target.health });
            if (target.health <= 0) {
                io.emit('playerDestroyed', target.id);
                // Respawn logic
                target.health = 100;
                target.position = { x: Math.random() * 40 - 20, y: 40, z: Math.random() * 40 - 20 };
                setTimeout(() => {
                    io.emit('healthUpdate', { playerId: target.id, health: target.health });
                    io.emit('playerMoved', target);
                }, 3000);
            }
        }
    });
    socket.on('disconnect', () => {
        console.log(`[-] Player disconnected: ${socket.id}`);
        delete players[socket.id];
        io.emit('playerDisconnected', socket.id);
    });
});
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Overdrive MMO Server running on ws://localhost:${PORT}`);
});
