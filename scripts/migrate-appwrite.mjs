#!/usr/bin/env node
/**
 * Appwrite Schema Setup & Data Migration Tool
 *
 * Automatically creates the Appwrite database, collections, attributes, and indexes,
 * then migrates existing SQLite user data into Appwrite Cloud or self-hosted instance.
 *
 * Usage:
 *   node scripts/migrate-appwrite.mjs
 *   node scripts/migrate-appwrite.mjs --setup-only
 */

import { Client, Databases, ID, Query, DatabasesIndexType } from 'node-appwrite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');
const envPath = resolve(root, '.env');

// Load environment variables from server/.env
config({ path: envPath });

const endpoint = (process.env.APPWRITE_ENDPOINT || 'https://cloud.appwrite.io/v1').trim();
const projectId = (process.env.APPWRITE_PROJECT_ID || '').trim();
const apiKey = (process.env.APPWRITE_API_KEY || '').trim();
const databaseId = (process.env.APPWRITE_DATABASE_ID || 'overdrive').trim();

const collections = {
    users: (process.env.APPWRITE_USERS_COLLECTION_ID || 'users').trim(),
    playerStats: (process.env.APPWRITE_PLAYER_STATS_COLLECTION_ID || 'player_stats').trim(),
    wallets: (process.env.APPWRITE_WALLET_COLLECTION_ID || 'wallets').trim(),
    vehicles: (process.env.APPWRITE_VEHICLES_COLLECTION_ID || 'vehicles').trim(),
    weapons: (process.env.APPWRITE_WEAPONS_COLLECTION_ID || 'weapons').trim(),
};

const setupOnly = process.argv.includes('--setup-only');

console.log('====================================================');
console.log('⚡ Overdrive Appwrite Setup & Migration Tool');
console.log('====================================================');
console.log(`Endpoint:    ${endpoint}`);
console.log(`Project ID:  ${projectId || '(not set)'}`);
console.log(`Database ID: ${databaseId}`);
console.log(`API Key:     ${apiKey ? apiKey.slice(0, 12) + '...' : '(not set)'}`);
console.log('----------------------------------------------------');

if (!projectId || !apiKey) {
    console.error('\n❌ ERROR: Appwrite credentials are not configured.');
    console.error('Please open server/.env and set:');
    console.error('  APPWRITE_PROJECT_ID=your-project-id');
    console.error('  APPWRITE_API_KEY=your-secret-api-key');
    console.error('  APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1\n');
    process.exit(1);
}

const client = new Client()
    .setEndpoint(endpoint)
    .setProject(projectId)
    .setKey(apiKey);

const databases = new Databases(client);

const sleep = ms => new Promise(res => setTimeout(res, ms));

async function ensureDatabase() {
    try {
        await databases.get(databaseId);
        console.log(`✔ Database "${databaseId}" exists.`);
    } catch (err) {
        if (err?.code === 404) {
            console.log(`Creating database "${databaseId}"...`);
            await databases.create(databaseId, 'Overdrive Game Database');
            console.log(`✔ Database "${databaseId}" created successfully.`);
        } else {
            throw err;
        }
    }
}

/**
 * Resolves collection by ID or case-insensitive name. Creates if missing.
 */
async function ensureCollection(collKey, displayName) {
    const preferredIdOrName = collections[collKey];
    try {
        const list = await databases.listCollections(databaseId);
        const match = list.collections.find(c =>
            c.$id === preferredIdOrName ||
            c.name.toLowerCase() === displayName.toLowerCase() ||
            c.name.toLowerCase() === collKey.toLowerCase()
        );
        if (match) {
            console.log(`✔ Collection "${displayName}" (${match.$id}) exists.`);
            collections[collKey] = match.$id;
            return match.$id;
        }
    } catch (e) {
        // continue to create
    }

    console.log(`Creating collection "${displayName}" (${preferredIdOrName})...`);
    try {
        const created = await databases.createCollection(databaseId, preferredIdOrName, displayName);
        console.log(`✔ Collection "${displayName}" created with ID: ${created.$id}`);
        collections[collKey] = created.$id;
        return created.$id;
    } catch (err) {
        const created = await databases.createCollection(databaseId, ID.unique(), displayName);
        console.log(`✔ Collection "${displayName}" created with fallback ID: ${created.$id}`);
        collections[collKey] = created.$id;
        return created.$id;
    }
}

