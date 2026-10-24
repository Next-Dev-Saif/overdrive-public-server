import { isVehicleSkin, type VehicleSkin } from './skins';

export const SKIN_OFFERS = [
    { id: 'solid', price: 0, edition: 'Factory', description: 'Clean paint. Pure machinery.' },
    { id: 'stripes', price: 500, edition: 'Motorsport', description: 'Twin racing stripes. Built for the front of the pack.' },
    { id: 'camo', price: 1200, edition: 'Field issue', description: 'Disruptive digital camouflage for the combat zone.' },
    { id: 'carbon', price: 2400, edition: 'Performance', description: 'Exposed carbon weave. Precision in every detail.' },
    { id: 'chevron', price: 3500, edition: 'Hazard series', description: 'Industrial chevrons. A warning worth wearing.' },
    { id: 'cyber', price: 4800, edition: 'Cyber series', description: 'High-frequency digital grid. Intersecting neon logic across dark chassis.' },
    { id: 'inferno', price: 6200, edition: 'Thermal spec', description: 'Molten heat waves and turbulent magma contours forged for scorched earth.' },
    { id: 'stealth', price: 7500, edition: 'Black ops', description: 'Hexagonal radar-absorbent composite mesh. Silent, lethal, unseen.' },
    { id: 'gold', price: 10000, edition: 'Sovereign', description: 'Prestige titanium-gold geometric filigree. Uncompromising triumph.' },
] as const;

export interface BundleOffer {
    id: string;
    name: string;
    category: 'weapon_bundle' | 'fleet_package';
    price: number;
    originalValue: number;
    badge: string;
    description: string;
    itemsSummary: string[];
    weaponUpgrades?: Record<string, number>;
    armorUpgrades?: Record<string, number>;
    includedSkin?: VehicleSkin;
}

export const BUNDLE_OFFERS: readonly BundleOffer[] = [
    {
        id: 'rapid_fire_bundle',
        name: 'Direct Fire Specialist',
        category: 'weapon_bundle',
        price: 950,
        originalValue: 1200,
        badge: 'TACTICAL',
        description: 'Accelerated capacitors and heavy-bore rifling for frontline kinetic and energy cannons.',
        itemsSummary: ['+1 Minigun Tuning Tier', '+1 Plasma Cannon Tier'],
        weaponUpgrades: { minigun: 1, plasma: 1 },
    },
    {
        id: 'heavy_ordnance_bundle',
        name: 'Heavy Artillery Bundle',
        category: 'weapon_bundle',
        price: 1400,
        originalValue: 1800,
        badge: 'FIREPOWER',
        description: 'High-yield guidance systems and reinforced warheads for long-range devastators.',
        itemsSummary: ['+1 Guided Missile Tier', '+1 Siege Mortar Tier', '+1 Tactical Nuke Tier'],
        weaponUpgrades: { missile: 1, mortar: 1, nuke: 1 },
    },
    {
        id: 'complete_arsenal_bundle',
        name: 'Full Arsenal Master Pack',
        category: 'weapon_bundle',
        price: 2200,
        originalValue: 3000,
        badge: 'POPULAR',
        description: 'Complete weapons workshop overhaul upgrading every primary weapon system by 1 tier.',
        itemsSummary: ['+1 Tier to ALL 5 Weapons', '+4% Damage Bonus Across Entire Arsenal'],
        weaponUpgrades: { minigun: 1, plasma: 1, missile: 1, mortar: 1, nuke: 1 },
    },
    {
        id: 'ironclad_fleet_package',
        name: 'Ironclad Fleet Pack',
        category: 'fleet_package',
        price: 2600,
        originalValue: 3500,
        badge: 'SURVIVABILITY',
        description: 'Heavy composite plating upgrade for every vehicle chassis in the fleet.',
        itemsSummary: ['+1 Armor Plating Tier for all 7 Chassis', '+5% Base Health across all Vehicles'],
        armorUpgrades: { interceptor: 1, juggernaut: 1, phantom: 1, manticore: 1, valkyrie: 1, wraith: 1, behemoth: 1 },
    },
    {
        id: 'apex_vanguard_pack',
        name: 'Apex Vanguard Elite Bundle',
        category: 'fleet_package',
        price: 5500,
        originalValue: 7800,
        badge: 'BEST VALUE',
        description: 'The ultimate frontline package: Cyber Grid vehicle wrap plus 1 tier calibration across all 5 weapons.',
        itemsSummary: ['Exclusive Cyber Grid Body Wrap', '+1 Tier to ALL 5 Weapon Systems', 'Universal Chassis Compatibility'],
        weaponUpgrades: { minigun: 1, plasma: 1, missile: 1, mortar: 1, nuke: 1 },
        includedSkin: 'cyber',
    },
] as const;

