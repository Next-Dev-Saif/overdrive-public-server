"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
require("./config");
const client_1 = require("@prisma/client");
exports.prisma = new client_1.PrismaClient();