async function ensureStringAttr(collId, key, size, required = false, xdefault = undefined) {
    try {
        await databases.getAttribute(databaseId, collId, key);
    } catch (err) {
        if (err?.code === 404) {
            console.log(`  + [${collId}] Adding string attribute: ${key} (size: ${size}, required: ${required})`);
            await databases.createStringAttribute(databaseId, collId, key, size, required, xdefault);
        } else {
            throw err;
        }
    }
}

async function ensureIntegerAttr(collId, key, required = false, min = undefined, max = undefined, xdefault = undefined) {
    try {
        await databases.getAttribute(databaseId, collId, key);
    } catch (err) {
        if (err?.code === 404) {
            console.log(`  + [${collId}] Adding integer attribute: ${key} (default: ${xdefault})`);
            await databases.createIntegerAttribute(databaseId, collId, key, required, min, max, xdefault);
        } else {
            throw err;
        }
    }
}

async function ensureIndex(collId, key, type, attributes) {
    try {
        await databases.getIndex(databaseId, collId, key);
    } catch (err) {
        if (err?.code === 404) {
            console.log(`  + [${collId}] Creating index: ${key} (${type}) on [${attributes.join(', ')}]`);
            await databases.createIndex(databaseId, collId, key, type, attributes);
        } else {
            throw err;
        }
    }
}

async function waitForAttributes(collId, keys) {
    process.stdout.write(`  Waiting for attributes in ${collId} to become ready...`);
    for (let attempt = 0; attempt < 30; attempt++) {
        let allReady = true;
        for (const key of keys) {
            try {
                const attr = await databases.getAttribute(databaseId, collId, key);
                if (attr.status !== 'available') {
                    allReady = false;
                    break;
                }
            } catch {
                allReady = false;
                break;
            }
        }
        if (allReady) {
            console.log(' Ready!');
            return;
        }
        await sleep(1000);
        process.stdout.write('.');
    }
    console.log(' Proceeding.');
}

function updateEnvFile() {
    if (!existsSync(envPath)) return;
    try {
        let content = readFileSync(envPath, 'utf8');
        const map = {
            APPWRITE_USERS_COLLECTION_ID: collections.users,
            APPWRITE_PLAYER_STATS_COLLECTION_ID: collections.playerStats,
            APPWRITE_WALLET_COLLECTION_ID: collections.wallets,
            APPWRITE_VEHICLES_COLLECTION_ID: collections.vehicles,
            APPWRITE_WEAPONS_COLLECTION_ID: collections.weapons,
        };

        for (const [key, val] of Object.entries(map)) {
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(content)) {
                content = content.replace(regex, `${key}=${val}`);
            } else {
                content += `\n${key}=${val}`;
            }
        }
        writeFileSync(envPath, content);
        console.log('✔ Updated server/.env with resolved collection IDs.');
    } catch (err) {
        console.warn('Notice: Could not auto-update .env file:', err.message);
    }
}

