"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashCombat = void 0;
const dash_1 = require("../../shared/dash");
/** Session-owned dash state. Clients provide owned movement, never victims or impulse magnitude. */
class DashCombat {
    constructor() {
        this.poses = new Map();
        this.windups = new Map();
        this.lastUse = new Map();
        this.active = new Map();
    }
    arm(actor, now) {
        var _a;
        if (actor.vehicleId !== 'valkyrie' || !actor.connected || actor.health <= 0 || now - ((_a = this.lastUse.get(actor.entityId)) !== null && _a !== void 0 ? _a : -Infinity) < dash_1.DASH_RULES.cooldownMs)
            return false;
        this.windups.set(actor.entityId, now);
        this.lastUse.set(actor.entityId, now);
        return true;
    }
    /** Execution acknowledgment prevents a cancelled local wind-up from leaving a server collision window. */
    start(actor, now) {
        const windup = this.windups.get(actor.entityId);
        if (windup === undefined || now - windup < dash_1.DASH_RULES.windupMs - 100 || now - windup > dash_1.DASH_RULES.windupMs + 1500 || actor.health <= 0 || !actor.connected)
            return false;
        this.windups.delete(actor.entityId);
        this.active.set(actor.entityId, { until: now + dash_1.DASH_RULES.durationMs, hit: new Set() });
        return true;
    }
    cancel(id) { this.windups.delete(id); this.active.delete(id); this.poses.delete(id); }
    move(actor, position, yaw, now, roster) {
        if (!(0, dash_1.finiteDashVector)(position) || !Number.isFinite(yaw))
            return [];
        const previous = this.poses.get(actor.entityId);
        const pose = Object.assign({ position: Object.assign({}, position), yaw }, (0, dash_1.dashDimensions)(actor.vehicleId));
        this.poses.set(actor.entityId, { pose, at: now });
        const dash = this.active.get(actor.entityId);
        if (!dash)
            return [];
        if (actor.health <= 0 || !actor.connected || now > dash.until) {
            this.active.delete(actor.entityId);
            return [];
        }
        if (!previous || now - previous.at > dash_1.DASH_RULES.staleMs)
            return [];
        const distance = Math.hypot(position.x - previous.pose.position.x, position.y - previous.pose.position.y, position.z - previous.pose.position.z);
        if (distance > 180 * Math.max(0, now - previous.at) / 1000 + 2) {
            this.active.delete(actor.entityId);
            return [];
        }
        const impacts = [];
        for (const target of roster) {
            if (target.entityId === actor.entityId || target.teamId === actor.teamId || !target.connected || target.health <= 0 || target.protectedUntil > now || dash.hit.has(target.entityId))
                continue;
            const sample = this.poses.get(target.entityId);
            if (!sample || now - sample.at > dash_1.DASH_RULES.staleMs || !(0, dash_1.dashContact)(previous.pose.position, pose, sample.pose))
                continue;
            dash.hit.add(target.entityId);
            impacts.push({ actorId: actor.entityId, targetId: target.entityId, velocity: (0, dash_1.dashLaunch)(yaw), position: Object.assign({}, sample.pose.position) });
        }
        return impacts;
    }
}
exports.DashCombat = DashCombat;
