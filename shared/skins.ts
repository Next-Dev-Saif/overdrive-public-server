/** Stable allowlisted cosmetics; network packets contain IDs, never texture URLs. */
export const VEHICLE_SKINS = [
    { id: 'solid', name: 'Solid paint' },
    { id: 'stripes', name: 'Racing stripes' },
    { id: 'camo', name: 'Digital camo' },
    { id: 'carbon', name: 'Carbon weave' },
    { id: 'chevron', name: 'Hazard chevrons' },
    { id: 'cyber', name: 'Cyber grid' },
    { id: 'inferno', name: 'Inferno flare' },
    { id: 'stealth', name: 'Hex stealth' },
    { id: 'gold', name: 'Gilded sovereign' },
] as const;
export type VehicleSkin = typeof VEHICLE_SKINS[number]['id'];
export function isVehicleSkin(value: unknown): value is VehicleSkin {
    return VEHICLE_SKINS.some(skin => skin.id === value);
}
export function normalizeVehicleSkin(value: unknown): VehicleSkin {
    return isVehicleSkin(value) ? value : 'solid';
}
