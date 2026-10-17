import { serverConfig } from './config';
import { Client, Databases, Query, ID } from 'node-appwrite';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface DbUser {
    id: string;
    username: string;
    email: string;
    passwordHash: string;
    createdAt: string;
    lastLogin: string | null;
}

export interface DbPlayerStats {
    id: string;
    userId: string;
    level: number;
    xp: number;
    mmr: number;
    totalMatches: number;
    wins: number;
    kills: number;
    deaths: number;
}

export interface DbWallet {
    id: string;
    userId: string;
    scrap: number;
    credits: number;
}

export interface DbUserWithRelations extends DbUser {
    stats: DbPlayerStats | null;
    wallet: DbWallet | null;
}

/**
 * Normalizes document returned from Appwrite Databases or in-memory mock.
 */
function mapUserDoc(doc: any): DbUser {
    return {
        id: doc.$id || doc.id || doc.userId,
        username: doc.username,
        email: doc.email,
        passwordHash: doc.passwordHash,
        createdAt: typeof doc.createdAt === 'number' ? new Date(doc.createdAt).toISOString() : String(doc.createdAt || doc.$createdAt || new Date().toISOString()),
        lastLogin: doc.lastLogin ? (typeof doc.lastLogin === 'number' ? new Date(doc.lastLogin).toISOString() : String(doc.lastLogin)) : null,
    };
}

function mapStatsDoc(doc: any): DbPlayerStats {
    return {
        id: doc.$id || doc.id || randomUUID(),
        userId: doc.userId,
        level: Number(doc.level ?? 1),
        xp: Number(doc.xp ?? 0),
        mmr: Number(doc.mmr ?? 1000),
        totalMatches: Number(doc.totalMatches ?? 0),
        wins: Number(doc.wins ?? 0),
        kills: Number(doc.kills ?? 0),
        deaths: Number(doc.deaths ?? 0),
    };
}

function mapWalletDoc(doc: any): DbWallet {
    return {
        id: doc.$id || doc.id || randomUUID(),
        userId: doc.userId,
        scrap: Number(doc.scrap ?? 0),
        credits: Number(doc.credits ?? 0),
    };
}

/**
 * In-memory fallback repository used when Appwrite credentials are not yet configured
 * or during offline smoke tests.
 */
class InMemoryDatabase {
    private users = new Map<string, DbUser>();
    private stats = new Map<string, DbPlayerStats>();
    private wallets = new Map<string, DbWallet>();

    constructor() {
        this.loadSeedData();
    }

    private loadSeedData(): void {
        const seedPath = join(__dirname, '../scripts/migrated-data.json');
        if (existsSync(seedPath)) {
            try {
                const raw = JSON.parse(readFileSync(seedPath, 'utf8'));
                if (Array.isArray(raw.User)) {
                    for (const u of raw.User) {
                        this.users.set(u.id, mapUserDoc(u));
                    }
                }
                if (Array.isArray(raw.PlayerStats)) {
                    for (const s of raw.PlayerStats) {
                        this.stats.set(s.userId, mapStatsDoc(s));
                    }
                }
                if (Array.isArray(raw.Wallet)) {
                    for (const w of raw.Wallet) {
                        this.wallets.set(w.userId, mapWalletDoc(w));
                    }
                }
            } catch (err) {
                console.warn('[Overdrive DB] Notice: Unable to preload seed data:', err);
            }
        }
    }

    async ping(): Promise<boolean> {
        return true;
    }

    async findUserByEmailOrUsername(email: string, username: string): Promise<DbUser | null> {
        const lowerEmail = email.toLowerCase();
        const lowerUsername = username.toLowerCase();
        for (const user of this.users.values()) {
            if (user.email.toLowerCase() === lowerEmail || user.username.toLowerCase() === lowerUsername) {
                return user;
            }
        }
        return null;
    }

    async findUserByUsername(username: string): Promise<DbUserWithRelations | null> {
        const lower = username.toLowerCase();
        for (const user of this.users.values()) {
            if (user.username.toLowerCase() === lower) {
                const stats = this.stats.get(user.id) || null;
                const wallet = this.wallets.get(user.id) || null;
                return { ...user, stats, wallet };
            }
        }
        return null;
    }

