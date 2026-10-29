import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import type { InvitationEmail } from '../src/email.js';

export async function apiFixture(origin = 'http://localhost:5173') {
  const schema = `phase1_${randomUUID().replaceAll('-', '')}`;
  const url = new URL(process.env.TEST_DATABASE_URL!); url.searchParams.set('schema', schema);
  const prisma = new PrismaClient({ datasourceUrl: url.toString() });
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const config = loadConfig({ NODE_ENV: 'test', DATABASE_URL: url.toString(), JWT_SECRET: 'isolated-phase-one-tests', APP_ORIGIN: origin, PORT: '0' });
  const messages: InvitationEmail[] = [], logs: Record<string, unknown>[] = [];
  let failEmail = false;
  const app = createApp(prisma, config, { async sendInvitation(message) { if (failEmail) throw new Error('provider error with private credentials'); messages.push(message); } }, event => logs.push(event));
  try {
    await promisify(execFile)(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], { cwd: root, env: { ...process.env, DATABASE_URL: url.toString() } });
  } catch (error) { await prisma.$disconnect(); throw error; }
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  async function call(path: string, method = 'GET', body?: unknown, token?: string) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }
  return { prisma, base, call, messages, logs, failEmail: (value: boolean) => { failEmail = value; },
    raw: (index = messages.length - 1) => new URL(messages[index].url).hash.split('=')[1],
    async close() {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await prisma.$disconnect();
    },
  };
}
