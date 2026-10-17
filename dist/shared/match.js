"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TDM_RULES = exports.TEAM_IDS = void 0;
exports.teamForHumanIndex = teamForHumanIndex;
exports.opposingTeam = opposingTeam;
exports.areOpponents = areOpponents;
exports.getTeamSpawn = getTeamSpawn;
exports.resolveMatchPhase = resolveMatchPhase;
exports.TEAM_IDS = ['alpha', 'bravo'];
exports.TDM_RULES = {
    teamSize: 5,
    durationMs: 5 * 60 * 1000,
    introMs: 4000,
    countdownMs: 3000,
    scoreLimit: 25,
    respawnDelayMs: 3000,
    respawnProtectionMs: 2000,
    queueWaitMs: 5000,
};
/** Alternating assignment keeps every partial human roster within one player. */
function teamForHumanIndex(index) {
    return index % 2 === 0 ? 'alpha' : 'bravo';
}
function opposingTeam(teamId) {
    return teamId === 'alpha' ? 'bravo' : 'alpha';
}
function areOpponents(first, second) {
    return first !== undefined && second !== undefined && first !== second;
}
/** Five authored formation slots per side; terrain height is supplied by the arena. */
function getTeamSpawn(teamId, slot, groundY) {
    const clampedSlot = Math.max(0, Math.min(exports.TDM_RULES.teamSize - 1, slot));
    const xOffsets = [-36, -18, 0, 18, 36];
    return {
        x: xOffsets[clampedSlot],
        y: groundY,
        z: teamId === 'alpha' ? 100 : -100,
        yaw: teamId === 'alpha' ? Math.PI : 0,
    };
}
function resolveMatchPhase(snapshot, now = Date.now()) {
    if (snapshot.winner !== null || now >= snapshot.endsAt)
        return 'ended';
    if (now >= snapshot.startsAt)
        return 'playing';
    if (now >= snapshot.startsAt - exports.TDM_RULES.countdownMs)
        return 'countdown';
    return 'intro';
}
