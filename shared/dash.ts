/** Shared dash contact/launch rules; the lingering ground hazard has a separate lifetime. */
export const DASH_RULES = { windupMs: 1100, durationMs: 1500, cooldownMs: 10000, horizontalSpeed: 34, upwardSpeed: 24, staleMs: 250 } as const;
export interface DashVector { x: number; y: number; z: number }
export interface DashPose { position: DashVector; yaw: number; width: number; height: number; depth: number }
export interface DashImpact { actorId: string; targetId: string; velocity: DashVector; position: DashVector }

/** Match-scale collision boxes, matching VehicleFactory's chassis/wheel envelope. */
export function dashDimensions(vehicleId: string) {
    const chassis: Record<string, [number, number, number, number]> = {
        interceptor: [2, .8, 4.2, .9], juggernaut: [3.5, 1.8, 5.5, 1.5], phantom: [1.8, .5, 4, .8],
        manticore: [2.8, 1.5, 5, 1.2], valkyrie: [2.2, .6, 4.8, .85], wraith: [2, .4, 3.5, .5], behemoth: [4, 2.5, 6, 2],
    };
    const [width, height, depth, wheels] = chassis[vehicleId] ?? chassis.interceptor;
    return { width: (width + .8 * wheels) * 1.5, height: (height + .6 * wheels + .2) * 1.5, depth: depth * 1.5 };
}

export function finiteDashVector(value: DashVector | undefined): value is DashVector {
    return Boolean(value && [value.x, value.y, value.z].every(number => Number.isFinite(number) && Math.abs(number) < 10000));
}

/** Swept separating-axis test catches fast passes between network ticks without a proximity blast radius. */
export function dashContact(previous: DashVector, actor: DashPose, target: DashPose): boolean {
    const axes = [actor.yaw, target.yaw].flatMap(yaw => [{ x: Math.sin(yaw), z: Math.cos(yaw) }, { x: Math.cos(yaw), z: -Math.sin(yaw) }]);
    let enter = 0, exit = 1;
    const interval = (start: number, end: number, radius: number) => {
        const speed = end - start;
        if (Math.abs(speed) < 1e-8) return Math.abs(start) <= radius;
        const a = (-radius - start) / speed, b = (radius - start) / speed;
        enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
        return enter <= exit;
    };
    const extent = (pose: DashPose, axis: { x: number; z: number }) =>
        Math.abs(axis.x * Math.sin(pose.yaw) + axis.z * Math.cos(pose.yaw)) * pose.depth / 2 +
        Math.abs(axis.x * Math.cos(pose.yaw) - axis.z * Math.sin(pose.yaw)) * pose.width / 2;
    for (const axis of axes) {
        const start = (previous.x - target.position.x) * axis.x + (previous.z - target.position.z) * axis.z;
        const end = (actor.position.x - target.position.x) * axis.x + (actor.position.z - target.position.z) * axis.z;
        if (!interval(start, end, extent(actor, axis) + extent(target, axis) + .15)) return false;
    }
    return interval(previous.y - target.position.y, actor.position.y - target.position.y, (actor.height + target.height) / 2 + .15);
}

export function dashLaunch(yaw: number): DashVector {
    return { x: Math.sin(yaw) * DASH_RULES.horizontalSpeed, y: DASH_RULES.upwardSpeed, z: Math.cos(yaw) * DASH_RULES.horizontalSpeed };
}