async function setupSchema() {
    console.log('\n--- Setting up Appwrite Database & Collections ---');
    await ensureDatabase();

    // 1. Users collection
    const usersId = await ensureCollection('users', 'users');
    await ensureStringAttr(usersId, 'username', 64, true);
    await ensureStringAttr(usersId, 'email', 255, true);
    await ensureStringAttr(usersId, 'passwordHash', 255, true);
    await ensureStringAttr(usersId, 'createdAt', 64, true);
    await ensureStringAttr(usersId, 'lastLogin', 64, false);
    await waitForAttributes(usersId, ['username', 'email', 'passwordHash', 'createdAt']);
    await ensureIndex(usersId, 'idx_users_username', DatabasesIndexType.Unique, ['username']);
    await ensureIndex(usersId, 'idx_users_email', DatabasesIndexType.Unique, ['email']);

    // 2. PlayerStats collection
    const statsId = await ensureCollection('playerStats', 'player_stats');
    await ensureStringAttr(statsId, 'userId', 64, true);
    await ensureIntegerAttr(statsId, 'level', false, 1, 100, 1);
    await ensureIntegerAttr(statsId, 'xp', false, 0, 10000000, 0);
    await ensureIntegerAttr(statsId, 'mmr', false, 0, 100000, 1000);
    await ensureIntegerAttr(statsId, 'totalMatches', false, 0, 100000, 0);
    await ensureIntegerAttr(statsId, 'wins', false, 0, 100000, 0);
    await ensureIntegerAttr(statsId, 'kills', false, 0, 1000000, 0);
    await ensureIntegerAttr(statsId, 'deaths', false, 0, 1000000, 0);
    await waitForAttributes(statsId, ['userId', 'level', 'xp', 'mmr']);
    await ensureIndex(statsId, 'idx_player_stats_userId', DatabasesIndexType.Unique, ['userId']);

    // 3. Wallets collection
    const walletsId = await ensureCollection('wallets', 'wallets');
    await ensureStringAttr(walletsId, 'userId', 64, true);
    await ensureIntegerAttr(walletsId, 'scrap', false, 0, 10000000, 0);
    await ensureIntegerAttr(walletsId, 'credits', false, 0, 10000000, 0);
    await waitForAttributes(walletsId, ['userId', 'scrap', 'credits']);
    await ensureIndex(walletsId, 'idx_wallets_userId', DatabasesIndexType.Unique, ['userId']);

    // 4. Vehicles collection
    const vehiclesId = await ensureCollection('vehicles', 'vehicles');
    await ensureStringAttr(vehiclesId, 'userId', 64, true);
    await ensureStringAttr(vehiclesId, 'vehicleType', 64, true);
    await ensureStringAttr(vehiclesId, 'color', 32, false);
    await ensureIntegerAttr(vehiclesId, 'engineLevel', false, 1, 10, 1);
    await ensureIntegerAttr(vehiclesId, 'armorLevel', false, 1, 10, 1);
    await waitForAttributes(vehiclesId, ['userId', 'vehicleType']);
    await ensureIndex(vehiclesId, 'idx_vehicles_userId', DatabasesIndexType.Key, ['userId']);

    // 5. Weapons collection
    const weaponsId = await ensureCollection('weapons', 'weapons');
    await ensureStringAttr(weaponsId, 'userId', 64, true);
    await ensureStringAttr(weaponsId, 'weaponType', 64, true);
    await ensureIntegerAttr(weaponsId, 'damageLevel', false, 1, 10, 1);
    await ensureIntegerAttr(weaponsId, 'cooldownLevel', false, 1, 10, 1);
    await waitForAttributes(weaponsId, ['userId', 'weaponType']);
    await ensureIndex(weaponsId, 'idx_weapons_userId', DatabasesIndexType.Key, ['userId']);

    updateEnvFile();
    console.log('\n✔ All collections, attributes, and indexes verified!');
}

