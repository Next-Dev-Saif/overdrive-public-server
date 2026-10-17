"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const authRateLimit_1 = require("./authRateLimit");
const config_1 = require("./config");
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("./db");
const router = (0, express_1.Router)();
const JWT_SECRET = config_1.serverConfig.jwtSecret;
router.use((0, authRateLimit_1.authRateLimit)());
/** Bound untrusted input before database lookups and password hashing. */
function validCredentials(username, password) {
    return typeof username === 'string' && username.length >= 3 && username.length <= 32
        && typeof password === 'string' && password.length >= 8 && Buffer.byteLength(password, 'utf8') <= 72;
}
router.post('/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { username, email, password } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
        if (!validCredentials(username, password) || typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: "Invalid credentials: use a valid username, email and password." });
        }
        const existingUser = yield db_1.prisma.user.findFirst({
            where: { OR: [{ email }, { username }] }
        });
        if (existingUser) {
            return res.status(409).json({ error: "Username or email already exists" });
        }
        const passwordHash = yield bcrypt_1.default.hash(password, 10);
        // Create User, Stats, and Wallet in one transaction
        const user = yield db_1.prisma.user.create({
            data: {
                username,
                email,
                passwordHash,
                stats: { create: {} },
                wallet: { create: {} }
            },
            include: { stats: true, wallet: true }
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email, stats: user.stats, wallet: user.wallet } });
    }
    catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
            return res.status(409).json({ error: 'Username or email already exists' });
        }
        console.error("Register error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
router.post('/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    try {
        const { username, password } = (_a = req.body) !== null && _a !== void 0 ? _a : {};
        if (typeof username !== 'string' || !username || username.length > 32 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        const user = yield db_1.prisma.user.findUnique({
            where: { username },
            include: { stats: true, wallet: true }
        });
        if (!user || !(yield bcrypt_1.default.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }
        // Update last login
        yield db_1.prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });
        const token = jsonwebtoken_1.default.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ token, user: { id: user.id, username: user.username, email: user.email, stats: user.stats, wallet: user.wallet } });
    }
    catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
exports.default = router;
