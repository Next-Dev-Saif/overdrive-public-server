/** Public room directory contract. Occupancy counts humans; vacant match slots become bots. */
export interface ServerRoom {
    id: string;
    name: string;
    mapId: string;
    humans: number;
    capacity: number;
    status: 'waiting' | 'playing';
}
export interface RoomMembership {
    room: ServerRoom;
    isHost: boolean;
    players: string[];
}
export interface RoomLoadout { mapId: string; vehicleId: string; weaponId: string; vehicleColor?: string }
export interface RoomReply { error?: string }
