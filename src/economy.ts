import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { serverConfig } from './config';
import { db } from './db';
import { normalizeInventory } from '../shared/economy';
import { authRateLimit } from './authRateLimit';

const router = Router();
router.use(authRateLimit(120));
router.use((req, res, next) => {
    try {
        const token = req.headers.authorization?.replace(/^Bearer /, '');
        if (!token) return res.status(401).json({ error: 'Sign in to access your inventory.' });
        const claims = jwt.verify(token, serverConfig.jwtSecret) as { userId?: string };
        if (!claims.userId) throw new Error('Invalid session');
        res.locals.userId = claims.userId;
        next();
    } catch { res.status(401).json({ error: 'Your session expired. Sign in again.' }); }
});
router.get('/', async (_req, res) => {
    try {
        const user = await db.getUserWithStatsAndWallet(res.locals.userId);
        if (!user?.wallet) return res.status(404).json({ error: 'Wallet unavailable.' });
        res.json({ ...user.wallet, inventory: normalizeInventory(user.wallet.inventory) });
    } catch { res.status(503).json({ error: 'Inventory is temporarily unavailable. Try again.' }); }
});
router.post('/purchase', async (req, res) => {
    const { kind, id, expectedLevel } = req.body ?? {};
    if (!['skin', 'armor', 'weapon', 'bundle'].includes(kind) || typeof id !== 'string' || id.length > 40) return res.status(400).json({ error: 'Invalid purchase.' });
    try { res.json(await db.purchase(res.locals.userId, { kind, id, expectedLevel })); }
    catch (error) {
        console.error('[Economy] Purchase failed:', error);
        const message = error instanceof Error ? error.message : '';
        const allowed = [
            'Unknown skin.', 'Unknown upgrade.', 'Unknown bundle.', 'Unknown purchase.',
            'This upgrade is already maxed.', 'All items in this bundle are already at maximum level or owned.',
            'Upgrade level changed. Refresh and try again.', 'Not enough scraps. Earn more by completing team battles.'
        ];
        res.status(409).json({ error: allowed.includes(message) ? message : (message || 'Purchase could not be completed. Refresh your inventory and try again.') });
    }
});
export default router;
