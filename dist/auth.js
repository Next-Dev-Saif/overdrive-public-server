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
const express_1 = require("express");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("./db");
const router = (0, express_1.Router)();
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-overdrive-key';
// Middleware to parse JSON
router.use(require('express').json());
router.post('/register', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, email, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ error: "Missing required fields" });
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
        console.error("Register error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
}));
router.post('/login', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { username, password } = req.body;
        if (!username || !password) {
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
