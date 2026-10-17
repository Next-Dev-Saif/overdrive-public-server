"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serverConfig = void 0;
exports.readServerConfig = readServerConfig;
exports.isAllowedOrigin = isAllowedOrigin;
const dotenv_1 = require("dotenv");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = require("path");
(0, dotenv_1.config)({ quiet: true });
/** Fail before opening a socket when production configuration is unsafe or incomplete. */
function readServerConfig(env) {
    var _a, _b;
    const production = env.NODE_ENV === 'production';
    const jwtSecret = (_a = env.JWT_SECRET) === null || _a === void 0 ? void 0 : _a.trim();
    if (production && (!jwtSecret || jwtSecret.length < 32 || jwtSecret === 'super-secret-overdrive-key' || /^(change|replace|your-)/i.test(jwtSecret))) {
        throw new Error('Production JWT_SECRET must be a private random secret of at least 32 characters.');
    }
    const databaseUrl = (_b = env.DATABASE_URL) === null || _b === void 0 ? void 0 : _b.trim();
    if (production && (!databaseUrl || !databaseUrl.startsWith('file:/'))) {
        throw new Error('Production DATABASE_URL must be an absolute file:/ path on persistent storage.');
    }
    const port = Number(env.PORT || 3001);
    if (!Number.isInteger(port) || port < 1 || port > 65535)
        throw new Error('PORT must be between 1 and 65535.');
    const proxyHops = Number(env.TRUST_PROXY_HOPS || 0);
    if (!Number.isInteger(proxyHops) || proxyHops < 0)
        throw new Error('TRUST_PROXY_HOPS must be a non-negative integer.');
    const origins = (env.FRONTEND_ORIGINS || (production ? '' : 'http://localhost:5173,http://127.0.0.1:5173')).split(',').map(value => value.trim()).filter(Boolean);
    if (!origins.length)
        throw new Error('Set FRONTEND_ORIGINS to the allowed frontend origins.');
    const allowedOrigins = origins.map(value => {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || (production && url.protocol !== 'https:') || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
            throw new Error('FRONTEND_ORIGINS must contain exact HTTP(S) origins; HTTPS is required in production.');
        }
        return url.origin;
    });
    return { production, jwtSecret: jwtSecret || (0, crypto_1.randomBytes)(32).toString('hex'), databaseUrl: databaseUrl || 'file:./dev.db', port, host: env.HOST || '0.0.0.0', proxyHops, allowedOrigins };
}
exports.serverConfig = readServerConfig(process.env);
// Prisma reads the same value for local development and deployed server processes.
process.env.DATABASE_URL = exports.serverConfig.databaseUrl;
if (exports.serverConfig.databaseUrl.startsWith('file:')) {
    const rawPath = exports.serverConfig.databaseUrl.replace(/^file:/, '');
    const dir = (0, path_1.dirname)(rawPath);
    if (dir && !(0, fs_1.existsSync)(dir)) {
        try {
            (0, fs_1.mkdirSync)(dir, { recursive: true });
        }
        catch (_a) {
            // ignore if permissions prevent mkdir
        }
    }
}
/** Non-browser clients have no Origin header; authentication is still required for gameplay. */
function isAllowedOrigin(origin) {
    if (!origin)
        return true;
    if (exports.serverConfig.allowedOrigins.includes(origin))
        return true;
    try {
        const url = new URL(origin);
        if (url.hostname.endsWith('.blitz.cloud') || url.hostname === 'blitz.cloud')
            return true;
        if (['localhost', '127.0.0.1'].includes(url.hostname))
            return true;
    }
    catch (_a) {
        return false;
    }
    return false;
}
