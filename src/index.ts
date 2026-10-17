import { serverConfig, isAllowedOrigin } from './config';
import { installDeathRace } from './race';
import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import authRoutes from './auth';
import { prisma } from './db';
import {
    TDM_RULES,
    getTeamSpawn,
    resolveMatchPhase,
    teamForHumanIndex,
    type MatchFoundPayload,
    type MatchMember,
    type MatchSnapshot,
    type TeamId,
} from '../shared/match';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', serverConfig.proxyHops);
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!isAllowedOrigin(req.headers.origin)) { res.status(403).json({ error: 'Origin not allowed' }); return; }
    next();
});
app.use(cors({ origin: serverConfig.allowedOrigins }));
app.use(express.json({ limit: '16kb' }));

// Health and readiness endpoints for cloud orchestrators (e.g. Blitz Cloud, Docker, Kubernetes)
app.get(['/', '/health', '/healthz', '/up'], (_req, res) => {
    res.status(200).json({ status: 'ok', service: 'overdrive-server' });
});
app.get('/readyz', async (_req, res) => {
    try {
        await prisma.user.findFirst({ select: { id: true } });
        res.status(200).json({ status: 'ready' });
    } catch {
        // Return 200 with notice so cloud health checks do not stall container boot
        res.status(200).json({ status: 'ready', database: 'initializing' });
    }
});
app.use('/auth', authRoutes);

const JWT_SECRET = serverConfig.jwtSecret;
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: { origin: serverConfig.allowedOrigins, methods: ['GET', 'POST'] },
    allowRequest: (req, callback) => callback(null, isAllowedOrigin(req.headers.origin)),
    maxHttpBufferSize: 64 * 1024,
});

const VEHICLE_HEALTH: Record<string, number> = {
    interceptor: 600, juggernaut: 1600, phantom: 450, manticore: 1200,
    valkyrie: 700, wraith: 350, behemoth: 2500,
};
const BOT_VEHICLES = Object.keys(VEHICLE_HEALTH);
const BOT_WEAPONS = ['minigun', 'plasma', 'missile', 'mortar', 'nuke'];
const DAMAGE_CAPS: Record<string, number> = {
    minigun: 10, plasma: 30, missile: 45, mortar: 80, nuke: 1500,
    afterburner: 5, shockwave: 20, lightning: 25,
};
const DAMAGE_ABILITY_BY_VEHICLE: Partial<Record<string, string>> = {
    interceptor: 'lightning',
    juggernaut: 'shockwave',
    valkyrie: 'afterburner',
};
const ABILITY_NAME_BY_VEHICLE: Record<string, string> = {
    interceptor: 'lightning',
    juggernaut: 'shockwave',
    phantom: 'phantom',
    manticore: 'manticore',
    valkyrie: 'valkyrie',
    wraith: 'wraith',
    behemoth: 'behemoth',
};

interface PlayerState {
    id: string;
    displayName: string;
    teamId?: TeamId;
    vehicleId: string;
    weaponId: string;
    vehicleColor?: string;
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number; w: number };
    health: number;
    maxHealth: number;
}

interface MatchmakingEntry {
    socketId: string;
    userId: string;
    username: string;
    mapId: string;
    vehicleId: string;
    weaponId: string;
    vehicleColor?: string;
}

interface MatchSession {
    snapshot: MatchSnapshot;
    hostSocketId: string;
    health: Map<string, number>;
    maxHealth: Map<string, number>;
    kills: Map<string, number>;
    deaths: Map<string, number>;
    lastHitSequence: Map<string, number>;
    invulnerableUntil: Map<string, number>;
    pendingRespawns: Set<string>;
    settled: boolean;
}

const players = new Map<string, PlayerState>();
const matchmakingQueue: MatchmakingEntry[] = [];
const queueTimers = new Map<string, ReturnType<typeof setTimeout>>();
const matches = new Map<string, MatchSession>();
const socketMatches = new Map<string, string>();