export const BASE_HEALTH: Record<string, number> = { interceptor: 600, juggernaut: 1600, phantom: 450, manticore: 1200, valkyrie: 700, wraith: 350, behemoth: 2500 };
export const WEAPON_IDS = ['minigun', 'plasma', 'missile', 'mortar', 'nuke'];
export interface Inventory { skins: VehicleSkin[]; armor: Record<string, number>; weapons: Record<string, number> }
export interface Economy { scrap: number; inventory: Inventory }
export type Purchase = { kind: 'skin' | 'armor' | 'weapon' | 'bundle'; id: string; expectedLevel?: number };
export const emptyInventory = (): Inventory => ({ skins: ['solid'], armor: {}, weapons: {} });

/** Older accounts start with factory paint and no upgrades; reject malformed stored levels. */
export function normalizeInventory(value: unknown): Inventory {
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { return emptyInventory(); } }
    const input = (value && typeof value === 'object' ? value : {}) as Partial<Inventory>;
    const levels = (source: unknown, ids: string[]) => Object.fromEntries(ids.map(id => {
        const n = (source as Record<string, unknown> | undefined)?.[id];
        return [id, typeof n === 'number' && Number.isInteger(n) ? Math.max(0, Math.min(5, n)) : 0];
    }));
    return { skins: [...new Set<VehicleSkin>(['solid', ...(Array.isArray(input.skins) ? input.skins.filter(isVehicleSkin) : [])])], armor: levels(input.armor, Object.keys(BASE_HEALTH)), weapons: levels(input.weapons, WEAPON_IDS) };
}

export function upgradePrice(kind: 'armor' | 'weapon', level: number): number { return (level + 1) * (kind === 'armor' ? 500 : 600); }
export function upgradedHealth(vehicle: string, inventory: Inventory): number { return Math.round((BASE_HEALTH[vehicle] ?? 600) * (1 + (inventory.armor[vehicle] ?? 0) * .05)); }
export function weaponMultiplier(weapon: string, inventory: Inventory): number { return 1 + (inventory.weapons[weapon] ?? 0) * .04; }

/** The server chooses prices and balances. Expected level prevents retrying an upgrade twice. */
export function purchaseItem(current: Economy, request: Purchase): Economy {
    const inventory = normalizeInventory(current.inventory);
    let cost: number;
    if (request.kind === 'skin') {
        const offer = SKIN_OFFERS.find(item => item.id === request.id);
        if (!offer) throw new Error('Unknown skin.');
        if (inventory.skins.includes(offer.id)) return { ...current, inventory };
        cost = offer.price;
        inventory.skins.push(offer.id);
    } else if (request.kind === 'armor' || request.kind === 'weapon') {
        const levels = request.kind === 'armor' ? inventory.armor : inventory.weapons;
        if (!Object.prototype.hasOwnProperty.call(levels, request.id)) throw new Error('Unknown upgrade.');
        const level = levels[request.id];
        if (level >= 5) throw new Error('This upgrade is already maxed.');
        if (request.expectedLevel !== undefined && request.expectedLevel !== level) throw new Error('Upgrade level changed. Refresh and try again.');
        cost = upgradePrice(request.kind, level);
        levels[request.id] = level + 1;
    } else if (request.kind === 'bundle') {
        const bundle = BUNDLE_OFFERS.find(item => item.id === request.id);
        if (!bundle) throw new Error('Unknown bundle.');
        let canApply = false;
        if (bundle.includedSkin && !inventory.skins.includes(bundle.includedSkin)) {
            canApply = true;
        }
        if (bundle.weaponUpgrades) {
            for (const [wId] of Object.entries(bundle.weaponUpgrades)) {
                if ((inventory.weapons[wId] ?? 0) < 5) canApply = true;
            }
        }
        if (bundle.armorUpgrades) {
            for (const [vId] of Object.entries(bundle.armorUpgrades)) {
                if ((inventory.armor[vId] ?? 0) < 5) canApply = true;
            }
        }
        if (!canApply) throw new Error('All items in this bundle are already at maximum level or owned.');
        cost = bundle.price;
        if (!Number.isFinite(current.scrap) || current.scrap < cost) throw new Error('Not enough scraps. Earn more by completing team battles.');

        if (bundle.includedSkin && !inventory.skins.includes(bundle.includedSkin)) {
            inventory.skins.push(bundle.includedSkin);
        }
        if (bundle.weaponUpgrades) {
            for (const [wId, boost] of Object.entries(bundle.weaponUpgrades)) {
                inventory.weapons[wId] = Math.min(5, (inventory.weapons[wId] ?? 0) + boost);
            }
        }
        if (bundle.armorUpgrades) {
            for (const [vId, boost] of Object.entries(bundle.armorUpgrades)) {
                inventory.armor[vId] = Math.min(5, (inventory.armor[vId] ?? 0) + boost);
            }
        }
        return { scrap: current.scrap - cost, inventory };
    } else throw new Error('Unknown purchase.');
    if (!Number.isFinite(current.scrap) || current.scrap < cost) throw new Error('Not enough scraps. Earn more by completing team battles.');
    return { scrap: current.scrap - cost, inventory };
}
