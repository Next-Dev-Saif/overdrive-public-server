"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const race_1 = require("./race");
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auth_1 = __importDefault(require("./auth"));
const db_1 = require("./db");
const match_1 = require("../../shared/match");
const app = (0, express_1.default)();
app.disable('x-powered-by');
app.set('trust proxy', config_1.serverConfig.proxyHops);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!(0, config_1.isAllowedOrigin)(req.headers.origin)) {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
    }
    next();
});
app.use((0, cors_1.default)({ origin: config_1.serverConfig.allowedOrigins }));
app.use(express_1.default.json({ limit: '16kb' }));
// Health and readiness endpoints for cloud orchestrators (e.g. Blitz Cloud, Docker, Kubernetes)
app.get(['/', '/health', '/healthz', '/up'], (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'overdrive-server' });
});
app.get('/readyz', (_req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield db_1.prisma.user.findFirst({ select: { id: true } });
        res.status(200).json({ status: 'ready' });
    }
    catch (_a) {
        // Return 200 with notice so cloud health checks do not stall container boot
        res.status(200).json({ status: 'ready', database: 'initializing' });
    }
}));
app.use('/auth', auth_1.default);
const JWT_SECRET = config_1.serverConfig.jwtSecret;
const httpServer = (0, http_1.createServer)(app);
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: config_1.serverConfig.allowedOrigins, methods: ['GET', 'POST'] },
    allowRequest: (req, callback) => callback(null, (0, config_1.isAllowedOrigin)(req.headers.origin)),
    maxHttpBufferSize: 64 * 1024,
});
const VEHICLE_HEALTH = {
    interceptor: 600, juggernaut: 1600, phantom: 450, manticore: 1200,
    valkyrie: 700, wraith: 350, behemoth: 2500,
};
const BOT_VEHICLES = Object.keys(VEHICLE_HEALTH);
const BOT_WEAPONS = ['minigun', 'plasma', 'missile', 'mortar', 'nuke'];
const DAMAGE_CAPS = {
    minigun: 10, plasma: 30, missile: 45, mortar: 80, nuke: 1500,
    afterburner: 5, shockwave: 20, lightning: 25,
};
const DAMAGE_ABILITY_BY_VEHICLE = {
    interceptor: 'lightning',
    juggernaut: 'shockwave',
    valkyrie: 'afterburner',
};
const ABILITY_NAME_BY_VEHICLE = {
    interceptor: 'lightning',
    juggernaut: 'shockwave',
    phantom: 'phantom',
    manticore: 'manticore',
    valkyrie: 'valkyrie',
    wraith: 'wraith',
    behemoth: 'behemoth',
};
const players = new Map();
const matchmakingQueue = [];
const queueTimers = new Map();
const matches = new Map();
const socketMatches = new Map();
function snapshotFor(session) {
    return Object.assign(Object.assign({}, session.snapshot), { phase: (0, match_1.resolveMatchPhase)(session.snapshot), roster: session.snapshot.roster.map(member => (Object.assign({}, member))) });
}
function emitSnapshot(session) {
    session.snapshot.phase = (0, match_1.resolveMatchPhase)(session.snapshot);
    io.to(session.snapshot.roomId).emit('matchSnapshot', snapshotFor(session));
}
function createMember(entry, index) {
    const teamId = (0, match_1.teamForHumanIndex)(index);
    return {
        entityId: entry.socketId,
        userId: entry.userId,
        displayName: entry.username,
        kind: 'human',
        teamId,
        slot: Math.floor(index / 2),
        vehicleId: entry.vehicleId,
        weaponId: entry.weaponId,
        vehicleColor: entry.vehicleColor,
        connected: true,
    };
}
function fillBots(matchId, roster) {
    for (const teamId of ['alpha', 'bravo']) {
        const occupied = new Set(roster.filter(member => member.teamId === teamId).map(member => member.slot));
        for (let slot = 0; slot < match_1.TDM_RULES.teamSize; slot++) {
            if (occupied.has(slot))
                continue;
            const seed = teamId === 'alpha' ? slot : slot + match_1.TDM_RULES.teamSize;
            roster.push({
                entityId: `${matchId}:bot:${teamId}:${slot}`,
                displayName: `${teamId === 'alpha' ? 'ALPHA' : 'BRAVO'}-${slot + 1}`,
                kind: 'bot', teamId, slot,
                vehicleId: BOT_VEHICLES[seed % BOT_VEHICLES.length],
                weaponId: BOT_WEAPONS[seed % BOT_WEAPONS.length],
                connected: true,
            });
        }
    }
}
function startMatch(entries) {
    var _a;
    if (entries.length === 0)
        return;
    const createdAt = Date.now();
    const matchId = `match_${createdAt}_${Math.random().toString(36).slice(2, 7)}`;
    const roomId = `room_${matchId}`;
    const roster = entries.map(createMember);
    fillBots(matchId, roster);
    const startsAt = createdAt + match_1.TDM_RULES.introMs + match_1.TDM_RULES.countdownMs;
    const snapshot = {
        matchId, roomId, mapId: entries[0].mapId, phase: 'intro', startsAt,
        endsAt: startsAt + match_1.TDM_RULES.durationMs,
        scoreLimit: match_1.TDM_RULES.scoreLimit,
        scores: { alpha: 0, bravo: 0 }, roster, winner: null,
    };
    const session = {
        snapshot, hostSocketId: entries[0].socketId, health: new Map(), maxHealth: new Map(),
        kills: new Map(), deaths: new Map(), lastHitSequence: new Map(), invulnerableUntil: new Map(), pendingRespawns: new Set(), settled: false,
    };
    for (const member of roster) {
        const maxHealth = (_a = VEHICLE_HEALTH[member.vehicleId]) !== null && _a !== void 0 ? _a : 600;
        session.health.set(member.entityId, maxHealth);
        session.maxHealth.set(member.entityId, maxHealth);
        session.kills.set(member.entityId, 0);
        session.deaths.set(member.entityId, 0);
    }
    matches.set(matchId, session);
    entries.forEach((entry, index) => {
        const localMember = roster.find(member => member.entityId === entry.socketId);
        socketMatches.set(entry.socketId, matchId);
        const payload = {
            roomId, matchId, mapId: snapshot.mapId, isHost: index === 0,
            team: localMember.teamId, localMember, snapshot: snapshotFor(session),
        };
        io.to(entry.socketId).emit('matchFound', payload);
    });
}
function flushQueue(mapId) {
    const entries = matchmakingQueue.filter(entry => entry.mapId === mapId).slice(0, match_1.TDM_RULES.teamSize * 2);
    entries.forEach(entry => matchmakingQueue.splice(matchmakingQueue.indexOf(entry), 1));
    queueTimers.delete(mapId);
    startMatch(entries);
    if (matchmakingQueue.some(entry => entry.mapId === mapId))
        scheduleQueueFlush(mapId);
}
function scheduleQueueFlush(mapId) {
    if (queueTimers.has(mapId))
        return;
    queueTimers.set(mapId, setTimeout(() => flushQueue(mapId), match_1.TDM_RULES.queueWaitMs));
}
function settleMatch(session) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        if (session.settled || session.snapshot.winner === null)
            return;
        session.settled = true;
        for (const member of session.snapshot.roster) {
            if (member.kind !== 'human' || !member.userId)
                continue;
            const won = session.snapshot.winner !== 'draw' && session.snapshot.winner === member.teamId;
            const xpGain = won ? 150 : 75;
            const scrapGain = won ? 40 : 20;
            try {
                const stats = yield db_1.prisma.playerStats.findUnique({ where: { userId: member.userId } });
                if (stats) {
                    const totalXp = stats.xp + xpGain;
                    const xpRequired = stats.level * 1000;
                    yield db_1.prisma.playerStats.update({ where: { userId: member.userId }, data: {
                            xp: totalXp >= xpRequired ? totalXp - xpRequired : totalXp,
                            level: totalXp >= xpRequired ? stats.level + 1 : stats.level,
                            kills: { increment: (_a = session.kills.get(member.entityId)) !== null && _a !== void 0 ? _a : 0 },
                            deaths: { increment: (_b = session.deaths.get(member.entityId)) !== null && _b !== void 0 ? _b : 0 },
                            mmr: { increment: won ? 5 : session.snapshot.winner === 'draw' ? 0 : -2 },
                        } });
                }
                yield db_1.prisma.wallet.update({ where: { userId: member.userId }, data: { scrap: { increment: scrapGain } } });
                const updatedUser = yield db_1.prisma.user.findUnique({ where: { id: member.userId }, include: { stats: true, wallet: true } });
                if (updatedUser)
                    io.to(member.entityId).emit('progressionUpdate', { stats: updatedUser.stats, wallet: updatedUser.wallet, message: `${won ? 'Victory' : 'Match complete'}: +${xpGain} XP, +${scrapGain} Scrap` });
            }
            catch (error) {
                console.error('Unable to settle match rewards:', error);
            }
        }
    });
}
function endMatch(session, winner) {
    if (session.snapshot.winner !== null)
        return;
    session.snapshot.winner = winner;
    session.snapshot.phase = 'ended';
    io.to(session.snapshot.roomId).emit('matchEnded', snapshotFor(session));
    void settleMatch(session);
    setTimeout(() => {
        matches.delete(session.snapshot.matchId);
        session.snapshot.roster.forEach(member => {
            if (member.kind === 'human' && socketMatches.get(member.entityId) === session.snapshot.matchId)
                socketMatches.delete(member.entityId);
        });
    }, 60000);
}
function evaluateMatchEnd(session) {
    if (session.snapshot.winner !== null)
        return;
    const { alpha, bravo } = session.snapshot.scores;
    if (alpha >= session.snapshot.scoreLimit)
        return endMatch(session, 'alpha');
    if (bravo >= session.snapshot.scoreLimit)
        return endMatch(session, 'bravo');
    if (Date.now() < session.snapshot.endsAt)
        return;
    endMatch(session, alpha === bravo ? 'draw' : alpha > bravo ? 'alpha' : 'bravo');
}
function scheduleRespawn(session, target) {
    if (session.pendingRespawns.has(target.entityId) || session.snapshot.winner !== null)
        return;
    session.pendingRespawns.add(target.entityId);
    setTimeout(() => {
        var _a;
        session.pendingRespawns.delete(target.entityId);
        if (session.snapshot.winner !== null || !matches.has(session.snapshot.matchId))
            return;
        const maxHealth = (_a = session.maxHealth.get(target.entityId)) !== null && _a !== void 0 ? _a : 600;
        session.health.set(target.entityId, maxHealth);
        const invulnerableUntil = Date.now() + match_1.TDM_RULES.respawnProtectionMs;
        session.invulnerableUntil.set(target.entityId, invulnerableUntil);
        io.to(session.snapshot.roomId).emit('combatantRespawned', {
            entityId: target.entityId,
            health: maxHealth,
            spawn: (0, match_1.getTeamSpawn)(target.teamId, target.slot, 40),
            invulnerableUntil,
        });
    }, match_1.TDM_RULES.respawnDelayMs);
}
const matchTimer = setInterval(() => matches.forEach(evaluateMatchEnd), 500);
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token)
        return next(new Error('Authentication error'));
    try {
        const decoded = jsonwebtoken_1.default.verify(token, JWT_SECRET);
        socket.data.userId = decoded.userId;
        socket.data.username = decoded.username;
        next();
    }
    catch (_a) {
        next(new Error('Authentication error'));
    }
});
io.on('connection', (socket) => {
    socket.on('joinMatchmaking', (data) => {
        const existingIndex = matchmakingQueue.findIndex(entry => entry.userId === socket.data.userId);
        if (existingIndex >= 0)
            matchmakingQueue.splice(existingIndex, 1);
        matchmakingQueue.push(Object.assign({ socketId: socket.id, userId: socket.data.userId, username: socket.data.username }, data));
        const sameMapCount = matchmakingQueue.filter(entry => entry.mapId === data.mapId).length;
        if (sameMapCount >= match_1.TDM_RULES.teamSize * 2)
            flushQueue(data.mapId);
        else
            scheduleQueueFlush(data.mapId);
    });
    socket.on('cancelMatchmaking', () => {
        const index = matchmakingQueue.findIndex(entry => entry.socketId === socket.id);
        if (index >= 0)
            matchmakingQueue.splice(index, 1);
    });
    socket.on('join', (data) => {
        var _a, _b, _c, _d, _e, _f;
        const matchId = (_a = data.matchId) !== null && _a !== void 0 ? _a : socketMatches.get(socket.id);
        const session = matchId ? matches.get(matchId) : undefined;
        const member = session === null || session === void 0 ? void 0 : session.snapshot.roster.find(candidate => candidate.entityId === socket.id);
        const spawn = member ? (0, match_1.getTeamSpawn)(member.teamId, member.slot, 40) : { x: 0, y: 40, z: 0, yaw: 0 };
        const vehicleId = (_b = member === null || member === void 0 ? void 0 : member.vehicleId) !== null && _b !== void 0 ? _b : data.vehicleId;
        const weaponId = (_d = (_c = member === null || member === void 0 ? void 0 : member.weaponId) !== null && _c !== void 0 ? _c : data.weaponId) !== null && _d !== void 0 ? _d : 'minigun';
        const vehicleColor = (_e = member === null || member === void 0 ? void 0 : member.vehicleColor) !== null && _e !== void 0 ? _e : data.vehicleColor;
        const maxHealth = (_f = VEHICLE_HEALTH[vehicleId]) !== null && _f !== void 0 ? _f : 600;
        players.set(socket.id, {
            id: socket.id, displayName: socket.data.username, teamId: member === null || member === void 0 ? void 0 : member.teamId,
            vehicleId, weaponId, vehicleColor,
            position: { x: spawn.x, y: spawn.y, z: spawn.z },
            rotation: { x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) },
            health: maxHealth, maxHealth,
        });
        if (session) {
            socket.join(session.snapshot.roomId);
            socket.data.roomId = session.snapshot.roomId;
            socket.data.matchId = session.snapshot.matchId;
            socket.emit('currentPlayers', Object.fromEntries([...players].filter(([id]) => id !== socket.id && socketMatches.get(id) === matchId)));
            socket.emit('matchSnapshot', snapshotFor(session));
            socket.to(session.snapshot.roomId).emit('playerJoined', players.get(socket.id));
        }
        else
            socket.emit('currentPlayers', {});
    });
    socket.on('updateState', (state) => {
        const player = players.get(socket.id);
        if (!player || !socket.data.roomId)
            return;
        if (state.position)
            player.position = state.position;
        if (state.rotation)
            player.rotation = state.rotation;
        socket.to(socket.data.roomId).emit('playerMoved', player);
    });
    socket.on('botState', (data) => {
        const session = matches.get(socket.data.matchId);
        const member = session === null || session === void 0 ? void 0 : session.snapshot.roster.find(candidate => candidate.entityId === data.botId && candidate.kind === 'bot');
        if (!session || session.hostSocketId !== socket.id || !member)
            return;
        socket.to(session.snapshot.roomId).emit('botState', Object.assign(Object.assign({}, data), { vehicleId: member.vehicleId, weaponId: member.weaponId, health: session.health.get(member.entityId) }));
    });
    socket.on('botShoot', (data) => {
        const session = matches.get(socket.data.matchId);
        if ((session === null || session === void 0 ? void 0 : session.hostSocketId) === socket.id)
            socket.to(session.snapshot.roomId).emit('botShoot', data);
    });
    socket.on('shoot', (data) => {
        if (socket.data.roomId)
            socket.to(socket.data.roomId).emit('playerShoot', Object.assign({ playerId: socket.id }, data));
    });
    socket.on('abilityUsed', (data) => {
        var _a;
        const session = matches.get(socket.data.matchId);
        if (!session)
            return;
        const actorId = (_a = data.actorId) !== null && _a !== void 0 ? _a : socket.id;
        const actor = session.snapshot.roster.find(member => member.entityId === actorId);
        if (!actor || ABILITY_NAME_BY_VEHICLE[actor.vehicleId] !== data.abilityName)
            return;
        if (actor.kind === 'human' && actor.entityId !== socket.id)
            return;
        if (actor.kind === 'bot' && session.hostSocketId !== socket.id)
            return;
        socket.to(session.snapshot.roomId).emit('abilityUsed', { playerId: actorId, abilityName: data.abilityName });
    });
    socket.on('hit', (data) => {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const session = matches.get(socket.data.matchId);
        if (!session || (0, match_1.resolveMatchPhase)(session.snapshot) !== 'playing' || !Number.isFinite(data.damage) || data.damage <= 0 || data.damage > 1500)
            return;
        const damageCap = DAMAGE_CAPS[(_a = data.weaponId) !== null && _a !== void 0 ? _a : ''];
        if (!damageCap || data.damage > damageCap)
            return;
        const attackerId = (_b = data.attackerId) !== null && _b !== void 0 ? _b : socket.id;
        const attacker = session.snapshot.roster.find(member => member.entityId === attackerId);
        const target = session.snapshot.roster.find(member => member.entityId === data.targetId);
        if (!attacker || !target || attacker.teamId === target.teamId || attackerId === target.entityId)
            return;
        if (data.weaponId !== attacker.weaponId && data.weaponId !== DAMAGE_ABILITY_BY_VEHICLE[attacker.vehicleId])
            return;
        if (attacker.kind === 'human' && attacker.entityId !== socket.id)
            return;
        if (attacker.kind === 'bot' && session.hostSocketId !== socket.id)
            return;
        const lastSequence = (_c = session.lastHitSequence.get(attackerId)) !== null && _c !== void 0 ? _c : 0;
        if (!Number.isInteger(data.sequence) || data.sequence <= lastSequence)
            return;
        session.lastHitSequence.set(attackerId, data.sequence);
        const health = (_d = session.health.get(target.entityId)) !== null && _d !== void 0 ? _d : 0;
        if (health <= 0)
            return;
        if (Date.now() < ((_e = session.invulnerableUntil.get(target.entityId)) !== null && _e !== void 0 ? _e : 0))
            return;
        const nextHealth = Math.max(0, health - data.damage);
        session.health.set(target.entityId, nextHealth);
        io.to(session.snapshot.roomId).emit('healthUpdate', { playerId: target.entityId, health: nextHealth });
        if (nextHealth > 0)
            return;
        session.kills.set(attacker.entityId, ((_f = session.kills.get(attacker.entityId)) !== null && _f !== void 0 ? _f : 0) + 1);
        session.deaths.set(target.entityId, ((_g = session.deaths.get(target.entityId)) !== null && _g !== void 0 ? _g : 0) + 1);
        session.snapshot.scores[attacker.teamId] += 1;
        io.to(session.snapshot.roomId).emit('combatantDestroyed', { attackerId: attacker.entityId, targetId: target.entityId, weaponId: (_h = data.weaponId) !== null && _h !== void 0 ? _h : 'weapon', scores: session.snapshot.scores });
        emitSnapshot(session);
        evaluateMatchEnd(session);
        if (session.snapshot.winner !== null)
            return;
        scheduleRespawn(session, target);
    });
    socket.on('requestRespawn', () => {
        var _a, _b;
        const session = matches.get(socket.data.matchId);
        if (!session || (0, match_1.resolveMatchPhase)(session.snapshot) !== 'playing')
            return;
        const target = session.snapshot.roster.find(member => member.entityId === socket.id && member.kind === 'human');
        if (!target)
            return;
        const health = (_a = session.health.get(target.entityId)) !== null && _a !== void 0 ? _a : 0;
        if (health > 0) {
            session.health.set(target.entityId, 0);
            session.deaths.set(target.entityId, ((_b = session.deaths.get(target.entityId)) !== null && _b !== void 0 ? _b : 0) + 1);
            io.to(session.snapshot.roomId).emit('healthUpdate', { playerId: target.entityId, health: 0 });
            io.to(session.snapshot.roomId).emit('combatantDestroyed', {
                attackerId: 'environment',
                targetId: target.entityId,
                weaponId: 'self-destruct',
                scores: session.snapshot.scores,
            });
        }
        scheduleRespawn(session, target);
    });
    socket.on('disconnect', () => {
        const queueIndex = matchmakingQueue.findIndex(entry => entry.socketId === socket.id);
        if (queueIndex >= 0)
            matchmakingQueue.splice(queueIndex, 1);
        players.delete(socket.id);
        const matchId = socketMatches.get(socket.id);
        const session = matchId ? matches.get(matchId) : undefined;
        if (session) {
            const member = session.snapshot.roster.find(candidate => candidate.entityId === socket.id);
            if (member)
                member.connected = false;
            io.to(session.snapshot.roomId).emit('playerDisconnected', socket.id);
            emitSnapshot(session);
            if (session.hostSocketId === socket.id && session.snapshot.winner === null) {
                endMatch(session, 'draw');
            }
        }
        socketMatches.delete(socket.id);
    });
});
const stopDeathRace = (0, race_1.installDeathRace)(io);
httpServer.on('close', stopDeathRace);
let stopping = false;
function shutdown() {
    return __awaiter(this, void 0, void 0, function* () {
        if (stopping)
            return;
        stopping = true;
        clearInterval(matchTimer);
        queueTimers.forEach(timer => clearTimeout(timer));
        stopDeathRace();
        const deadline = setTimeout(() => process.exit(1), 10000);
        deadline.unref();
        io.close(() => __awaiter(this, void 0, void 0, function* () { yield db_1.prisma.$disconnect(); clearTimeout(deadline); process.exit(0); }));
    });
}
process.on('SIGTERM', shutdown);
httpServer.listen(config_1.serverConfig.port, config_1.serverConfig.host, () => {
    console.log(`Listening on ${config_1.serverConfig.host}:${config_1.serverConfig.port}`);
    console.log(`Overdrive TDM server listening on port ${config_1.serverConfig.port}`);
});