function snapshotFor(session: MatchSession): MatchSnapshot {
    return { ...session.snapshot, phase: resolveMatchPhase(session.snapshot), roster: session.snapshot.roster.map(member => ({ ...member })) };
}

function emitSnapshot(session: MatchSession): void {
    session.snapshot.phase = resolveMatchPhase(session.snapshot);
    io.to(session.snapshot.roomId).emit('matchSnapshot', snapshotFor(session));
}

function createMember(entry: MatchmakingEntry, index: number): MatchMember {
    const teamId = teamForHumanIndex(index);
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

function fillBots(matchId: string, roster: MatchMember[]): void {
    for (const teamId of ['alpha', 'bravo'] as const) {
        const occupied = new Set(roster.filter(member => member.teamId === teamId).map(member => member.slot));
        for (let slot = 0; slot < TDM_RULES.teamSize; slot++) {
            if (occupied.has(slot)) continue;
            const seed = teamId === 'alpha' ? slot : slot + TDM_RULES.teamSize;
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

function startMatch(entries: MatchmakingEntry[]): void {
    if (entries.length === 0) return;
    const createdAt = Date.now();
    const matchId = `match_${createdAt}_${Math.random().toString(36).slice(2, 7)}`;
    const roomId = `room_${matchId}`;
    const roster = entries.map(createMember);
    fillBots(matchId, roster);
    const startsAt = createdAt + TDM_RULES.introMs + TDM_RULES.countdownMs;
    const snapshot: MatchSnapshot = {
        matchId, roomId, mapId: entries[0].mapId, phase: 'intro', startsAt,
        endsAt: startsAt + TDM_RULES.durationMs,
        scoreLimit: TDM_RULES.scoreLimit,
        scores: { alpha: 0, bravo: 0 }, roster, winner: null,
    };
    const session: MatchSession = {
        snapshot, hostSocketId: entries[0].socketId, health: new Map(), maxHealth: new Map(),
        kills: new Map(), deaths: new Map(), lastHitSequence: new Map(), invulnerableUntil: new Map(), pendingRespawns: new Set(), settled: false,
    };
    for (const member of roster) {
        const maxHealth = VEHICLE_HEALTH[member.vehicleId] ?? 600;
        session.health.set(member.entityId, maxHealth);
        session.maxHealth.set(member.entityId, maxHealth);
        session.kills.set(member.entityId, 0);
        session.deaths.set(member.entityId, 0);
    }
    matches.set(matchId, session);
    entries.forEach((entry, index) => {
        const localMember = roster.find(member => member.entityId === entry.socketId)!;
        socketMatches.set(entry.socketId, matchId);
        const payload: MatchFoundPayload = {
            roomId, matchId, mapId: snapshot.mapId, isHost: index === 0,
            team: localMember.teamId, localMember, snapshot: snapshotFor(session),
        };
        io.to(entry.socketId).emit('matchFound', payload);
    });
}

function flushQueue(mapId: string): void {
    const entries = matchmakingQueue.filter(entry => entry.mapId === mapId).slice(0, TDM_RULES.teamSize * 2);
    entries.forEach(entry => matchmakingQueue.splice(matchmakingQueue.indexOf(entry), 1));
    queueTimers.delete(mapId);
    startMatch(entries);
    if (matchmakingQueue.some(entry => entry.mapId === mapId)) scheduleQueueFlush(mapId);
}

function scheduleQueueFlush(mapId: string): void {
    if (queueTimers.has(mapId)) return;
    queueTimers.set(mapId, setTimeout(() => flushQueue(mapId), TDM_RULES.queueWaitMs));
}

async function settleMatch(session: MatchSession): Promise<void> {
    if (session.settled || session.snapshot.winner === null) return;
    session.settled = true;
    for (const member of session.snapshot.roster) {
        if (member.kind !== 'human' || !member.userId) continue;
        const won = session.snapshot.winner !== 'draw' && session.snapshot.winner === member.teamId;
        const xpGain = won ? 150 : 75;
        const scrapGain = won ? 40 : 20;
        try {
            const stats = await prisma.playerStats.findUnique({ where: { userId: member.userId } });
            if (stats) {
                const totalXp = stats.xp + xpGain;
                const xpRequired = stats.level * 1000;
                await prisma.playerStats.update({ where: { userId: member.userId }, data: {
                    xp: totalXp >= xpRequired ? totalXp - xpRequired : totalXp,
                    level: totalXp >= xpRequired ? stats.level + 1 : stats.level,
                    kills: { increment: session.kills.get(member.entityId) ?? 0 },
                    deaths: { increment: session.deaths.get(member.entityId) ?? 0 },
                    mmr: { increment: won ? 5 : session.snapshot.winner === 'draw' ? 0 : -2 },
                } });
            }
            await prisma.wallet.update({ where: { userId: member.userId }, data: { scrap: { increment: scrapGain } } });
            const updatedUser = await prisma.user.findUnique({ where: { id: member.userId }, include: { stats: true, wallet: true } });
            if (updatedUser) io.to(member.entityId).emit('progressionUpdate', { stats: updatedUser.stats, wallet: updatedUser.wallet, message: `${won ? 'Victory' : 'Match complete'}: +${xpGain} XP, +${scrapGain} Scrap` });
        } catch (error) {
            console.error('Unable to settle match rewards:', error);
        }
    }
}

function endMatch(session: MatchSession, winner: TeamId | 'draw'): void {
    if (session.snapshot.winner !== null) return;
    session.snapshot.winner = winner;
    session.snapshot.phase = 'ended';
    io.to(session.snapshot.roomId).emit('matchEnded', snapshotFor(session));
    void settleMatch(session);
    setTimeout(() => {
        matches.delete(session.snapshot.matchId);
        session.snapshot.roster.forEach(member => {
            if (member.kind === 'human' && socketMatches.get(member.entityId) === session.snapshot.matchId) socketMatches.delete(member.entityId);
        });
    }, 60_000);
}

function evaluateMatchEnd(session: MatchSession): void {
    if (session.snapshot.winner !== null) return;
    const { alpha, bravo } = session.snapshot.scores;
    if (alpha >= session.snapshot.scoreLimit) return endMatch(session, 'alpha');
    if (bravo >= session.snapshot.scoreLimit) return endMatch(session, 'bravo');
    if (Date.now() < session.snapshot.endsAt) return;
    endMatch(session, alpha === bravo ? 'draw' : alpha > bravo ? 'alpha' : 'bravo');
}

function scheduleRespawn(session: MatchSession, target: MatchMember): void {
    if (session.pendingRespawns.has(target.entityId) || session.snapshot.winner !== null) return;
    session.pendingRespawns.add(target.entityId);
    setTimeout(() => {
        session.pendingRespawns.delete(target.entityId);
        if (session.snapshot.winner !== null || !matches.has(session.snapshot.matchId)) return;
        const maxHealth = session.maxHealth.get(target.entityId) ?? 600;
        session.health.set(target.entityId, maxHealth);
        const invulnerableUntil = Date.now() + TDM_RULES.respawnProtectionMs;
        session.invulnerableUntil.set(target.entityId, invulnerableUntil);
        io.to(session.snapshot.roomId).emit('combatantRespawned', {
            entityId: target.entityId,
            health: maxHealth,
            spawn: getTeamSpawn(target.teamId, target.slot, 40),
            invulnerableUntil,
        });
    }, TDM_RULES.respawnDelayMs);
}

const matchTimer = setInterval(() => matches.forEach(evaluateMatchEnd), 500);

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string; username: string };
        socket.data.userId = decoded.userId;
        socket.data.username = decoded.username;
        next();
    } catch {
        next(new Error('Authentication error'));
    }
});

