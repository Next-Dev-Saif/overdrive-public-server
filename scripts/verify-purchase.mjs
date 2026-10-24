import assert from 'node:assert/strict';
import { db } from '../dist/src/db.js';
import { BUNDLE_OFFERS, SKIN_OFFERS, upgradedHealth, weaponMultiplier } from '../dist/shared/economy.js';

async function run() {
    console.log('Running automated purchase, bundles & weapon upgrade verification...');

    // 1. Create fresh test user
    const testUser = await db.createUser({
        username: `trader-${Date.now().toString(36)}`,
        email: `trader-${Date.now().toString(36)}@test.invalid`,
        passwordHash: 'fixture',
    });
    assert.ok(testUser?.id, 'Test user created');

    // 2. Fund with plenty of scrap
    await db.incrementWalletScrap(testUser.id, 150000);
    let user = await db.getUserWithStatsAndWallet(testUser.id);
    assert.equal(user.wallet.scrap, 150000, 'Scrap incremented to 150000');

    // 3. Purchase each new skin (cyber, inferno, stealth, gold)
    for (const skinId of ['cyber', 'inferno', 'stealth', 'gold']) {
        const offer = SKIN_OFFERS.find(s => s.id === skinId);
        assert.ok(offer, `Skin offer ${skinId} exists`);
        const res = await db.purchase(testUser.id, { kind: 'skin', id: skinId });
        assert.ok(res.inventory.skins.includes(skinId), `Purchased skin ${skinId}`);
        // Idempotent duplicate purchase charges 0 extra scrap
        const dup = await db.purchase(testUser.id, { kind: 'skin', id: skinId });
        assert.equal(dup.scrap, res.scrap, `Duplicate purchase of ${skinId} charges 0 extra`);
    }

    // 4. Test Weapon Bundle: rapid_fire_bundle (minigun + plasma +1 tier)
    const beforeRapid = (await db.getUserWithStatsAndWallet(testUser.id)).wallet;
    const rapidRes = await db.purchase(testUser.id, { kind: 'bundle', id: 'rapid_fire_bundle' });
    assert.equal(rapidRes.inventory.weapons.minigun, beforeRapid.inventory.weapons.minigun + 1, 'Minigun upgraded via rapid_fire_bundle');
    assert.equal(rapidRes.inventory.weapons.plasma, beforeRapid.inventory.weapons.plasma + 1, 'Plasma upgraded via rapid_fire_bundle');
    assert.equal(rapidRes.scrap, beforeRapid.scrap - 950, 'Correct bundle price deducted (950)');

    // 5. Test Weapon Bundle: heavy_ordnance_bundle (missile + mortar + nuke +1 tier)
    const beforeHeavy = (await db.getUserWithStatsAndWallet(testUser.id)).wallet;
    const heavyRes = await db.purchase(testUser.id, { kind: 'bundle', id: 'heavy_ordnance_bundle' });
    assert.equal(heavyRes.inventory.weapons.missile, beforeHeavy.inventory.weapons.missile + 1, 'Missile upgraded via heavy_ordnance_bundle');
    assert.equal(heavyRes.inventory.weapons.mortar, beforeHeavy.inventory.weapons.mortar + 1, 'Mortar upgraded via heavy_ordnance_bundle');
    assert.equal(heavyRes.inventory.weapons.nuke, beforeHeavy.inventory.weapons.nuke + 1, 'Nuke upgraded via heavy_ordnance_bundle');
    assert.equal(heavyRes.scrap, beforeHeavy.scrap - 1400, 'Correct bundle price deducted (1400)');

    // 6. Test Fleet Package: ironclad_fleet_package (+1 tier to all 7 chassis)
    const beforeFleet = (await db.getUserWithStatsAndWallet(testUser.id)).wallet;
    const fleetRes = await db.purchase(testUser.id, { kind: 'bundle', id: 'ironclad_fleet_package' });
    for (const vId of ['interceptor', 'juggernaut', 'phantom', 'manticore', 'valkyrie', 'wraith', 'behemoth']) {
        assert.equal(fleetRes.inventory.armor[vId], beforeFleet.inventory.armor[vId] + 1, `Chassis ${vId} armor boosted by fleet pack`);
        assert.ok(upgradedHealth(vId, fleetRes.inventory) > upgradedHealth(vId, beforeFleet.inventory), `Health bonus verified for ${vId}`);
    }
    assert.equal(fleetRes.scrap, beforeFleet.scrap - 2600, 'Correct fleet package price deducted (2600)');

    // 7. Test Complete Arsenal Bundle: complete_arsenal_bundle (+1 tier to all 5 weapons)
    const beforeArsenal = (await db.getUserWithStatsAndWallet(testUser.id)).wallet;
    const arsenalRes = await db.purchase(testUser.id, { kind: 'bundle', id: 'complete_arsenal_bundle' });
    for (const wId of ['minigun', 'plasma', 'missile', 'mortar', 'nuke']) {
        assert.equal(arsenalRes.inventory.weapons[wId], beforeArsenal.inventory.weapons[wId] + 1, `Weapon ${wId} boosted by arsenal pack`);
        assert.ok(weaponMultiplier(wId, arsenalRes.inventory) > weaponMultiplier(wId, beforeArsenal.inventory), `Damage multiplier bonus verified for ${wId}`);
    }
    assert.equal(arsenalRes.scrap, beforeArsenal.scrap - 2200, 'Correct complete arsenal price deducted (2200)');

    // 8. Test Apex Vanguard Pack: apex_vanguard_pack (grants cyber skin + all 5 weapons +1)
    const beforeApex = (await db.getUserWithStatsAndWallet(testUser.id)).wallet;
    const apexRes = await db.purchase(testUser.id, { kind: 'bundle', id: 'apex_vanguard_pack' });
    assert.ok(apexRes.inventory.skins.includes('cyber'), 'Cyber skin granted by apex vanguard pack');
    assert.equal(apexRes.scrap, beforeApex.scrap - 5500, 'Correct apex package price deducted (5500)');

    // 9. Bring all weapons to max (level 5) through repeated upgrades
    for (const wId of ['minigun', 'plasma', 'missile', 'mortar', 'nuke']) {
        let cur = (await db.getUserWithStatsAndWallet(testUser.id)).wallet.inventory.weapons[wId];
        while (cur < 5) {
            const next = await db.purchase(testUser.id, { kind: 'weapon', id: wId, expectedLevel: cur });
            cur = next.inventory.weapons[wId];
        }
        assert.equal(cur, 5, `${wId} brought to level 5`);
    }

    // 10. Verify that a weapon bundle is rejected when its items are fully maxed
    await assert.rejects(
        () => db.purchase(testUser.id, { kind: 'bundle', id: 'rapid_fire_bundle' }),
        /All items in this bundle are already at maximum level or owned/
    );

    console.log('✅ ALL PURCHASES, PACKAGES, WEAPON BUNDLES, AND CAP LIMITS VERIFIED SUCCESSFULLY!');
}

run().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
