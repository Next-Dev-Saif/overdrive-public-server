"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.canTargetRacer = canTargetRacer;
exports.findRaceTarget = findRaceTarget;
const track_1 = require("./track");
/** Shared by server targeting and presentation: no shots through hills, walls or the infield. */
function canTargetRacer(actor, target, now, range) {
    if (actor.id === target.id || !target.connected || target.health <= 0 || target.finishedAt !== null || target.protectedUntil > now)
        return false;
    const dx = target.x - actor.x, dz = target.z - actor.z;
    const distance = Math.hypot(dx, dz);
    if (distance > range || Math.abs((0, track_1.normalizeAngle)(Math.atan2(dx, dz) - actor.yaw)) > Math.PI / 3)
        return false;
    const startY = (0, track_1.trackPose)((0, track_1.nearestTrack)(actor).along).y + 2;
    const endY = (0, track_1.trackPose)((0, track_1.nearestTrack)(target).along).y + 2;
    const samples = Math.max(2, Math.ceil(distance / 4));
    for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const road = (0, track_1.nearestTrack)({ x: actor.x + dx * t, z: actor.z + dz * t });
        if (road.distance > track_1.ROAD_WIDTH / 2 || (0, track_1.trackPose)(road.along).y > startY + (endY - startY) * t - .3)
            return false;
    }
    return true;
}
/** Preserve an existing valid lock, otherwise acquire the nearest visible opponent. */
function findRaceTarget(actor, racers, now, range) {
    const current = racers.find(target => target.id === actor.targetId);
    if (current && canTargetRacer(actor, current, now, range))
        return current;
    let closest, distance = Infinity;
    for (const target of racers) {
        const nextDistance = Math.hypot(target.x - actor.x, target.z - actor.z);
        if (nextDistance < distance && canTargetRacer(actor, target, now, range)) {
            closest = target;
            distance = nextDistance;
        }
    }
    return closest;
}
