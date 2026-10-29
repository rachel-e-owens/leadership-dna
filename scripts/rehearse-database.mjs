import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Only touches a newly created, randomly named disposable container. No source DB URL accepted.
const root = fileURLToPath(new URL('..', import.meta.url));
const name = `leadership-rehearsal-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const sql = (database, query) => docker('exec', name, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-Atc', query);
const run = (args, env) => execFileSync(process.execPath, args, { cwd: root, env: { ...process.env, ...env }, stdio: 'inherit' });
let created = false;
const baseline = mkdtempSync(join(tmpdir(), 'leadership-migration-'));
try {
  docker('run', '--detach', '--name', name, '--publish', '127.0.0.1::5432', '--tmpfs', '/var/lib/postgresql/data', '--env', `POSTGRES_PASSWORD=${password}`, '--env', 'POSTGRES_DB=source', 'postgres:16-alpine');
  created = true;
  for (let attempt = 0; ; attempt++) {
    try { docker('exec', name, 'pg_isready', '-U', 'postgres'); break; }
    catch { if (attempt >= 60) throw new Error('Disposable database did not start'); await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
  const port = docker('port', name, '5432/tcp').split(':').at(-1);
  const env = { NODE_ENV: 'test', DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/source?schema=public` };
  const prisma = ['node_modules/prisma/build/index.js'];
  // Exercise a real upgrade: preserve pre-Phase-1 users/reports/notes/deliveries.
  cpSync(join(root, 'apps/api/prisma/schema.prisma'), join(baseline, 'schema.prisma'));
  mkdirSync(join(baseline, 'migrations'));
  cpSync(join(root, 'apps/api/prisma/migrations/migration_lock.toml'), join(baseline, 'migrations/migration_lock.toml'));
  for (const migration of ['20260831000909_init', '20260905000000_remove_groups', '20260907000000_continuous_report']) {
    cpSync(join(root, 'apps/api/prisma/migrations', migration), join(baseline, 'migrations', migration), { recursive: true });
  }
  run([...prisma, 'migrate', 'deploy', '--schema', join(baseline, 'schema.prisma')], env);
  sql('source', `INSERT INTO "User" (id, email, name, "passwordHash") VALUES ('preexisting-owner', 'PreExisting@company.test', 'Existing consultant', 'synthetic-only');
    INSERT INTO "Report" (id, "ownerId", title, document, "updatedAt") VALUES ('preexisting-report', 'preexisting-owner', 'Existing report', '{"type":"doc","content":[]}', now());
    INSERT INTO "ContentBlock" (id, "ownerId", title, category, content, "updatedAt") VALUES ('preexisting-library', 'preexisting-owner', 'Existing library', 'Profile', '{}', now());
    INSERT INTO "ReportBlock" (id, "reportId", "contentBlockId", title, content, notes, position) VALUES ('preexisting-block', 'preexisting-report', 'preexisting-library', 'Existing block', '{}', 'Existing private note', 0);
    INSERT INTO "ReportDelivery" (id, "reportId", recipients) VALUES ('preexisting-delivery', 'preexisting-report', '[]');`);
  const preservedTables = ['User', 'ContentBlock', 'Report', 'ReportBlock', 'ReportDelivery'];
  const snapshot = table => sql('source', `SELECT coalesce(jsonb_agg(to_jsonb(t) - 'role' ORDER BY id), '[]') FROM "${table}" t`);
  const beforeUpgrade = preservedTables.map(snapshot);
  run([...prisma, 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], env);
  if (JSON.stringify(beforeUpgrade) !== JSON.stringify(preservedTables.map(snapshot))) throw new Error('Phase 1 migration changed existing data');
  if (sql('source', `SELECT role FROM "User" WHERE id = 'preexisting-owner'`) !== 'CONSULTANT') throw new Error('Existing consultant was not preserved');
  console.log('PASS: additive Phase 1 upgrade preserves all existing records and consultant access.');
  run(['--import', 'tsx', 'apps/api/prisma/seed.ts'], env);
  sql('source', `INSERT INTO "Report" (id, "ownerId", title, document, "updatedAt") SELECT 'rehearsal-report', id, 'Restore rehearsal', '{"type":"doc","content":[]}', now() FROM "User" LIMIT 1;
    INSERT INTO "ReportBlock" (id, "reportId", title, content, notes, position) VALUES ('rehearsal-block', 'rehearsal-report', 'Private', '{}', 'Private rehearsal note', 0);
    INSERT INTO "ReportDelivery" (id, "reportId", recipients) VALUES ('rehearsal-delivery', 'rehearsal-report', '[]');`);
  sql('source', `INSERT INTO "Group" (id, "consultantId", name) VALUES ('rehearsal-group', 'preexisting-owner', 'Rehearsal group');
    INSERT INTO "GroupMember" (id, "groupId", email, "displayName") VALUES ('rehearsal-member', 'rehearsal-group', 'synthetic@company.test', 'Synthetic member');
    INSERT INTO "InviteToken" (id, "groupMemberId", "tokenHash", "expiresAt") VALUES ('rehearsal-invite', 'rehearsal-member', repeat('0', 64), now() + interval '7 days');`);
  docker('exec', name, 'pg_dump', '-U', 'postgres', '-d', 'source', '--format=custom', '--no-owner', '--no-acl', '--file=/tmp/rehearsal.dump');
  sql('postgres', 'CREATE DATABASE restored');
  docker('exec', name, 'pg_restore', '-U', 'postgres', '-d', 'restored', '--exit-on-error', '--no-owner', '--no-acl', '/tmp/rehearsal.dump');
  const restoredEnv = { ...env, DATABASE_URL: env.DATABASE_URL.replace('/source?', '/restored?') };
  run([...prisma, 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'], restoredEnv);
  run([...prisma, 'migrate', 'status', '--schema', 'apps/api/prisma/schema.prisma'], restoredEnv);
  for (const table of ['User', 'ContentBlock', 'Report', 'ReportBlock', 'ReportDelivery', 'Group', 'GroupMember', 'InviteToken', '_prisma_migrations']) {
    const query = `SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id), '[]') FROM "${table}" t`;
    if (sql('source', query) !== sql('restored', query)) throw new Error(`Restore mismatch: ${table}`);
  }
  run(['--import', 'tsx', '--test', 'apps/api/src/report-persistence.test.ts', 'apps/api/src/groups.test.ts', 'apps/web/tests/groups.test.mjs'], { ...env, TEST_DATABASE_URL: restoredEnv.DATABASE_URL });
  console.log('PASS: migrations, backup/restore equality for all tables, and real API persistence/ownership tests.');
} finally {
  try { if (created) docker('rm', '--force', name); } finally { rmSync(baseline, { recursive: true, force: true }); }
}
