import { planBotLane, botTrafficBrake } from './botDriving';
import { nearestTrack, normalizeAngle, ROAD_WIDTH, trackPose } from './track';
import { RACE_ABILITY, RACE_WEAPONS, type Racer, type RaceInput, type RacePickup } from './types';
import { canTargetRacer } from './combat';

/** Fixed-step road-constrained tire model with grade, progressive power and tire grip. Server owns position and impacts. */
export function driveRacer(car: Racer, input: RaceInput, dt: number): number {
    const speed = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
    const steerRate = Math.abs(speed) / (5.5 + Math.abs(speed) * .52);
    car.yaw = normalizeAngle(car.yaw + input.steer * steerRate * Math.sign(speed) * dt);
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), rx = fz, rz = -fx;
    let longitudinal = car.vx * fx + car.vz * fz;
    const lateral = (car.vx * rx + car.vz * rz) * Math.exp(-(input.brake ? 8 : 10) * dt);
    const roadPose = trackPose(nearestTrack(car).along);
    const uphill = roadPose.grade * (fx * roadPose.tx + fz * roadPose.tz);
    const power = input.throttle < 0 && longitudinal > 1 ? 32 : input.throttle < 0 ? 12 : 28 - Math.min(14, Math.abs(longitudinal) * .3);
    longitudinal += (input.throttle * power - longitudinal * .12 - longitudinal * Math.abs(longitudinal) * .005 - 9.81 * uphill) * dt;
    if (input.brake) longitudinal = Math.sign(longitudinal) * Math.max(0, Math.abs(longitudinal) - 34 * dt);
    longitudinal = Math.max(-10, Math.min(48, longitudinal));
    car.vx = fx * longitudinal + rx * lateral; car.vz = fz * longitudinal + rz * lateral;
    car.x += car.vx * dt; car.z += car.vz * dt;
    const road = nearestTrack(car), limit = ROAD_WIDTH / 2 - 2.3;
    let impact = 0;
    if (road.distance > limit) {
        const nx = (car.x - road.x) / road.distance, nz = (car.z - road.z) / road.distance;
        car.x = road.x + nx * limit; car.z = road.z + nz * limit;
        const outward = car.vx * nx + car.vz * nz;
        if (outward > 0) {
            car.vx -= outward * 1.15 * nx; car.vz -= outward * 1.15 * nz;
            impact = Math.max(0, outward - 8) * 1.5;
        }
    }
    return impact;
}

/** Look-ahead steering follows the road and brakes for upcoming curvature. */
export function botInput(car: Racer, lane: number, racers: Racer[] = [], now = 0, pickups: RacePickup[] = []): RaceInput {
    const road = nearestTrack(car), speed = Math.hypot(car.vx, car.vz);
    const chosenLane = planBotLane(car, lane, racers, pickups, now);
    const target = trackPose(road.along + 13 + speed * .45, chosenLane);
    const error = normalizeAngle(Math.atan2(target.x - car.x, target.z - car.z) - car.yaw);
    const ahead = trackPose(road.along + 38), current = trackPose(road.along);
    const bend = Math.abs(normalizeAngle(ahead.yaw - current.yaw));
    const farAhead = trackPose(road.along + 25 + speed * 1.3);
    const futureBend = Math.max(bend, Math.abs(normalizeAngle(farAhead.yaw - current.yaw)));
    const targetSpeed = Math.abs(error) > 1 ? 12 : futureBend > .6 ? 21 : futureBend > .3 ? 29 : 43;
    const opponent = racers.find(other => other.id === car.targetId);
    const stable = opponent !== undefined && now - car.targetSince >= 400;
    const fire = stable && car.weapon !== null && car.ammo > 0 && canTargetRacer(car, opponent, now, RACE_WEAPONS[car.weapon].range);
    const windup = RACE_ABILITY.windupMs / 1000;
    const predictedDistance = opponent ? Math.hypot(opponent.x - car.x + (opponent.vx - car.vx) * windup,
        opponent.z - car.z + (opponent.vz - car.vz) * windup) : Infinity;
    // Reserve lightning for a stable close opportunity, not a fleeting range-edge pass.
    const ability = stable && !car.abilityTarget && (!car.lastAbility || now - car.lastAbility >= RACE_ABILITY.cooldownMs) &&
        predictedDistance < RACE_ABILITY.range * .85 && canTargetRacer(car, opponent, now, RACE_ABILITY.range * .8) &&
        (car.ammo <= 0 || opponent.health <= RACE_ABILITY.damage || opponent.health > (car.weapon ? RACE_WEAPONS[car.weapon].damage : 0) || car.health < 200);
    return { throttle: Math.abs(error) > 1.2 ? .45 : 1, steer: Math.max(-1, Math.min(1, error * 2.4)),
        brake: speed > targetSpeed || botTrafficBrake(car, racers), fire, ability };
}

/** Equal-mass collision response keeps racers from passing through one another. */
export function collideRacers(a: Racer, b: Racer): void {
    const dx = b.x - a.x, dz = b.z - a.z, distance = Math.hypot(dx, dz), diameter = 4.8;
    if (distance >= diameter) return;
    const nx = distance > .001 ? dx / distance : 1, nz = distance > .001 ? dz / distance : 0;
    const overlap = (diameter - distance) * .5;
    a.x -= nx * overlap; a.z -= nz * overlap; b.x += nx * overlap; b.z += nz * overlap;
    const closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (closing > 0) { const impulse = closing * .6; a.vx -= nx * impulse; a.vz -= nz * impulse; b.vx += nx * impulse; b.vz += nz * impulse; }
}
