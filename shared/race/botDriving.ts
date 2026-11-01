import { nearestTrack, ROAD_WIDTH, TRACK_LENGTH, trackPose } from './track';
import { RACE_RULES, type RacePickup, type Racer } from './types';

interface DrivingMemory { lane: number; nextPlan: number; x: number; z: number }
const memory = new WeakMap<Racer, DrivingMemory>();

/** Score paved lanes for future traffic, incoming lightning and useful pickups; hold a lane to avoid twitching. */
export function planBotLane(car: Racer, preferredLane: number, racers: Racer[], pickups: RacePickup[], now: number): number {
    const road = nearestTrack(car);
    let plan = memory.get(car);
    if (plan && now < plan.nextPlan && Math.hypot(car.x - plan.x, car.z - plan.z) < 30) return plan.lane;
    const limit = ROAD_WIDTH / 2 - 5;
    const lanes = [-limit, 0, limit, Math.max(-limit, Math.min(limit, preferredLane))];
    const speed = Math.hypot(car.vx, car.vz);
    let bestLane = preferredLane, bestScore = Infinity;
    for (const lane of lanes) {
        let score = Math.abs(lane - preferredLane) * .25 + Math.abs(lane - road.lateral) * .5;
        if (plan && Math.abs(lane - plan.lane) > 1) score += 3;
        for (const other of racers) {
            if (other === car || !other.connected || other.health <= 0 || other.finishedAt !== null) continue;
            if (Math.hypot(other.x - car.x, other.z - car.z) > 85) continue;
            // Two future samples catch a car beside us as well as a slower car ahead.
            for (const seconds of [.35, 1]) {
                const pose = trackPose(road.along + speed * seconds, road.lateral + (lane - road.lateral) * seconds);
                const gap = Math.hypot(pose.x - other.x - other.vx * seconds, pose.z - other.z - other.vz * seconds);
                score += Math.max(0, 8 - gap) ** 2 * 4;
            }
            if (other.abilityTarget === car.id && other.abilityImpactAt > now) {
                const pose = trackPose(road.along + speed * .8, lane);
                // Increase separation during a telegraphed attack without leaving the road.
                score += Math.max(0, 85 - Math.hypot(pose.x - other.x - other.vx * .8, pose.z - other.z - other.vz * .8)) * .15;
            }
        }
        for (const pickup of pickups) {
            const ahead = (pickup.distance - road.along + TRACK_LENGTH) % TRACK_LENGTH;
            if (ahead < 4 || ahead > 45 || pickup.availableAt > now + ahead / Math.max(5, speed) * 1000) continue;
            const useful = pickup.item === 'health' ? car.health < RACE_RULES.health * .65 : car.ammo <= 0;
            if (useful && Math.abs(lane - pickup.lane) < 4) score -= 7 * (1 - ahead / 60);
        }
        if (score < bestScore) { bestScore = score; bestLane = lane; }
    }
    plan = { lane: bestLane, nextPlan: now + 500, x: car.x, z: car.z };
    memory.set(car, plan);
    return bestLane;
}

/** Closing-speed headway braking allows overtaking without driving through the lead car. */
export function botTrafficBrake(car: Racer, racers: Racer[]): boolean {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
    // Keep enough creep for steering out of a stopped queue.
    if (Math.hypot(car.vx, car.vz) < 2) return false;
    return racers.some(other => {
        if (other === car || !other.connected || other.health <= 0 || other.finishedAt !== null) return false;
        const dx = other.x - car.x, dz = other.z - car.z;
        const ahead = dx * fx + dz * fz, lateral = Math.abs(dx * fz - dz * fx);
        const closing = (car.vx - other.vx) * fx + (car.vz - other.vz) * fz;
        return ahead > 0 && lateral < 4.8 && ahead < 6 + Math.max(0, closing) * .8;
    });
}
