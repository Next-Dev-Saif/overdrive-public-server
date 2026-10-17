/** Create a portable backend release with compiled shared rules, never secrets or local databases. */
import { cp, copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const releases = resolve(root, '../release');
await mkdir(releases, { recursive: true });
const target = await mkdtemp(resolve(releases, 'server-'));
await cp(resolve(root, 'dist'), resolve(target, 'dist'), { recursive: true });
await mkdir(resolve(target, 'prisma'), { recursive: true });
for (const name of ['schema.prisma', 'migrations']) await cp(resolve(root, 'prisma', name), resolve(target, 'prisma', name), { recursive: true });
for (const name of ['package-lock.json', '.env.example', '.env.production.example']) await copyFile(resolve(root, name), resolve(target, name));
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
manifest.scripts = { start: manifest.scripts.start, build: 'prisma generate', postinstall: 'prisma generate', 'db:deploy': 'prisma migrate deploy' };
await writeFile(resolve(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
await writeFile(resolve(target, 'README.md'), '# Standalone backend release\n\nUse Node 24. Set environment variables from `.env.production.example` in your host, or copy that file to `.env` and replace the placeholders.\n\nInstall: `npm ci --include=dev`\n\nBuild: `npm run build` (generates Prisma for the host OS; game code is already compiled)\n\nRelease: `npm run db:deploy`\n\nStart: `npm start`\n\nRequires one persistent Node process, WebSockets, HTTPS termination and a writable persistent disk at the DATABASE_URL path. Health endpoint: /readyz. Do not run multiple replicas: match state is held in memory.\n');
console.log(`Standalone backend release: ${target}`);