    async findUserById(id: string): Promise<DbUserWithRelations | null> {
        const user = this.users.get(id);
        if (!user) return null;
        const stats = this.stats.get(user.id) || null;
        const wallet = this.wallets.get(user.id) || null;
        return { ...user, stats, wallet };
    }

    async createUser(data: { username: string; email: string; passwordHash: string }): Promise<DbUserWithRelations> {
        if (await this.findUserByEmailOrUsername(data.email, data.username)) {
            const err = new Error('Username or email already exists');
            (err as any).code = 409;
            throw err;
        }

        const id = randomUUID();
        const now = new Date().toISOString();
        const user: DbUser = {
            id,
            username: data.username,
            email: data.email,
            passwordHash: data.passwordHash,
            createdAt: now,
            lastLogin: null,
        };

        const stats: DbPlayerStats = {
            id: randomUUID(),
            userId: id,
            level: 1,
            xp: 0,
            mmr: 1000,
            totalMatches: 0,
            wins: 0,
            kills: 0,
            deaths: 0,
        };

        const wallet: DbWallet = {
            id: randomUUID(),
            userId: id,
            scrap: 0,
            credits: 0,
        };

        this.users.set(id, user);
        this.stats.set(id, stats);
        this.wallets.set(id, wallet);

        return { ...user, stats, wallet };
    }

    async updateUserLastLogin(userId: string): Promise<void> {
        const user = this.users.get(userId);
        if (user) {
            user.lastLogin = new Date().toISOString();
        }
    }

    async getPlayerStats(userId: string): Promise<DbPlayerStats | null> {
        return this.stats.get(userId) || null;
    }

    async updatePlayerStats(userId: string, data: Partial<DbPlayerStats>): Promise<DbPlayerStats> {
        let stats = this.stats.get(userId);
        if (!stats) {
            stats = {
                id: randomUUID(),
                userId,
                level: 1,
                xp: 0,
                mmr: 1000,
                totalMatches: 0,
                wins: 0,
                kills: 0,
                deaths: 0,
            };
            this.stats.set(userId, stats);
        }
        Object.assign(stats, data);
        return stats;
    }

    async incrementWalletScrap(userId: string, scrapGain: number): Promise<DbWallet> {
        let wallet = this.wallets.get(userId);
        if (!wallet) {
            wallet = { id: randomUUID(), userId, scrap: 0, credits: 0 };
            this.wallets.set(userId, wallet);
        }
        wallet.scrap += scrapGain;
        return wallet;
    }

    async getUserWithStatsAndWallet(userId: string): Promise<DbUserWithRelations | null> {
        return this.findUserById(userId);
    }

    async disconnect(): Promise<void> {}
}

/**
 * Appwrite implementation of the Database service.
 */
class AppwriteDatabase {
    private client: Client;
    private databases: Databases;
    private databaseId: string;
    private collections = serverConfig.appwriteCollections;
    private resolvedCollections = new Map<string, string>();

    constructor() {
        this.client = new Client()
            .setEndpoint(serverConfig.appwriteEndpoint)
            .setProject(serverConfig.appwriteProjectId)
            .setKey(serverConfig.appwriteApiKey);
        this.databases = new Databases(this.client);
        this.databaseId = serverConfig.appwriteDatabaseId;
    }

    /**
     * Resolves the real collection ID, matching by ID or case-insensitive name if needed.
     */
    private async getCollId(key: 'users' | 'playerStats' | 'wallets' | 'vehicles' | 'weapons'): Promise<string> {
        const cached = this.resolvedCollections.get(key);
        if (cached) return cached;

        const configured = this.collections[key];
        try {
            await this.databases.getCollection(this.databaseId, configured);
            this.resolvedCollections.set(key, configured);
            return configured;
        } catch (err: any) {
            if (err?.code === 404) {
                try {
                    const list = await this.databases.listCollections(this.databaseId);
                    const alias = key === 'playerStats' ? 'player_stats' : key;
                    const match = list.collections.find(c =>
                        c.$id === configured ||
                        c.name.toLowerCase() === configured.toLowerCase() ||
                        c.name.toLowerCase() === alias.toLowerCase() ||
                        c.name.toLowerCase() === key.toLowerCase()
                    );
                    if (match) {
                        this.resolvedCollections.set(key, match.$id);
                        return match.$id;
                    }
                } catch (listErr) {
                    console.warn('[Appwrite] Error resolving collection by name:', listErr);
                }
            }
            this.resolvedCollections.set(key, configured);
            return configured;
        }
    }

