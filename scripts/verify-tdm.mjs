import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const port = 3197;
const secret = 'tdm-test-secret';
const bootstrap = `
const { db } = require('./dist/src/db.js');
(async () => {
    const alpha = await db.createUser({ username: 'upgraded-alpha', email: 'alpha@test.invalid', passwordHash: 'fixture' });
    const bravo = await db.createUser({ username: 'base-bravo', email: 'bravo@test.invalid', passwordHash: 'fixture' });
    await db.incrementWalletScrap(alpha.id, 10000);
    await db.purchase(alpha.id, { kind: 'skin', id: 'camo' });
    await db.purchase(alpha.id, { kind: 'armor', id: 'interceptor', expectedLevel: 0 });
    await db.purchase(alpha.id, { kind: 'weapon', id: 'nuke', expectedLevel: 0 });
    process.send({ alpha: alpha.id, bravo: bravo.id });
    require('./dist/src/index.js');
})().catch(error => { console.error(error); process.exit(1); });
`;
const server = spawn(process.execPath, ['-e', bootstrap], {
    cwd: process.cwd(),
    env: { ...process.env, APPWRITE_MOCK: 'true', PORT: String(port), JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

const seeded = new Promise(resolve => server.once('message', resolve));
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const once = (socket, event, timeoutMs = 15_000) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, value => { clearTimeout(timeout); resolve(value); });
});

