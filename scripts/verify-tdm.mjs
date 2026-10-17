import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import jwt from 'jsonwebtoken';
import { io } from 'socket.io-client';

const port = 3197;
const secret = 'tdm-test-secret';
const server = spawn(process.execPath, ['dist/server/src/index.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), JWT_SECRET: secret },
    stdio: ['ignore', 'pipe', 'pipe'],
});

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
    const alpha = connect('test-alpha', 'ALPHA HUMAN');
    const bravo = connect('test-bravo', 'BRAVO HUMAN');
    await Promise.all([once(alpha, 'connect'), once(bravo, 'connect')]);
    const alphaFound = once(alpha, 'matchFound');
    const bravoFound = once(bravo, 'matchFound');
    alpha.emit('joinMatchmaking', { mapId: 'wasteland', vehicleId: 'interceptor', weaponId: 'nuke' });
    bravo.emit('joinMatchmaking', { mapId: 'wasteland', vehicleId: 'juggernaut', weaponId: 'plasma' });
    const [alphaMatch, bravoMatch] = await Promise.all([alphaFound, bravoFound]);

    assert.equal(alphaMatch.matchId, bravoMatch.matchId);
    assert.equal(alphaMatch.snapshot.roster.length, 10);
    assert.equal(alphaMatch.snapshot.roster.filter(member => member.teamId === 'alpha').length, 5);
    assert.equal(alphaMatch.snapshot.roster.filter(member => member.teamId === 'bravo').length, 5);
    assert.equal(new Set(alphaMatch.snapshot.roster.map(member => member.entityId)).size, 10);

    alpha.emit('join', { matchId: alphaMatch.matchId, mapId: 'wasteland', vehicleId: 'interceptor', weaponId: 'nuke' });
    bravo.emit('join', { matchId: bravoMatch.matchId, mapId: 'wasteland', vehicleId: 'juggernaut', weaponId: 'plasma' });
    await wait(Math.max(0, alphaMatch.snapshot.startsAt - Date.now() + 100));

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
    assert.ok(playerRespawnUpdate.health > 0);

    alpha.disconnect();
    bravo.disconnect();
    console.log('PASS: exact 5v5 roster, friendly-fire rejection, human/bot damage, bot/player respawn, and spawn protection.');
} finally {
    server.kill('SIGTERM');
}
