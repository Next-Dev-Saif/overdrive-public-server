import type { Server, Socket } from 'socket.io';
import type { RoomLoadout, RoomMembership, RoomReply, ServerRoom } from '../shared/rooms';
import type { MatchmakingEntry } from './index';

interface WaitingRoom { id: string; mapId: string; entries: MatchmakingEntry[] }
const MAPS = new Set(['wasteland', 'facility', 'glacial', 'neon']);
const VEHICLES = new Set(['interceptor', 'juggernaut', 'phantom', 'manticore', 'valkyrie', 'wraith', 'behemoth']);
const WEAPONS = new Set(['minigun', 'plasma', 'missile', 'mortar', 'nuke']);

/** Validate loadouts at the trust boundary; never spread client-owned identities into a roster. */
export function validRoomLoadout(data: unknown): data is RoomLoadout {
    if (!data || typeof data !== 'object') return false;
    const value = data as RoomLoadout;
    return MAPS.has(value.mapId) && VEHICLES.has(value.vehicleId) && WEAPONS.has(value.weaponId) &&
        (value.vehicleColor === undefined || typeof value.vehicleColor === 'string' && /^#[\da-f]{6}$/i.test(value.vehicleColor));
}

/** Waiting-room membership is atomic on the event loop. Only its host may launch bot-filled combat. */
export function installRoomBrowser(io: Server, startMatch: (entries: MatchmakingEntry[]) => void, activeRooms: () => ServerRoom[], inMatch: (socketId: string, userId: string) => boolean): void {
    const rooms = new Map<string, WaitingRoom>();
    let serial = 0;
    const summary = (room: WaitingRoom): ServerRoom => ({ id: room.id, name: `${room.entries[0]?.username ?? 'Open'}'s room`, mapId: room.mapId, humans: room.entries.length, capacity: 10, status: 'waiting' });
    const roomOf = (socketId: string) => [...rooms.values()].find(room => room.entries.some(entry => entry.socketId === socketId));
    const list = (socket: Socket) => socket.emit('roomList', [...rooms.values()].map(summary).concat(activeRooms()).filter(room => room.mapId === socket.data.browseMap));
    const broadcast = () => {
        for (const socket of io.sockets.sockets.values()) if (socket.data.browseMap) list(socket);
        for (const room of rooms.values()) for (const entry of room.entries) {
            const membership: RoomMembership = { room: summary(room), isHost: entry === room.entries[0], players: room.entries.map(member => member.username) };
            io.to(entry.socketId).emit('roomState', membership);
        }
    };
    const leave = (socket: Socket) => {
        const room = roomOf(socket.id);
        if (room) { room.entries = room.entries.filter(entry => entry.socketId !== socket.id); if (!room.entries.length) rooms.delete(room.id); }
        delete socket.data.waitingRoom;
        socket.emit('roomState', null);
        broadcast();
    };
    io.on('connection', socket => {
        socket.on('browseRooms', (mapId: unknown) => {
            if (typeof mapId !== 'string' || !MAPS.has(mapId)) return;
            socket.data.browseMap = mapId; list(socket);
        });
        socket.on('enterRoom', (data: { roomId?: string; loadout?: unknown } | null, reply?: (result: RoomReply) => void) => {
            if (typeof reply !== 'function') return;
            if (!validRoomLoadout(data?.loadout)) { reply({ error: 'Invalid vehicle, weapon or arena. Return to setup.' }); return; }
            if (inMatch(socket.id, socket.data.userId) || [...rooms.values()].some(room => room.entries.some(entry => entry.userId === socket.data.userId))) { reply({ error: 'You already joined a room. Leave it before joining another.' }); return; }
            let room: WaitingRoom | undefined;
            if (data?.roomId !== undefined) {
                room = typeof data.roomId === 'string' ? rooms.get(data.roomId) : undefined;
                if (!room || room.mapId !== data.loadout.mapId || room.entries.length >= 10) { reply({ error: 'This room is full or has started. Choose another room.' }); list(socket); return; }
            } else {
                if (rooms.size >= 100) { reply({ error: 'Room limit reached. Join an available room.' }); return; }
                room = { id: `lobby_${Date.now().toString(36)}_${++serial}`, mapId: data.loadout.mapId, entries: [] };
                rooms.set(room.id, room);
            }
            room.entries.push({ ...data.loadout, socketId: socket.id, userId: socket.data.userId, username: socket.data.username });
            socket.data.waitingRoom = room.id;
            reply({}); broadcast();
        });
        socket.on('startRoom', (reply?: (result: RoomReply) => void) => {
            if (typeof reply !== 'function') return;
            const room = roomOf(socket.id);
            if (!room || room.entries[0].socketId !== socket.id) { reply({ error: 'Only the room host can start the battle.' }); return; }
            rooms.delete(room.id);
            for (const entry of room.entries) { const member = io.sockets.sockets.get(entry.socketId); if (member) delete member.data.waitingRoom; }
            startMatch(room.entries);
            reply({}); broadcast();
        });
        socket.on('leaveRoom', () => leave(socket));
        socket.on('disconnect', () => leave(socket));
    });
}