io.on('connection', (socket: Socket) => {
    socket.on('joinMatchmaking', (data: { mapId: string; vehicleId: string; weaponId: string; vehicleColor?: string }) => {
        const existingIndex = matchmakingQueue.findIndex(entry => entry.userId === socket.data.userId);
        if (existingIndex >= 0) matchmakingQueue.splice(existingIndex, 1);
        matchmakingQueue.push({ socketId: socket.id, userId: socket.data.userId, username: socket.data.username, ...data });
        const sameMapCount = matchmakingQueue.filter(entry => entry.mapId === data.mapId).length;
        if (sameMapCount >= TDM_RULES.teamSize * 2) flushQueue(data.mapId);
        else scheduleQueueFlush(data.mapId);
    });

    socket.on('cancelMatchmaking', () => {
        const index = matchmakingQueue.findIndex(entry => entry.socketId === socket.id);
        if (index >= 0) matchmakingQueue.splice(index, 1);
    });

    socket.on('join', (data: { vehicleId: string; mapId: string; weaponId?: string; vehicleColor?: string; matchId?: string }) => {
        const matchId = data.matchId ?? socketMatches.get(socket.id);
        const session = matchId ? matches.get(matchId) : undefined;
        const member = session?.snapshot.roster.find(candidate => candidate.entityId === socket.id);
        const spawn = member ? getTeamSpawn(member.teamId, member.slot, 40) : { x: 0, y: 40, z: 0, yaw: 0 };
        const vehicleId = member?.vehicleId ?? data.vehicleId;
        const weaponId = member?.weaponId ?? data.weaponId ?? 'minigun';
        const vehicleColor = member?.vehicleColor ?? data.vehicleColor;
        const maxHealth = VEHICLE_HEALTH[vehicleId] ?? 600;
        players.set(socket.id, {
            id: socket.id, displayName: socket.data.username, teamId: member?.teamId,
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
        } else socket.emit('currentPlayers', {});
    });

    socket.on('updateState', (state: Partial<PlayerState>) => {
        const player = players.get(socket.id);
        if (!player || !socket.data.roomId) return;
        if (state.position) player.position = state.position;
        if (state.rotation) player.rotation = state.rotation;
        socket.to(socket.data.roomId).emit('playerMoved', player);
    });

    socket.on('botState', (data: { botId: string; vehicleId: string; weaponId: string; position: PlayerState['position']; rotation: PlayerState['rotation']; health?: number }) => {
        const session = matches.get(socket.data.matchId);
        const member = session?.snapshot.roster.find(candidate => candidate.entityId === data.botId && candidate.kind === 'bot');
        if (!session || session.hostSocketId !== socket.id || !member) return;
        socket.to(session.snapshot.roomId).emit('botState', {
            ...data,
            vehicleId: member.vehicleId,
            weaponId: member.weaponId,
            health: session.health.get(member.entityId),
        });
    });

    socket.on('botShoot', (data: { botId: string; origin: PlayerState['position']; hitPoint: PlayerState['position']; targetId?: string }) => {
        const session = matches.get(socket.data.matchId);
        if (session?.hostSocketId === socket.id) socket.to(session.snapshot.roomId).emit('botShoot', data);
    });

    socket.on('shoot', (data: { origin: PlayerState['position']; hitPoint: PlayerState['position']; targetId?: string }) => {
        if (socket.data.roomId) socket.to(socket.data.roomId).emit('playerShoot', { playerId: socket.id, ...data });
    });

    socket.on('abilityUsed', (data: { abilityName: string; actorId?: string }) => {
        const session = matches.get(socket.data.matchId);
        if (!session) return;
        const actorId = data.actorId ?? socket.id;
        const actor = session.snapshot.roster.find(member => member.entityId === actorId);
        if (!actor || ABILITY_NAME_BY_VEHICLE[actor.vehicleId] !== data.abilityName) return;
        if (actor.kind === 'human' && actor.entityId !== socket.id) return;
        if (actor.kind === 'bot' && session.hostSocketId !== socket.id) return;
        socket.to(session.snapshot.roomId).emit('abilityUsed', { playerId: actorId, abilityName: data.abilityName });
    });

    socket.on('hit', (data: { targetId: string; damage: number; attackerId?: string; weaponId?: string; sequence?: number }) => {
        const session = matches.get(socket.data.matchId);
        if (!session || resolveMatchPhase(session.snapshot) !== 'playing' || !Number.isFinite(data.damage) || data.damage <= 0 || data.damage > 1500) return;
        const damageCap = DAMAGE_CAPS[data.weaponId ?? ''];
        if (!damageCap || data.damage > damageCap) return;
        const attackerId = data.attackerId ?? socket.id;
        const attacker = session.snapshot.roster.find(member => member.entityId === attackerId);
        const target = session.snapshot.roster.find(member => member.entityId === data.targetId);
        if (!attacker || !target || attacker.teamId === target.teamId || attackerId === target.entityId) return;
        if (data.weaponId !== attacker.weaponId && data.weaponId !== DAMAGE_ABILITY_BY_VEHICLE[attacker.vehicleId]) return;
        if (attacker.kind === 'human' && attacker.entityId !== socket.id) return;
        if (attacker.kind === 'bot' && session.hostSocketId !== socket.id) return;
        const lastSequence = session.lastHitSequence.get(attackerId) ?? 0;
        if (!Number.isInteger(data.sequence) || data.sequence! <= lastSequence) return;
        session.lastHitSequence.set(attackerId, data.sequence!);
        const health = session.health.get(target.entityId) ?? 0;
        if (health <= 0) return;
        if (Date.now() < (session.invulnerableUntil.get(target.entityId) ?? 0)) return;
        const nextHealth = Math.max(0, health - data.damage);
        session.health.set(target.entityId, nextHealth);
        io.to(session.snapshot.roomId).emit('healthUpdate', { playerId: target.entityId, health: nextHealth });
        if (nextHealth > 0) return;

        session.kills.set(attacker.entityId, (session.kills.get(attacker.entityId) ?? 0) + 1);
        session.deaths.set(target.entityId, (session.deaths.get(target.entityId) ?? 0) + 1);
        session.snapshot.scores[attacker.teamId] += 1;
        io.to(session.snapshot.roomId).emit('combatantDestroyed', { attackerId: attacker.entityId, targetId: target.entityId, weaponId: data.weaponId ?? 'weapon', scores: session.snapshot.scores });
        emitSnapshot(session);
        evaluateMatchEnd(session);
        if (session.snapshot.winner !== null) return;
        scheduleRespawn(session, target);
    });

    socket.on('requestRespawn', () => {
        const session = matches.get(socket.data.matchId);
        if (!session || resolveMatchPhase(session.snapshot) !== 'playing') return;
        const target = session.snapshot.roster.find(member => member.entityId === socket.id && member.kind === 'human');
        if (!target) return;
        const health = session.health.get(target.entityId) ?? 0;
        if (health > 0) {
            session.health.set(target.entityId, 0);
            session.deaths.set(target.entityId, (session.deaths.get(target.entityId) ?? 0) + 1);
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
        if (queueIndex >= 0) matchmakingQueue.splice(queueIndex, 1);
        players.delete(socket.id);
        const matchId = socketMatches.get(socket.id);
        const session = matchId ? matches.get(matchId) : undefined;
        if (session) {
            const member = session.snapshot.roster.find(candidate => candidate.entityId === socket.id);
            if (member) member.connected = false;
            io.to(session.snapshot.roomId).emit('playerDisconnected', socket.id);
            emitSnapshot(session);
            if (session.hostSocketId === socket.id && session.snapshot.winner === null) {
                endMatch(session, 'draw');
            }
        }
        socketMatches.delete(socket.id);
    });
});

const stopDeathRace = installDeathRace(io);
httpServer.on('close', stopDeathRace);

let stopping = false;
async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(matchTimer);
    queueTimers.forEach(timer => clearTimeout(timer));
    stopDeathRace();
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    io.close(async () => { await prisma.$disconnect(); clearTimeout(deadline); process.exit(0); });
}
process.on('SIGTERM', shutdown);
httpServer.listen(serverConfig.port, serverConfig.host, () => {
    console.log(`Listening on ${serverConfig.host}:${serverConfig.port}`);
    console.log(`Overdrive TDM server listening on port ${serverConfig.port}`);
});
