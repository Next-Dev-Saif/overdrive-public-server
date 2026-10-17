import { config } from 'dotenv';
import { randomBytes } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

config({ quiet: true });

/** Fail before opening a socket when production configuration is unsafe or incomplete. */
export function readServerConfig(env: NodeJS.ProcessEnv) {
    const production = env.NODE_ENV === 'production';
    const jwtSecret = env.JWT_SECRET?.trim();
    if (production && (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'super-secret-overdrive-key' || /^(change|replace|your-)/i.test(jwtSecret))) {
        throw new Error('Production JWT_SECRET must be a private random secret of at least 32 characters.');
    }
    const databaseUrl = env.DATABASE_URL?.trim();
    if (production && (!databaseUrl || !databaseUrl.startsWith('file:/'))) {
        throw new Error('Production DATABASE_URL must be an absolute file:/ path on persistent storage.');
    }
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
    return { production, jwtSecret: jwtSecret || randomBytes(32).toString('hex'), databaseUrl: databaseUrl || 'file:./dev.db', port, host: env.HOST || '0.0.0.0', proxyHops, allowedOrigins };
}

export const serverConfig = readServerConfig(process.env);
// Prisma reads the same value for local development and deployed server processes.
process.env.DATABASE_URL = serverConfig.databaseUrl;
if (serverConfig.databaseUrl.startsWith('file:')) {
    const rawPath = serverConfig.databaseUrl.replace(/^file:/, '');
    const dir = dirname(rawPath);
    if (dir && !existsSync(dir)) {
        try {
            mkdirSync(dir, { recursive: true });
        } catch {
            // ignore if permissions prevent mkdir
        }
    }
}

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
