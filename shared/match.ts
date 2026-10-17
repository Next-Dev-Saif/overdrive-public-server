export const TEAM_IDS = ['alpha', 'bravo'] as const;
export type TeamId = typeof TEAM_IDS[number];
export type CombatantKind = 'human' | 'bot';
export type MatchPhase = 'intro' | 'countdown' | 'playing' | 'ended';

export const TDM_RULES = {
    teamSize: 5,
    durationMs: 5 * 60 * 1000,
    introMs: 4000,
    countdownMs: 3000,
    scoreLimit: 25,
    respawnDelayMs: 3000,
    respawnProtectionMs: 2000,
    queueWaitMs: 5000,
} as const;

export interface MatchMember {
    entityId: string;
    userId?: string;
    displayName: string;
    kind: CombatantKind;
    teamId: TeamId;
    slot: number;
    vehicleId: string;
    weaponId: string;
    vehicleColor?: string;
    connected: boolean;
}

export interface MatchSnapshot {
    matchId: string;
    roomId: string;
    mapId: string;
    phase: MatchPhase;
    startsAt: number;
    endsAt: number;
    scoreLimit: number;
    scores: Record<TeamId, number>;
    roster: MatchMember[];
    winner: TeamId | 'draw' | null;
}

export interface MatchFoundPayload {
    roomId: string;
    matchId: string;
    mapId: string;
    isHost: boolean;
    team: TeamId;
    localMember: MatchMember;
    snapshot: MatchSnapshot;
}

export interface MatchResult {
    winner: TeamId | 'draw';
    localTeam: TeamId;
    scores: Record<TeamId, number>;
}

export interface SpawnTransform {
    x: number;
    y: number;
    z: number;
    yaw: number;
}

/** Alternating assignment keeps every partial human roster within one player. */
export function teamForHumanIndex(index: number): TeamId {
    return index % 2 === 0 ? 'alpha' : 'bravo';
}

export function opposingTeam(teamId: TeamId): TeamId {
    return teamId === 'alpha' ? 'bravo' : 'alpha';
}

export function areOpponents(first?: TeamId, second?: TeamId): boolean {
    return first !== undefined && second !== undefined && first !== second;
}

/** Five authored formation slots per side; terrain height is supplied by the arena. */
export function getTeamSpawn(teamId: TeamId, slot: number, groundY: number): SpawnTransform {
    const clampedSlot = Math.max(0, Math.min(TDM_RULES.teamSize - 1, slot));
    const xOffsets = [-36, -18, 0, 18, 36];
    return {
        x: xOffsets[clampedSlot],
        y: groundY,
        z: teamId === 'alpha' ? 100 : -100,
        yaw: teamId === 'alpha' ? Math.PI : 0,
    };
}

export function resolveMatchPhase(snapshot: Pick<MatchSnapshot, 'startsAt' | 'endsAt' | 'winner'>, now = Date.now()): MatchPhase {
    if (snapshot.winner !== null || now >= snapshot.endsAt) return 'ended';
    if (now >= snapshot.startsAt) return 'playing';
    if (now >= snapshot.startsAt - TDM_RULES.countdownMs) return 'countdown';
    return 'intro';
}

