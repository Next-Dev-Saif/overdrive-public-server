import { DASH_RULES, dashContact, dashDimensions, dashLaunch, finiteDashVector, type DashImpact, type DashPose, type DashVector } from '../shared/dash';
interface Combatant { entityId: string; vehicleId: string; teamId?: string; connected: boolean; health: number; protectedUntil: number }
interface PoseSample { pose: DashPose; at: number }

/** Session-owned dash state. Clients provide owned movement, never victims or impulse magnitude. */
export class DashCombat {
    private poses = new Map<string, PoseSample>();
    private windups = new Map<string, number>();
    private lastUse = new Map<string, number>();
    private active = new Map<string, { until: number; hit: Set<string> }>();

    arm(actor: Combatant, now: number): boolean {
        if (actor.vehicleId !== 'valkyrie' || !actor.connected || actor.health <= 0 || now - (this.lastUse.get(actor.entityId) ?? -Infinity) < DASH_RULES.cooldownMs) return false;
        this.windups.set(actor.entityId, now); this.lastUse.set(actor.entityId, now); return true;
    }

    /** Execution acknowledgment prevents a cancelled local wind-up from leaving a server collision window. */
    start(actor: Combatant, now: number): boolean {
        const windup = this.windups.get(actor.entityId);
        if (windup === undefined || now - windup < DASH_RULES.windupMs - 100 || now - windup > DASH_RULES.windupMs + 1500 || actor.health <= 0 || !actor.connected) return false;
        this.windups.delete(actor.entityId);
        this.active.set(actor.entityId, { until: now + DASH_RULES.durationMs, hit: new Set() });
        return true;
    }

    cancel(id: string): void { this.windups.delete(id); this.active.delete(id); this.poses.delete(id); }

    move(actor: Combatant, position: DashVector, yaw: number, now: number, roster: Combatant[]): DashImpact[] {
        if (!finiteDashVector(position) || !Number.isFinite(yaw)) return [];
        const previous = this.poses.get(actor.entityId);
        const pose = { position: { ...position }, yaw, ...dashDimensions(actor.vehicleId) };
        this.poses.set(actor.entityId, { pose, at: now });
        const dash = this.active.get(actor.entityId);
        if (!dash) return [];
        if (actor.health <= 0 || !actor.connected || now > dash.until) { this.active.delete(actor.entityId); return []; }
        if (!previous || now - previous.at > DASH_RULES.staleMs) return [];
        const distance = Math.hypot(position.x - previous.pose.position.x, position.y - previous.pose.position.y, position.z - previous.pose.position.z);
        if (distance > 180 * Math.max(0, now - previous.at) / 1000 + 2) { this.active.delete(actor.entityId); return []; }
        const impacts: DashImpact[] = [];
        for (const target of roster) {
            if (target.entityId === actor.entityId || target.teamId === actor.teamId || !target.connected || target.health <= 0 || target.protectedUntil > now || dash.hit.has(target.entityId)) continue;
            const sample = this.poses.get(target.entityId);
            if (!sample || now - sample.at > DASH_RULES.staleMs || !dashContact(previous.pose.position, pose, sample.pose)) continue;
            dash.hit.add(target.entityId);
            impacts.push({ actorId: actor.entityId, targetId: target.entityId, velocity: dashLaunch(yaw), position: { ...sample.pose.position } });
        }
        return impacts;
    }
}
