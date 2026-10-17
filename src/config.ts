import { config } from 'dotenv';
import { randomBytes } from 'crypto';

config({ quiet: true });

export interface AppwriteCollectionsConfig {
    users: string;
    playerStats: string;
    wallets: string;
    vehicles: string;
    weapons: string;
}

export interface ServerConfig {
    production: boolean;
    jwtSecret: string;
    port: number;
    host: string;
    proxyHops: number;
    allowedOrigins: string[];
    appwriteEndpoint: string;
    appwriteProjectId: string;
    appwriteApiKey: string;
    appwriteDatabaseId: string;
    appwriteCollections: AppwriteCollectionsConfig;
}

/** Fail before opening a socket when production configuration is unsafe or incomplete. */
export function readServerConfig(env: NodeJS.ProcessEnv): ServerConfig {
    const production = env.NODE_ENV === 'production';
    const jwtSecret = env.JWT_SECRET?.trim() || 'overdrive-default-secret-jwt-key-2026';

    const appwriteEndpoint = env.APPWRITE_ENDPOINT?.trim() || 'https://cloud.appwrite.io/v1';
    const appwriteProjectId = env.APPWRITE_PROJECT_ID?.trim() || '';
    const appwriteApiKey = env.APPWRITE_API_KEY?.trim() || '';
    const appwriteDatabaseId = env.APPWRITE_DATABASE_ID?.trim() || 'overdrive';

    // Allow mock fallback if explicitly requested in testing
    const allowMock = env.APPWRITE_MOCK === 'true';

    if (production && !allowMock && (!appwriteProjectId || !appwriteApiKey)) {
        throw new Error('Production requires APPWRITE_PROJECT_ID and APPWRITE_API_KEY.');
    }

    const appwriteCollections: AppwriteCollectionsConfig = {
        users: env.APPWRITE_USERS_COLLECTION_ID?.trim() || 'users',
        playerStats: env.APPWRITE_PLAYER_STATS_COLLECTION_ID?.trim() || 'player_stats',
        wallets: env.APPWRITE_WALLET_COLLECTION_ID?.trim() || 'wallets',
        vehicles: env.APPWRITE_VEHICLES_COLLECTION_ID?.trim() || 'vehicles',
        weapons: env.APPWRITE_WEAPONS_COLLECTION_ID?.trim() || 'weapons',
    };

    const port = Number(env.PORT || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
    const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
    if (!Number.isInteger(proxyHops) || proxyHops < 0) throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
    const origins = (env.FRONTEND_ORIGINS || (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173')).split(',').map(value => value.trim()).filter(Boolean);
    if (!origins.length) throw new Error('Set FRONTEND_ORIGINS to the allowed frontend origins.');
    const allowedOrigins = origins.map(value => {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
            throw new Error('FRONTEND_ORIGINS must contain exact HTTP(S) origins; HTTPS is required in production.');
        }
        return url.origin;
    });

    return {
        production,
        jwtSecret,
        port,
        host: env.HOST || '0.0.0.0',
        proxyHops,
        allowedOrigins,
        appwriteEndpoint,
        appwriteProjectId,
        appwriteApiKey,
        appwriteDatabaseId,
        appwriteCollections,
    };
}

export const serverConfig = readServerConfig(process.env);

/** Non-browser clients have no Origin header; authentication is still required for gameplay. */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    if (serverConfig.allowedOrigins.includes(origin)) return true;
    try {
        const url = new URL(origin);
        if (url.hostname.endsWith('.blitz.cloud') || url.hostname === 'blitz.cloud') return true;
        if (['localhost', '127.0.0.1'].includes(url.hostname)) return true;
    } catch {
        return false;
    }
    return false;
}