async function migrateData() {
    const dataPath = resolve(__dirname, 'migrated-data.json');
    if (!existsSync(dataPath)) {
        console.log(`\nℹ No seed data file found at ${dataPath}. Skipping data migration.`);
        return;
    }

    const data = JSON.parse(readFileSync(dataPath, 'utf8'));
    console.log('\n--- Migrating SQLite Data into Appwrite ---');

    // 1. Migrate Users
    if (Array.isArray(data.User) && data.User.length > 0) {
        console.log(`Migrating ${data.User.length} users...`);
        for (const u of data.User) {
            try {
                const existing = await databases.listDocuments(databaseId, collections.users, [
                    Query.equal('username', u.username),
                    Query.limit(1)
                ]);
                if (existing.total > 0) {
                    console.log(`  - User ${u.username} already exists (skipping)`);
                    continue;
                }

                await databases.createDocument(databaseId, collections.users, u.id, {
                    username: u.username,
                    email: u.email,
                    passwordHash: u.passwordHash,
                    createdAt: typeof u.createdAt === 'number' ? new Date(u.createdAt).toISOString() : String(u.createdAt),
                    lastLogin: u.lastLogin ? (typeof u.lastLogin === 'number' ? new Date(u.lastLogin).toISOString() : String(u.lastLogin)) : null,
                });
                console.log(`  ✔ Migrated user: ${u.username} (${u.email})`);
            } catch (err) {
                console.error(`  ❌ Failed to migrate user ${u.username}:`, err.message || err);
            }
        }
    }

    // 2. Migrate PlayerStats
    if (Array.isArray(data.PlayerStats) && data.PlayerStats.length > 0) {
        console.log(`Migrating ${data.PlayerStats.length} player stats...`);
        for (const s of data.PlayerStats) {
            try {
                const existing = await databases.listDocuments(databaseId, collections.playerStats, [
                    Query.equal('userId', s.userId),
                    Query.limit(1)
                ]);
                if (existing.total > 0) {
                    console.log(`  - Stats for user ${s.userId} already exist (skipping)`);
                    continue;
                }

                await databases.createDocument(databaseId, collections.playerStats, s.id || ID.unique(), {
                    userId: s.userId,
                    level: Number(s.level ?? 1),
                    xp: Number(s.xp ?? 0),
                    mmr: Number(s.mmr ?? 1000),
                    totalMatches: Number(s.totalMatches ?? 0),
                    wins: Number(s.wins ?? 0),
                    kills: Number(s.kills ?? 0),
                    deaths: Number(s.deaths ?? 0),
                });
                console.log(`  ✔ Migrated stats for user: ${s.userId} (Level ${s.level}, Kills ${s.kills})`);
            } catch (err) {
                console.error(`  ❌ Failed to migrate stats for ${s.userId}:`, err.message || err);
            }
        }
    }

    // 3. Migrate Wallets
    if (Array.isArray(data.Wallet) && data.Wallet.length > 0) {
        console.log(`Migrating ${data.Wallet.length} wallets...`);
        for (const w of data.Wallet) {
            try {
                const existing = await databases.listDocuments(databaseId, collections.wallets, [
                    Query.equal('userId', w.userId),
                    Query.limit(1)
                ]);
                if (existing.total > 0) {
                    console.log(`  - Wallet for user ${w.userId} already exist (skipping)`);
                    continue;
                }

                await databases.createDocument(databaseId, collections.wallets, w.id || ID.unique(), {
                    userId: w.userId,
                    scrap: Number(w.scrap ?? 0),
                    credits: Number(w.credits ?? 0),
                });
                console.log(`  ✔ Migrated wallet for user: ${w.userId} (${w.scrap} scrap)`);
            } catch (err) {
                console.error(`  ❌ Failed to migrate wallet for ${w.userId}:`, err.message || err);
            }
        }
    }

    // 4. Vehicles & Weapons
    if (Array.isArray(data.VehicleInventory) && data.VehicleInventory.length > 0) {
        console.log(`Migrating ${data.VehicleInventory.length} vehicles...`);
        for (const v of data.VehicleInventory) {
            try {
                await databases.createDocument(databaseId, collections.vehicles, v.id || ID.unique(), {
                    userId: v.userId,
                    vehicleType: v.vehicleType,
                    color: v.color || null,
                    engineLevel: Number(v.engineLevel ?? 1),
                    armorLevel: Number(v.armorLevel ?? 1),
                });
            } catch (err) {
                console.error(`  ❌ Failed to migrate vehicle:`, err.message || err);
            }
        }
    }

    if (Array.isArray(data.WeaponInventory) && data.WeaponInventory.length > 0) {
        console.log(`Migrating ${data.WeaponInventory.length} weapons...`);
        for (const w of data.WeaponInventory) {
            try {
                await databases.createDocument(databaseId, collections.weapons, w.id || ID.unique(), {
                    userId: w.userId,
                    weaponType: w.weaponType,
                    damageLevel: Number(w.damageLevel ?? 1),
                    cooldownLevel: Number(w.cooldownLevel ?? 1),
                });
            } catch (err) {
                console.error(`  ❌ Failed to migrate weapon:`, err.message || err);
            }
        }
    }

    console.log('\n✔ Data migration completed successfully!');
}

async function run() {
    try {
        await setupSchema();
        if (!setupOnly) {
            await migrateData();
        }
        console.log('\n====================================================');
        console.log('🎉 Appwrite setup and migration finished!');
        console.log('====================================================');
    } catch (err) {
        console.error('\n💥 Migration failed:', err);
        process.exit(1);
    }
}

run();