    async ping(): Promise<boolean> {
        try {
            await this.databases.get(this.databaseId);
            return true;
        } catch (error) {
            console.error('[Appwrite] Database ping error:', error);
            return false;
        }
    }

    async findUserByEmailOrUsername(email: string, username: string): Promise<DbUser | null> {
        try {
            const usersColl = await this.getCollId('users');
            const emailRes = await this.databases.listDocuments(this.databaseId, usersColl, [
                Query.equal('email', email),
                Query.limit(1),
            ]);
            if (emailRes.total > 0 && emailRes.documents[0]) {
                return mapUserDoc(emailRes.documents[0]);
            }

            const usernameRes = await this.databases.listDocuments(this.databaseId, usersColl, [
                Query.equal('username', username),
                Query.limit(1),
            ]);
            if (usernameRes.total > 0 && usernameRes.documents[0]) {
                return mapUserDoc(usernameRes.documents[0]);
            }

            return null;
        } catch (error) {
            console.error('[Appwrite] findUserByEmailOrUsername error:', error);
            throw error;
        }
    }

    async findUserByUsername(username: string): Promise<DbUserWithRelations | null> {
        try {
            const usersColl = await this.getCollId('users');
            const res = await this.databases.listDocuments(this.databaseId, usersColl, [
                Query.equal('username', username),
                Query.limit(1),
            ]);
            if (res.total === 0 || !res.documents[0]) return null;

            const user = mapUserDoc(res.documents[0]);
            const [stats, wallet] = await Promise.all([
                this.getPlayerStats(user.id),
                this.getWallet(user.id),
            ]);

            return { ...user, stats, wallet };
        } catch (error) {
            console.error('[Appwrite] findUserByUsername error:', error);
            throw error;
        }
    }

    async findUserById(id: string): Promise<DbUserWithRelations | null> {
        try {
            const usersColl = await this.getCollId('users');
            const doc = await this.databases.getDocument(this.databaseId, usersColl, id);
            const user = mapUserDoc(doc);
            const [stats, wallet] = await Promise.all([
                this.getPlayerStats(user.id),
                this.getWallet(user.id),
            ]);

            return { ...user, stats, wallet };
        } catch (error: any) {
            if (error?.code === 404) return null;
            console.error('[Appwrite] findUserById error:', error);
            throw error;
        }
    }

    async createUser(data: { username: string; email: string; passwordHash: string }): Promise<DbUserWithRelations> {
        const existing = await this.findUserByEmailOrUsername(data.email, data.username);
        if (existing) {
            const err = new Error('Username or email already exists');
            (err as any).code = 409;
            throw err;
        }

        const userId = randomUUID();
        const now = new Date().toISOString();

        try {
            const [usersColl, statsColl, walletsColl] = await Promise.all([
                this.getCollId('users'),
                this.getCollId('playerStats'),
                this.getCollId('wallets'),
            ]);

            const userDoc = await this.databases.createDocument(
                this.databaseId,
                usersColl,
                userId,
                {
                    username: data.username,
                    email: data.email,
                    passwordHash: data.passwordHash,
                    createdAt: now,
                    lastLogin: null,
                }
            );

            const statsDoc = await this.databases.createDocument(
                this.databaseId,
                statsColl,
                ID.unique(),
                {
                    userId,
                    level: 1,
                    xp: 0,
                    mmr: 1000,
                    totalMatches: 0,
                    wins: 0,
                    kills: 0,
                    deaths: 0,
                }
            );

            const walletDoc = await this.databases.createDocument(
                this.databaseId,
                walletsColl,
                ID.unique(),
                {
                    userId,
                    scrap: 0,
                    credits: 0,
                }
            );

            const user = mapUserDoc(userDoc);
            const stats = mapStatsDoc(statsDoc);
            const wallet = mapWalletDoc(walletDoc);

            return { ...user, stats, wallet };
        } catch (error: any) {
            if (error?.code === 409) {
                const err = new Error('Username or email already exists');
                (err as any).code = 409;
                throw err;
            }
            console.error('[Appwrite] createUser error:', error);
            throw error;
        }
    }

