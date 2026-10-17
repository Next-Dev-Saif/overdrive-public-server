"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NEUTRAL_INPUT = void 0;
exports.createRacer = createRacer;
exports.createPickups = createPickups;
exports.crossCheckpoint = crossCheckpoint;
exports.recoverRacer = recoverRacer;
exports.stepRace = stepRace;
exports.raceStandings = raceStandings;
const combat_1 = require("./combat");
const track_1 = require("./track");
const physics_1 = require("./physics");
const types_1 = require("./types");
exports.NEUTRAL_INPUT = { throttle: 0, steer: 0, brake: true, fire: false, ability: false };
function createRacer(id, name, slot, bot, color = '#e4e4e7') {
    const pose = (0, track_1.trackPose)(-10 - Math.floor(slot / 2) * 10, slot % 2 ? 4 : -4);
    return { id, name, bot, connected: true, color, x: pose.x, z: pose.z, yaw: pose.yaw, vx: 0, vz: 0, health: types_1.RACE_RULES.health, weapon: null, ammo: 0, lap: 0, nextGate: 0, started: false, progress: -10 - slot * 5, finishedAt: null, place: null, respawnAt: 0, protectedUntil: 0, lastShot: 0, recovery: 0, lastAbility: 0, targetId: null, targetSince: 0, abilityTarget: null, abilityImpactAt: 0 };
}
function createPickups() {
    const weapons = Object.keys(types_1.RACE_WEAPONS);
    const items = [...weapons, 'health', 'health'];
    return Array.from({ length: 10 }, (_, i) => ({ id: i, distance: 60 + i * (track_1.TRACK_LENGTH - 100) / 10, lane: i % 2 ? 4 : -4, item: items[i % items.length], availableAt: 0 }));
}
/** Only forward crossings of the next ordered gate can advance a lap. */
function crossCheckpoint(car, previous) {
    const gate = (0, track_1.trackPose)(track_1.LENGTHS[track_1.CHECKPOINTS[car.nextGate]]);
    const before = (previous.x - gate.x) * gate.tx + (previous.z - gate.z) * gate.tz;
    const after = (car.x - gate.x) * gate.tx + (car.z - gate.z) * gate.tz;
    if (before >= 0 || after < 0)
        return;
    const t = -before / (after - before);
    const x = previous.x + (car.x - previous.x) * t, z = previous.z + (car.z - previous.z) * t;
    if (Math.hypot(x - gate.x, z - gate.z) > track_1.ROAD_WIDTH / 2 + 1)
        return;
    if (car.nextGate === 0) {
        if (car.started)
            car.lap++;
        else
            car.started = true;
    }
    car.nextGate = (car.nextGate + 1) % track_1.CHECKPOINTS.length;
}
function recoverRacer(car, now) {
    if (car.finishedAt !== null || car.respawnAt > now)
        return;
    car.health = 0;
    car.weapon = null;
    car.ammo = 0;
    car.vx = 0;
    car.vz = 0;
    car.respawnAt = now + types_1.RACE_RULES.respawnMs;
    car.abilityTarget = null;
    car.abilityImpactAt = 0;
    car.targetId = null;
    car.targetSince = 0;
}
/** Authoritative fixed-step race: tire physics, gate order, pickup proximity, fire cadence and damage. */
function stepRace(state, inputs, now, dt) {
    var _a, _b, _c;
    const shots = [];
    state.serverTime = now;
    if (state.phase === 'loading' || state.phase === 'finished')
        return shots;
    if (now < state.startsAt) {
        state.phase = 'countdown';
        return shots;
    }
    state.phase = 'racing';
    for (let i = 0; i < state.racers.length; i++) {
        const car = state.racers[i];
        if (!car.connected || car.finishedAt !== null)
            continue;
        if (car.health <= 0) {
            if (now < car.respawnAt)
                continue;
            const lastGate = car.started ? (car.nextGate + track_1.CHECKPOINTS.length - 1) % track_1.CHECKPOINTS.length : 0;
            const pose = (0, track_1.trackPose)(track_1.LENGTHS[track_1.CHECKPOINTS[lastGate]] + (car.started ? 4 : -10), i % 2 ? 4 : -4);
            Object.assign(car, { x: pose.x, z: pose.z, yaw: pose.yaw, vx: 0, vz: 0, health: types_1.RACE_RULES.health, protectedUntil: now + 2000, respawnAt: 0 });
        }
        const previous = { x: car.x, z: car.z };
        const input = car.bot ? (0, physics_1.botInput)(car, (i % 3 - 1) * 4) : ((_a = inputs.get(car.id)) !== null && _a !== void 0 ? _a : exports.NEUTRAL_INPUT);
        car.health = Math.max(0, car.health - (0, physics_1.driveRacer)(car, input, dt));
        if (car.health <= 0) {
            recoverRacer(car, now);
            continue;
        }
        crossCheckpoint(car, previous);
        const along = (0, track_1.nearestTrack)(car).along;
        car.progress = car.lap * track_1.TRACK_LENGTH + (car.started ? along : along - track_1.TRACK_LENGTH);
        if (car.lap >= types_1.RACE_RULES.laps) {
            car.finishedAt = now;
            car.place = state.racers.filter(r => r.finishedAt !== null).length;
            car.vx = 0;
            car.vz = 0;
            car.abilityTarget = null;
            car.abilityImpactAt = 0;
            if (!state.winner) {
                state.winner = car.id;
                state.endsAt = Math.min(state.endsAt, now + types_1.RACE_RULES.finishGraceMs);
            }
            continue;
        }
        for (const pickup of state.pickups) {
            if (pickup.availableAt > now)
                continue;
            const point = (0, track_1.trackPose)(pickup.distance, pickup.lane);
            if (Math.hypot(car.x - point.x, car.z - point.z) > 4.5)
                continue;
            if (pickup.item === 'health') {
                car.health = Math.min(types_1.RACE_RULES.health, car.health + 200);
            }
            else {
                car.weapon = pickup.item;
                car.ammo = types_1.RACE_WEAPONS[pickup.item].ammo;
            }
            pickup.availableAt = now + types_1.RACE_RULES.pickupRespawnMs;
        }
        // Wind-up is authoritative; death, protection or loss of visibility cancels the impact.
        if (car.abilityTarget && now >= car.abilityImpactAt) {
            const victim = state.racers.find(other => other.id === car.abilityTarget);
            car.abilityTarget = null;
            car.abilityImpactAt = 0;
            if (victim && (0, combat_1.canTargetRacer)(car, victim, now, types_1.RACE_ABILITY.range)) {
                shots.push({ actor: car.id, target: victim.id, weapon: 'lightning', x: car.x, z: car.z, hitX: victim.x, hitZ: victim.z });
                victim.health = Math.max(0, victim.health - types_1.RACE_ABILITY.damage);
                if (victim.health <= 0)
                    recoverRacer(victim, now);
            }
        }
        if (input.ability && !car.abilityTarget && (!car.lastAbility || now - car.lastAbility >= types_1.RACE_ABILITY.cooldownMs)) {
            const victim = (0, combat_1.findRaceTarget)(car, state.racers, now, types_1.RACE_ABILITY.range);
            if (victim) {
                car.lastAbility = now;
                car.abilityTarget = victim.id;
                car.abilityImpactAt = now + types_1.RACE_ABILITY.windupMs;
            }
        }
        const target = car.weapon && car.ammo > 0 ? (0, combat_1.findRaceTarget)(car, state.racers, now, types_1.RACE_WEAPONS[car.weapon].range) : undefined;
        if (car.targetId !== ((_b = target === null || target === void 0 ? void 0 : target.id) !== null && _b !== void 0 ? _b : null)) {
            car.targetId = (_c = target === null || target === void 0 ? void 0 : target.id) !== null && _c !== void 0 ? _c : null;
            car.targetSince = now;
        }
        if (!input.fire || !car.weapon || car.ammo <= 0 || now - car.targetSince < 220)
            continue;
        const weapon = types_1.RACE_WEAPONS[car.weapon];
        if (now - car.lastShot < weapon.interval)
            continue;
        if (!target)
            continue;
        car.lastShot = now;
        car.ammo--;
        shots.push({ actor: car.id, target: target.id, weapon: car.weapon, x: car.x, z: car.z, hitX: target.x, hitZ: target.z });
        target.health = Math.max(0, target.health - weapon.damage);
        if (target.health <= 0)
            recoverRacer(target, now);
    }
    const active = state.racers.filter(car => car.connected && car.health > 0 && car.finishedAt === null);
    for (let i = 0; i < active.length; i++)
        for (let j = i + 1; j < active.length; j++)
            (0, physics_1.collideRacers)(active[i], active[j]);
    if (now >= state.endsAt || state.racers.every(car => !car.connected || car.finishedAt !== null))
        state.phase = 'finished';
    return shots;
}
function raceStandings(racers) {
    return [...racers].sort((a, b) => { var _a, _b; return ((_a = a.place) !== null && _a !== void 0 ? _a : 999) - ((_b = b.place) !== null && _b !== void 0 ? _b : 999) || Number(b.connected) - Number(a.connected) || b.progress - a.progress; });
}
