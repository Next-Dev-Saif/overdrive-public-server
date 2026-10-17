"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.installDeathRace = installDeathRace;
const simulation_1 = require("../../shared/race/simulation");
const types_1 = require("../../shared/race/types");
/** Separate queue and server simulation; clients can submit controls, never positions, laps, hits or pickup claims. */
function installDeathRace(io) {
    const queue = new Map();
    const sessions = new Map();
    let queueTimer;
    const launch = () => {
        clearTimeout(queueTimer);
        queueTimer = undefined;
        const humans = [...queue.values()].filter(socket => socket.connected).slice(0, types_1.RACE_RULES.racers);
        if (!humans.length) {
            queue.clear();
            return;
        }
        humans.forEach(socket => queue.delete(socket.id));
        const now = Date.now(), id = `race-${now}-${humans[0].id}`;
        const racers = humans.map((socket, i) => { var _a; return (0, simulation_1.createRacer)(socket.id, String((_a = socket.data.username) !== null && _a !== void 0 ? _a : 'DRIVER').slice(0, 24), i, false, socket.data.raceColor); });
        while (racers.length < types_1.RACE_RULES.racers) {
            const i = racers.length;
            racers.push((0, simulation_1.createRacer)(`${id}:bot:${i}`, `RIVAL ${i + 1}`, i, true, ['#aeb3bc', '#eeede6', '#636973'][i % 3]));
        }
        const state = { id, phase: 'loading', serverTime: now, startsAt: 0, endsAt: 0, racers, pickups: (0, simulation_1.createPickups)(), winner: null };
        sessions.set(id, { state, inputs: new Map(), ready: new Set(), lastInput: new Map(), loadingDeadline: now + 30000, finishedAt: 0 });
        for (const socket of humans) {
            socket.data.raceId = id;
            socket.join(id);
            socket.emit('race:found', { snapshot: state, localId: socket.id });
        }
        if (queue.size)
            queueTimer = setTimeout(launch, types_1.RACE_RULES.queueMs);
    };
    const attach = (socket) => {
        socket.on('race:queue', (data) => {
            if (socket.data.raceId || socket.data.matchId)
                return;
            for (const queued of queue.values())
                if (queued.data.userId === socket.data.userId) {
                    queue.delete(queued.id);
                    if (queued !== socket)
                        queued.emit('race:error', 'Race search moved to another connection.');
                }
            socket.data.raceColor = typeof (data === null || data === void 0 ? void 0 : data.color) === 'string' && /^#[0-9a-f]{6}$/i.test(data.color) ? data.color : '#e4e4e7';
            queue.set(socket.id, socket);
            if (queue.size >= types_1.RACE_RULES.racers)
                launch();
            else if (!queueTimer)
                queueTimer = setTimeout(launch, types_1.RACE_RULES.queueMs);
        });
        const leave = () => {
            queue.delete(socket.id);
            const session = sessions.get(socket.data.raceId);
            const racer = session === null || session === void 0 ? void 0 : session.state.racers.find(car => car.id === socket.id);
            if (racer) {
                racer.connected = false;
                session.inputs.delete(socket.id);
            }
            if (socket.data.raceId)
                socket.leave(socket.data.raceId);
            delete socket.data.raceId;
        };
        socket.on('race:leave', leave);
        socket.on('disconnect', leave);
        socket.on('race:ready', () => { const session = sessions.get(socket.data.raceId); if (session)
            session.ready.add(socket.id); });
        socket.on('race:input', (input) => {
            var _a;
            const session = sessions.get(socket.data.raceId), now = Date.now();
            if (!session || now - ((_a = session.lastInput.get(socket.id)) !== null && _a !== void 0 ? _a : 0) < 10)
                return;
            if (!input || !Number.isFinite(input.throttle) || !Number.isFinite(input.steer) || typeof input.brake !== 'boolean' || typeof input.fire !== 'boolean' || (input.ability !== undefined && typeof input.ability !== 'boolean'))
                return;
            session.lastInput.set(socket.id, now);
            session.inputs.set(socket.id, { throttle: Math.max(-1, Math.min(1, input.throttle)), steer: Math.max(-1, Math.min(1, input.steer)), brake: input.brake, fire: input.fire, ability: input.ability === true });
        });
        socket.on('race:recover', () => {
            const session = sessions.get(socket.data.raceId), now = Date.now();
            const racer = session === null || session === void 0 ? void 0 : session.state.racers.find(car => car.id === socket.id);
            if (!session || session.state.phase !== 'racing' || !racer || now - racer.recovery < 8000)
                return;
            racer.recovery = now;
            (0, simulation_1.recoverRacer)(racer, now);
        });
    };
    io.on('connection', attach);
    let last = Date.now(), accumulator = 0, lastSnapshot = 0;
    const timer = setInterval(() => {
        var _a;
        const now = Date.now();
        accumulator += Math.min(100, now - last);
        last = now;
        for (const [id, session] of sessions) {
            if (!session.state.racers.some(car => !car.bot && car.connected) || (session.finishedAt && now - session.finishedAt > 60000)) {
                sessions.delete(id);
                continue;
            }
            if (session.state.phase === 'loading') {
                const humans = session.state.racers.filter(car => !car.bot && car.connected);
                if (humans.every(car => session.ready.has(car.id)) || now > session.loadingDeadline) {
                    // A client that never loads cannot hold the grid indefinitely.
                    for (const car of humans)
                        if (!session.ready.has(car.id)) {
                            car.connected = false;
                            io.to(car.id).emit('race:error', 'Loading timed out. Please retry.');
                        }
                    session.state.startsAt = now + types_1.RACE_RULES.countdownMs;
                    session.state.endsAt = session.state.startsAt + types_1.RACE_RULES.maxRaceMs;
                    session.state.phase = 'countdown';
                }
            }
            for (const car of session.state.racers)
                if (!car.bot && now - ((_a = session.lastInput.get(car.id)) !== null && _a !== void 0 ? _a : 0) > 500)
                    session.inputs.set(car.id, simulation_1.NEUTRAL_INPUT);
        }
        while (accumulator >= 1000 / 60) {
            accumulator -= 1000 / 60;
            for (const session of sessions.values()) {
                const shots = (0, simulation_1.stepRace)(session.state, session.inputs, now - accumulator, 1 / 60);
                if (shots.length)
                    io.to(session.state.id).emit('race:shots', shots);
                if (session.state.phase === 'finished' && !session.finishedAt)
                    session.finishedAt = now;
            }
        }
        if (now - lastSnapshot >= 50) {
            lastSnapshot = now;
            for (const session of sessions.values())
                io.to(session.state.id).emit('race:snapshot', session.state);
        }
    }, 1000 / 60);
    timer.unref();
    return () => { clearInterval(timer); clearTimeout(queueTimer); io.off('connection', attach); sessions.clear(); queue.clear(); };
}
