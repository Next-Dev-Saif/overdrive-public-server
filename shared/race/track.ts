/** Shared authored tarmac centerline. Physics, checkpoints, scenery and HUD use the same samples. */
export interface Point2 { x: number; z: number }
export const RACE_MAP_ID = 'blacktop';
export const ROAD_WIDTH = 24;
const anchors: Point2[] = [
    { x: 0, z: -180 }, { x: 105, z: -180 }, { x: 175, z: -110 },
    { x: 145, z: -15 }, { x: 185, z: 75 }, { x: 120, z: 160 },
    { x: 0, z: 180 }, { x: -120, z: 160 }, { x: -180, z: 70 },
    { x: -145, z: -20 }, { x: -175, z: -115 }, { x: -95, z: -180 },
];
const curve = (a: number, b: number, c: number, d: number, t: number) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const SAMPLES_PER_ANCHOR = 24;
export const TRACK = anchors.flatMap((b, i) => Array.from({ length: SAMPLES_PER_ANCHOR }, (_, j) => {
    const a = anchors[(i + anchors.length - 1) % anchors.length], c = anchors[(i + 1) % anchors.length], d = anchors[(i + 2) % anchors.length];
    return { x: curve(a.x, b.x, c.x, d.x, j / SAMPLES_PER_ANCHOR), z: curve(a.z, b.z, c.z, d.z, j / SAMPLES_PER_ANCHOR) };
}));
export const LENGTHS = [0];
for (let i = 0; i < TRACK.length; i++) LENGTHS.push(LENGTHS[i] + Math.hypot(TRACK[(i + 1) % TRACK.length].x - TRACK[i].x, TRACK[(i + 1) % TRACK.length].z - TRACK[i].z));
export const TRACK_LENGTH = LENGTHS[LENGTHS.length - 1];
export const CHECKPOINTS = anchors.map((_, i) => i * SAMPLES_PER_ANCHOR);
export const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Two raised viaducts with smooth approaches and level bridge decks. */
export const BRIDGES = [{ start: .16, end: .38, height: 14 }, { start: .59, end: .82, height: 20 }];
export function trackHeight(distance: number): number {
    const fraction = ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH / TRACK_LENGTH;
    for (const bridge of BRIDGES) {
        const t = (fraction - bridge.start) / (bridge.end - bridge.start);
        if (t <= 0 || t >= 1) continue;
        const ramp = Math.min(1, t / .32, (1 - t) / .32);
        return bridge.height * ramp * ramp * (3 - 2 * ramp);
    }
    return 0;
}

export function trackPose(distance: number, lane = 0) {
    const s = ((distance % TRACK_LENGTH) + TRACK_LENGTH) % TRACK_LENGTH;
    let i = LENGTHS.findIndex((value, index) => index < TRACK.length && s >= value && s < LENGTHS[index + 1]);
    if (i < 0) i = 0;
    const a = TRACK[i], b = TRACK[(i + 1) % TRACK.length];
    const length = LENGTHS[i + 1] - LENGTHS[i], t = (s - LENGTHS[i]) / length;
    const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
    const y0 = trackHeight(LENGTHS[i]), y1 = trackHeight(LENGTHS[i + 1]);
    const grade = (y1 - y0) / length;
    return { y: y0 + (y1 - y0) * t, grade, pitch: -Math.atan(grade), x: a.x + (b.x - a.x) * t + tz * lane, z: a.z + (b.z - a.z) * t - tx * lane, yaw: Math.atan2(tx, tz), tx, tz };
}

/** Nearest paved segment, including signed cross-track distance for barrier response. */
export function nearestTrack(point: Point2) {
    let best = { distance: Infinity, lateral: 0, along: 0, x: 0, z: 0, tx: 0, tz: 1 };
    for (let i = 0; i < TRACK.length; i++) {
        const a = TRACK[i], b = TRACK[(i + 1) % TRACK.length];
        const dx = b.x - a.x, dz = b.z - a.z, length = LENGTHS[i + 1] - LENGTHS[i];
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length)));
        const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(point.x - x, point.z - z);
        if (distance < best.distance) best = { distance, lateral: ((point.x - x) * dz - (point.z - z) * dx) / length, along: LENGTHS[i] + length * t, x, z, tx: dx / length, tz: dz / length };
    }
    return best;
}