try {
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server did not start')), 5000);
        server.stdout.on('data', chunk => {
            if (String(chunk).includes('Overdrive TDM server')) { clearTimeout(timeout); resolve(); }
        });
        server.once('exit', code => reject(new Error(`Server exited with ${code}`)));
    });

    const connect = (userId, username) => io(`ws://localhost:${port}`, {
        transports: ['websocket'],
        auth: { token: jwt.sign({ userId, username }, secret) },
    });
    const accounts = await seeded;
    const alpha = connect(accounts.alpha, 'ALPHA HUMAN');
    const bravo = connect(accounts.bravo, 'BRAVO HUMAN');
    await Promise.all([once(alpha, 'connect'), once(bravo, 'connect')]);
    const alphaFound = once(alpha, 'matchFound');
    const bravoFound = once(bravo, 'matchFound');
    alpha.emit('joinMatchmaking', { mapId: 'wasteland', vehicleId: 'interceptor', weaponId: 'nuke', vehicleSkin: 'camo' });
    bravo.emit('joinMatchmaking', { mapId: 'wasteland', vehicleId: 'juggernaut', weaponId: 'plasma' });
    const [alphaMatch, bravoMatch] = await Promise.all([alphaFound, bravoFound]);

    assert.equal(alphaMatch.matchId, bravoMatch.matchId);
    assert.equal(alphaMatch.snapshot.roster.length, 10);
    assert.equal(alphaMatch.snapshot.roster.filter(member => member.teamId === 'alpha').length, 5);
    assert.equal(alphaMatch.snapshot.roster.filter(member => member.teamId === 'bravo').length, 5);
    assert.equal(new Set(alphaMatch.snapshot.roster.map(member => member.entityId)).size, 10);

    const joinedAlpha = once(alpha, 'matchSnapshot');
    const joinedBravo = once(bravo, 'matchSnapshot');
    alpha.emit('join', { matchId: alphaMatch.matchId, mapId: 'wasteland', vehicleId: 'interceptor', weaponId: 'nuke', vehicleSkin: 'camo' });
    bravo.emit('join', { matchId: bravoMatch.matchId, mapId: 'wasteland', vehicleId: 'juggernaut', weaponId: 'plasma' });
    await Promise.all([joinedAlpha, joinedBravo]);
    assert.equal(alphaMatch.localMember.vehicleSkin, 'camo', 'purchased wrap survives reconnection and authoritative roster');
    assert.equal(alphaMatch.localMember.maxHealth, 630, 'server installs purchased armor');
    const waiting = once(alpha, 'matchSnapshot');
    alpha.emit('arenaReady');
    assert.equal((await waiting).loading, true, 'one ready client cannot start the intro');
    const ready = once(alpha, 'matchSnapshot');
    bravo.emit('arenaReady');
    const started = await ready;
    assert.equal(started.loading, false);
    assert.ok(started.startsAt - started.serverTime >= 32900, 'ten three-second showcases plus countdown');
    let prematureDamage = false;
    const premature = () => { prematureDamage = true; };
    alpha.on('healthUpdate', premature);
    alpha.emit('hit', { targetId: bravo.id, damage: 1500, weaponId: 'nuke', sequence: 0 });
    await wait(150);
    alpha.off('healthUpdate', premature);
    assert.equal(prematureDamage, false, 'combat remains locked during showcase');
    await wait(Math.max(0, started.startsAt - Date.now() + 100));

    const ally = alphaMatch.snapshot.roster.find(member => member.teamId === alphaMatch.team && member.kind === 'bot');
    const enemy = alphaMatch.snapshot.roster.find(member => member.teamId !== alphaMatch.team && member.kind === 'bot' && !['behemoth', 'juggernaut'].includes(member.vehicleId));
    assert.ok(ally && enemy);
    let allyDamaged = false;
    const healthListener = data => { if (data.playerId === ally.entityId) allyDamaged = true; };
    alpha.on('healthUpdate', healthListener);
    alpha.emit('hit', { targetId: ally.entityId, damage: 1500, weaponId: 'nuke', sequence: 1 });
    await wait(250);
    alpha.off('healthUpdate', healthListener);
    assert.equal(allyDamaged, false, 'friendly fire must be rejected');

    const enemyDamage = once(alpha, 'healthUpdate');
    const enemyRespawn = once(alpha, 'combatantRespawned');
    alpha.emit('hit', { targetId: enemy.entityId, damage: 1500, weaponId: 'nuke', sequence: 2 });
    const update = await enemyDamage;
    assert.equal(update.playerId, enemy.entityId);
    assert.equal(update.health, 0);

    const respawn = await enemyRespawn;
    assert.equal(respawn.entityId, enemy.entityId);
    assert.ok(respawn.invulnerableUntil > Date.now());
    let protectedTargetDamaged = false;
    const protectionListener = data => { if (data.playerId === enemy.entityId) protectedTargetDamaged = true; };
    alpha.on('healthUpdate', protectionListener);
    alpha.emit('hit', { targetId: enemy.entityId, damage: 1500, weaponId: 'nuke', sequence: 3 });
    await wait(250);
    alpha.off('healthUpdate', protectionListener);
    assert.equal(protectedTargetDamaged, false, 'respawn protection must reject damage');

    const heavyTarget = alphaMatch.snapshot.roster.find(member => member.teamId !== alphaMatch.team && member.vehicleId === 'behemoth');
    assert.ok(heavyTarget);
    const upgradedDamage = once(alpha, 'healthUpdate');
    alpha.emit('hit', { targetId: heavyTarget.entityId, damage: 100, weaponId: 'nuke', sequence: 4 });
    assert.equal((await upgradedDamage).health, 2396, 'server applies the purchased 4% damage bonus exactly once');

    const alliedNukeBot = alphaMatch.snapshot.roster.find(member => member.teamId === alphaMatch.team && member.kind === 'bot' && member.weaponId === 'nuke');
    assert.ok(alliedNukeBot);
    const botDamage = once(alpha, 'healthUpdate');
    alpha.emit('hit', {
        attackerId: alliedNukeBot.entityId,
        targetId: bravoMatch.localMember.entityId,
        damage: 1500,
        weaponId: alliedNukeBot.weaponId,
        sequence: 1,
    });
    const botDamageUpdate = await botDamage;
    assert.equal(botDamageUpdate.playerId, bravoMatch.localMember.entityId);
    assert.equal(botDamageUpdate.health, 100);

    const playerDeath = once(alpha, 'healthUpdate');
    const playerRespawn = once(alpha, 'combatantRespawned');
    alpha.emit('requestRespawn');
    const playerDeathUpdate = await playerDeath;
    assert.equal(playerDeathUpdate.playerId, alphaMatch.localMember.entityId);
    assert.equal(playerDeathUpdate.health, 0);
    const playerRespawnUpdate = await playerRespawn;
    assert.equal(playerRespawnUpdate.entityId, alphaMatch.localMember.entityId);
    assert.equal(playerRespawnUpdate.health, 630, 'purchased armor survives respawn');

    alpha.disconnect();
    bravo.disconnect();
    console.log('PASS: exact 5v5 roster, friendly-fire rejection, human/bot damage, bot/player respawn, spawn protection, purchased wraps, armor and server-owned weapon upgrades.');
} finally {
    server.kill('SIGTERM');
}
