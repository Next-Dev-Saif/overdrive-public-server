"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.driveRacer = driveRacer;
exports.botInput = botInput;
exports.collideRacers = collideRacers;
const track_1 = require("./track");
/** Fixed-step road-constrained tire model with grade, progressive power and tire grip. Server owns position and impacts. */
function driveRacer(car, input, dt) {
    const speed = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
    const steerRate = Math.abs(speed) / (5.5 + Math.abs(speed) * .52);
    car.yaw = (0, track_1.normalizeAngle)(car.yaw + input.steer * steerRate * Math.sign(speed) * dt);
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = fz, rz = -fx;
    let longitudinal = car.vx * fx + car.vz * fz;
    const lateral = (car.vx * rx + car.vz * rz) * Math.exp(-(input.brake ? 8 : 10) * dt);
    const roadPose = (0, track_1.trackPose)((0, track_1.nearestTrack)(car).along);
    const uphill = roadPose.grade * (fx * roadPose.tx + fz * roadPose.tz);
    const power = input.throttle < 0 && longitudinal > 1 ? 32 : input.throttle < 0 ? 12 : 28 - Math.min(14, Math.abs(longitudinal) * .3);
    longitudinal += (input.throttle * power - longitudinal * .12 - longitudinal * Math.abs(longitudinal) * .005 - 9.81 * uphill) * dt;
    if (input.brake)
        longitudinal = Math.sign(longitudinal) * Math.max(0, Math.abs(longitudinal) - 34 * dt);
    longitudinal = Math.max(-10, Math.min(48, longitudinal));
    car.vx = fx * longitudinal + rx * lateral;
    car.vz = fz * longitudinal + rz * lateral;
    car.x += car.vx * dt;
    car.z += car.vz * dt;
    const road = (0, track_1.nearestTrack)(car), limit = track_1.ROAD_WIDTH / 2 - 2.3;
    let impact = 0;
    if (road.distance > limit) {
        const nx = (car.x - road.x) / road.distance, nz = (car.z - road.z) / road.distance;
        car.x = road.x + nx * limit;
        car.z = road.z + nz * limit;
        const outward = car.vx * nx + car.vz * nz;
        if (outward > 0) {
            car.vx -= outward * 1.15 * nx;
            car.vz -= outward * 1.15 * nz;
            impact = Math.max(0, outward - 8) * 1.5;
        }
    }
    return impact;
}
/** Look-ahead steering follows the road and brakes for upcoming curvature. */
function botInput(car, lane) {
    const road = (0, track_1.nearestTrack)(car), speed = Math.hypot(car.vx, car.vz);
    const target = (0, track_1.trackPose)(road.along + 13 + speed * .45, lane);
    const error = (0, track_1.normalizeAngle)(Math.atan2(target.x - car.x, target.z - car.z) - car.yaw);
    const ahead = (0, track_1.trackPose)(road.along + 38), current = (0, track_1.trackPose)(road.along);
    const bend = Math.abs((0, track_1.normalizeAngle)(ahead.yaw - current.yaw));
    const targetSpeed = bend > .6 ? 21 : bend > .3 ? 29 : 43;
    return { throttle: 1, steer: Math.max(-1, Math.min(1, error * 2.4)), brake: speed > targetSpeed, fire: true, ability: true };
}
/** Equal-mass collision response keeps racers from passing through one another. */
function collideRacers(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz), diameter = 4.8;
    if (distance >= diameter)
        return;
    const nx = distance > .001 ? dx / distance : 1, nz = distance > .001 ? dz / distance : 0;
    const overlap = (diameter - distance) * .5;
    a.x -= nx * overlap;
    a.z -= nz * overlap;
    b.x += nx * overlap;
    b.z += nz * overlap;
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (closing > 0) {
        const impulse = closing * .6;
        a.vx -= nx * impulse;
        a.vz -= nz * impulse;
        b.vx += nx * impulse;
        b.vz += nz * impulse;
    }
}
