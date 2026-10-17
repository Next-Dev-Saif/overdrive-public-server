"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RACE_ABILITY = exports.RACE_WEAPONS = exports.RACE_RULES = void 0;
exports.RACE_RULES = { racers: 6, laps: 3, queueMs: 5000, countdownMs: 4000, maxRaceMs: 600000, finishGraceMs: 45000, respawnMs: 3000, pickupRespawnMs: 10000, health: 600 };
exports.RACE_WEAPONS = {
    minigun: { ammo: 40, damage: 24, interval: 120, range: 75 },
    plasma: { ammo: 12, damage: 90, interval: 500, range: 90 },
    missile: { ammo: 3, damage: 160, interval: 700, range: 100 },
    mortar: { ammo: 3, damage: 120, interval: 1000, range: 80 },
    nuke: { ammo: 1, damage: 400, interval: 1500, range: 65 },
};
exports.RACE_ABILITY = { cooldownMs: 15000, windupMs: 1100, range: 80, damage: 90 };