    async updateUserLastLogin(userId: string): Promise<void> {
        try {
            const usersColl = await this.getCollId('users');
            await this.databases.updateDocument(
                this.databaseId,
                usersColl,
                userId,
                { lastLogin: new Date().toISOString() }
            );
        } catch (error) {
            console.warn('[Appwrite] updateUserLastLogin error:', error);
        }
    }

    async getPlayerStats(userId: string): Promise<DbPlayerStats | null> {
        try {
            const statsColl = await this.getCollId('playerStats');
            const res = await this.databases.listDocuments(this.databaseId, statsColl, [
                Query.equal('userId', userId),
                Query.limit(1),
            ]);
            if (res.total === 0 || !res.documents[0]) return null;
            return mapStatsDoc(res.documents[0]);
        } catch (error) {
            console.error('[Appwrite] getPlayerStats error:', error);
            return null;
        }
    }

    async updatePlayerStats(userId: string, data: Partial<DbPlayerStats>): Promise<DbPlayerStats> {
        try {
            const statsColl = await this.getCollId('playerStats');
            const res = await this.databases.listDocuments(this.databaseId, statsColl, [
                Query.equal('userId', userId),
                Query.limit(1),
            ]);

            if (res.total > 0 && res.documents[0]) {
                const existing = res.documents[0];
                const updated = await this.databases.updateDocument(
                    this.databaseId,
                    statsColl,
                    existing.$id,
                    data
                );
                return mapStatsDoc(updated);
            }

            // Create if missing
            const created = await this.databases.createDocument(
                this.databaseId,
                statsColl,
                ID.unique(),
                {
                    userId,
                    level: data.level ?? 1,
                    xp: data.xp ?? 0,
                    mmr: data.mmr ?? 1000,
                    totalMatches: data.totalMatches ?? 0,
                    wins: data.wins ?? 0,
                    kills: data.kills ?? 0,
                    deaths: data.deaths ?? 0,
                }
            );
            return mapStatsDoc(created);
        } catch (error) {
            console.error('[Appwrite] updatePlayerStats error:', error);
            throw error;
        }
    }

    private async getWallet(userId: string): Promise<DbWallet | null> {
        try {
            const walletsColl = await this.getCollId('wallets');
            const res = await this.databases.listDocuments(this.databaseId, walletsColl, [
                Query.equal('userId', userId),
                Query.limit(1),
            ]);
            if (res.total === 0 || !res.documents[0]) return null;
            return mapWalletDoc(res.documents[0]);
        } catch (error) {
            console.error('[Appwrite] getWallet error:', error);
            return null;
        }
    }

    async incrementWalletScrap(userId: string, scrapGain: number): Promise<DbWallet> {
        try {
            const walletsColl = await this.getCollId('wallets');
            const res = await this.databases.listDocuments(this.databaseId, walletsColl, [
                Query.equal('userId', userId),
                Query.limit(1),
            ]);

            if (res.total > 0 && res.documents[0]) {
                const existing = res.documents[0];
                const currentScrap = Number(existing.scrap ?? 0);
                const updated = await this.databases.updateDocument(
                    this.databaseId,
                    walletsColl,
                    existing.$id,
                    { scrap: currentScrap + scrapGain }
                );
                return mapWalletDoc(updated);
            }

            const created = await this.databases.createDocument(
                this.databaseId,
                walletsColl,
                ID.unique(),
                {
                    userId,
                    scrap: scrapGain,
                    credits: 0,
                }
            );
            return mapWalletDoc(created);
        } catch (error) {
            console.error('[Appwrite] incrementWalletScrap error:', error);
            throw error;
        }
    }

    async getUserWithStatsAndWallet(userId: string): Promise<DbUserWithRelations | null> {
        return this.findUserById(userId);
    }

    async disconnect(): Promise<void> {}
}

const isAppwriteConfigured = Boolean(
    serverConfig.appwriteApiKey &&
    serverConfig.appwriteProjectId &&
    process.env.APPWRITE_MOCK !== 'true'
);

if (!isAppwriteConfigured) {
    console.log('[Overdrive Database] Notice: Running in in-memory mode until APPWRITE_API_KEY and APPWRITE_PROJECT_ID are configured in server/.env');
}

export const db = isAppwriteConfigured ? new AppwriteDatabase() : new InMemoryDatabase();
