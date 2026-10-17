import type { RequestHandler } from 'express';

/** Bounded per-process login budget; this server intentionally runs as a single game instance. */
export function authRateLimit(limit = 30, windowMs = 15 * 60 * 1000): RequestHandler {
    const clients = new Map<string, { count: number; expires: number }>();
    return (req, res, next) => {
        const now = Date.now();
        for (const [key, value] of clients) if (value.expires <= now) clients.delete(key);
        const key = req.ip || req.socket.remoteAddress || 'unknown';
        let entry = clients.get(key);
        if (!entry) {
            if (clients.size >= 10000) { res.status(503).json({ error: 'Authentication busy; retry shortly.' }); return; }
            entry = { count: 0, expires: now + windowMs }; clients.set(key, entry);
        }
        if (++entry.count > limit) {
            res.setHeader('Retry-After', Math.ceil((entry.expires - now) / 1000));
            res.status(429).json({ error: 'Too many attempts; retry later.' }); return;
        }
        next();
    };
}
