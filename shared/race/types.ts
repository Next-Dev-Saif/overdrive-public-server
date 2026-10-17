export const RACE_RULES = { racers: 6, laps: 3, queueMs: 5000, countdownMs: 4000, maxRaceMs: 600000, finishGraceMs: 45000, respawnMs: 3000, pickupRespawnMs: 10000, health: 600 } as const;
export type RaceWeapon = 'minigun' | 'plasma' | 'missile' | 'mortar' | 'nuke';
export const RACE_WEAPONS: Record<RaceWeapon, { ammo: number; damage: number; interval: number; range: number }> = {
    minigun: { ammo: 40, damage: 24, interval: 120, range: 75 },
    plasma: { ammo: 12, damage: 90, interval: 500, range: 90 },
    missile: { ammo: 3, damage: 160, interval: 700, range: 100 },
    mortar: { ammo: 3, damage: 120, interval: 1000, range: 80 },
    nuke: { ammo: 1, damage: 400, interval: 1500, range: 65 },
};
export const RACE_ABILITY = { cooldownMs: 15000, windupMs: 1100, range: 80, damage: 90 } as const;
export interface RaceInput { throttle: number; steer: number; brake: boolean; fire: boolean; ability: boolean }
export interface Racer {
    id: string; name: string; bot: boolean; connected: boolean; color: string;
    x: number; z: number; yaw: number; vx: number; vz: number;
    health: number; weapon: RaceWeapon | null; ammo: number;
    lap: number; nextGate: number; started: boolean; progress: number;
    finishedAt: number | null; place: number | null; respawnAt: number; protectedUntil: number;
    lastShot: number; recovery: number; lastAbility: number;
    targetId: string | null; targetSince: number; abilityTarget: string | null; abilityImpactAt: number;
}
export type PickupType = RaceWeapon | 'health';
export interface RacePickup { id: number; distance: number; lane: number; item: PickupType; availableAt: number }
export interface RaceShot { actor: string; target: string; weapon: RaceWeapon | 'lightning'; x: number; z: number; hitX: number; hitZ: number }
export interface RaceSnapshot {
    id: string; phase: 'loading' | 'countdown' | 'racing' | 'finished'; serverTime: number; startsAt: number; endsAt: number;
    racers: Racer[]; pickups: RacePickup[]; winner: string | null;
}
export interface RaceFound { snapshot: RaceSnapshot; localId: string }
