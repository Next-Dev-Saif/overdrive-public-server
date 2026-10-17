"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRIDGES = exports.normalizeAngle = exports.CHECKPOINTS = exports.TRACK_LENGTH = exports.LENGTHS = exports.TRACK = exports.ROAD_WIDTH = exports.RACE_MAP_ID = void 0;
exports.trackHeight = trackHeight;
exports.trackPose = trackPose;
exports.nearestTrack = nearestTrack;
exports.RACE_MAP_ID = 'blacktop';
exports.ROAD_WIDTH = 24;
const anchors = [
    { x: 0, z: -180 }, { x: 105, z: -180 }, { x: 175, z: -110 },
    { x: 145, z: -15 }, { x: 185, z: 75 }, { x: 120, z: 160 },
    { x: 0, z: 180 }, { x: -120, z: 160 }, { x: -180, z: 70 },
    { x: -145, z: -20 }, { x: -175, z: -115 }, { x: -95, z: -180 },
];
const curve = (a, b, c, d, t) => .5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
const SAMPLES_PER_ANCHOR = 24;
exports.TRACK = anchors.flatMap((b, i) => Array.from({ length: SAMPLES_PER_ANCHOR }, (_, j) => {
    const a = anchors[(i + anchors.length - 1) % anchors.length], c = anchors[(i + 1) % anchors.length], d = anchors[(i + 2) % anchors.length];
    return { x: curve(a.x, b.x, c.x, d.x, j / SAMPLES_PER_ANCHOR), z: curve(a.z, b.z, c.z, d.z, j / SAMPLES_PER_ANCHOR) };
}));
exports.LENGTHS = [0];
for (let i = 0; i < exports.TRACK.length; i++)
    exports.LENGTHS.push(exports.LENGTHS[i] + Math.hypot(exports.TRACK[(i + 1) % exports.TRACK.length].x - exports.TRACK[i].x, exports.TRACK[(i + 1) % exports.TRACK.length].z - exports.TRACK[i].z));
exports.TRACK_LENGTH = exports.LENGTHS[exports.LENGTHS.length - 1];
exports.CHECKPOINTS = anchors.map((_, i) => i * SAMPLES_PER_ANCHOR);
const normalizeAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
exports.normalizeAngle = normalizeAngle;
/** Two raised viaducts with smooth approaches and level bridge decks. */
exports.BRIDGES = [{ start: .16, end: .38, height: 14 }, { start: .59, end: .82, height: 20 }];
function trackHeight(distance) {
    const fraction = ((distance % exports.TRACK_LENGTH) + exports.TRACK_LENGTH) % exports.TRACK_LENGTH / exports.TRACK_LENGTH;
    for (const bridge of exports.BRIDGES) {
        const t = (fraction - bridge.start) / (bridge.end - bridge.start);
        if (t <= 0 || t >= 1)
            continue;
        const ramp = Math.min(1, t / .32, (1 - t) / .32);
        return bridge.height * ramp * ramp * (3 - 2 * ramp);
    }
    return 0;
}
function trackPose(distance, lane = 0) {
    const s = ((distance % exports.TRACK_LENGTH) + exports.TRACK_LENGTH) % exports.TRACK_LENGTH;
    let i = exports.LENGTHS.findIndex((value, index) => index < exports.TRACK.length && s >= value && s < exports.LENGTHS[index + 1]);
    if (i < 0)
        i = 0;
    const a = exports.TRACK[i], b = exports.TRACK[(i + 1) % exports.TRACK.length];
    const length = exports.LENGTHS[i + 1] - exports.LENGTHS[i], t = (s - exports.LENGTHS[i]) / length;
    const tx = (b.x - a.x) / length, tz = (b.z - a.z) / length;
    const y0 = trackHeight(exports.LENGTHS[i]), y1 = trackHeight(exports.LENGTHS[i + 1]);
    const grade = (y1 - y0) / length;
    return { y: y0 + (y1 - y0) * t, grade, pitch: -Math.atan(grade), x: a.x + (b.x - a.x) * t + tz * lane, z: a.z + (b.z - a.z) * t - tx * lane, yaw: Math.atan2(tx, tz), tx, tz };
}
/** Nearest paved segment, including signed cross-track distance for barrier response. */
function nearestTrack(point) {
    let best = { distance: Infinity, lateral: 0, along: 0, x: 0, z: 0, tx: 0, tz: 1 };
    for (let i = 0; i < exports.TRACK.length; i++) {
        const a = exports.TRACK[i], b = exports.TRACK[(i + 1) % exports.TRACK.length];
        const dx = b.x - a.x, dz = b.z - a.z, length = exports.LENGTHS[i + 1] - exports.LENGTHS[i];
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length)));
        const x = a.x + dx * t, z = a.z + dz * t, distance = Math.hypot(point.x - x, point.z - z);
        if (distance < best.distance)
            best = { distance, lateral: ((point.x - x) * dz - (point.z - z) * dx) / length, along: exports.LENGTHS[i] + length * t, x, z, tx: dx / length, tz: dz / length };
    }
    return best;
}
