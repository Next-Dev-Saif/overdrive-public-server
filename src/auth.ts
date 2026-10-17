import { authRateLimit } from './authRateLimit';
import { serverConfig } from './config';
import { Router } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from './db';

const router = Router();
const JWT_SECRET = serverConfig.jwtSecret;

router.use(authRateLimit());

/** Bound untrusted input before database lookups and password hashing. */
function validCredentials(username: unknown, password: unknown): username is string {
    return typeof username === 'string' && username.length >= 3 && username.length <= 32
        && typeof password === 'string' && password.length >= 8 && Buffer.byteLength(password, 'utf8') <= 72;
}

router.post('/register', async (req, res) => {
    try {
        const { username, email, password } = req.body ?? {};
        
        if (!validCredentials(username, password) || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: "Invalid credentials: use a valid username, email and password." });
        }

        const existingUser = await prisma.user.findFirst({
            where: { OR: [{ email }, { username }] }
        });

        if (existingUser) {
            return res.status(409).json({ error: "Username or email already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        // Create User, Stats, and Wallet in one transaction
        const user = await prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                stats: { create: {} },
                wallet: { create: {} }
            },
            include: { stats: true, wallet: true }
        });

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email, stats: user.stats, wallet: user.wallet } });
    } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
            return res.status(409).json({ error: 'Username or email already exists' });
        }
        console.error("Register error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body ?? {};
        
        if (typeof username !== 'string' || !username || username.length > 32 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const user = await prisma.user.findUnique({
            where: { username },
            include: { stats: true, wallet: true }
        });

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });

        res.json({ token, user: { id: user.id, username: user.username, email: user.email, stats: user.stats, wallet: user.wallet } });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
