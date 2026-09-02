import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient, ReportStatus } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();
const app = express();
const port = Number(process.env.PORT || 4000);
const secret = process.env.JWT_SECRET || 'development-only-secret';
app.use(cors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

type AuthedRequest = Request & { userId?: string };
const asyncRoute = (fn: (req: AuthedRequest, res: Response) => Promise<void>) => (req: AuthedRequest, res: Response, next: NextFunction) => fn(req, res).catch(next);
function auth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try { req.userId = (jwt.verify(token, secret) as { sub: string }).sub; next(); }
  catch { res.status(401).json({ error: 'Invalid or expired session' }); }
}
const sign = (id: string) => jwt.sign({ sub: id }, secret, { expiresIn: '7d' });

app.get('/health', (_req, res) => res.json({ ok: true }));
app.post('/api/auth/register', asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().min(2), email: z.string().email(), password: z.string().min(8) }).parse(req.body);
  const exists = await prisma.user.findUnique({ where: { email: input.email } });
  if (exists) { res.status(409).json({ error: 'An account already exists for this email' }); return; }
  const user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) } });
  res.status(201).json({ token: sign(user.id), user: { id: user.id, name: user.name, email: user.email } });
}));
app.post('/api/auth/login', asyncRoute(async (req, res) => {
  const input = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) { res.status(401).json({ error: 'Incorrect email or password' }); return; }
  res.json({ token: sign(user.id), user: { id: user.id, name: user.name, email: user.email } });
}));

app.get('/api/dashboard', auth, asyncRoute(async (req, res) => {
  const [reports, groups, blocks] = await Promise.all([
    prisma.report.findMany({ where: { ownerId: req.userId }, include: { group: true, _count: { select: { blocks: true } } }, orderBy: { updatedAt: 'desc' } }),
    prisma.group.findMany({ where: { ownerId: req.userId }, include: { _count: { select: { members: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.contentBlock.findMany({ where: { ownerId: req.userId }, orderBy: { updatedAt: 'desc' } })
  ]);
  res.json({ reports, groups, blocks });
}));
app.post('/api/groups', auth, asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().min(1), members: z.array(z.object({ name: z.string().min(1), email: z.string().email() })).default([]) }).parse(req.body);
  const group = await prisma.group.create({ data: { name: input.name, ownerId: req.userId!, members: { create: input.members } }, include: { members: true } });
  res.status(201).json(group);
}));
app.get('/api/groups/:id', auth, asyncRoute(async (req, res) => {
  const group = await prisma.group.findFirst({ where: { id: String(req.params.id), ownerId: req.userId }, include: { members: { orderBy: { name: 'asc' } }, reports: { orderBy: { updatedAt: 'desc' } } } });
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json(group);
}));
app.put('/api/groups/:id', auth, asyncRoute(async (req, res) => {
  const input = z.object({ name: z.string().min(1), members: z.array(z.object({ name: z.string().min(1), email: z.string().email() })).min(1) }).parse(req.body);
  const group = await prisma.group.findFirst({ where: { id: String(req.params.id), ownerId: req.userId } });
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
  res.json(await prisma.$transaction(async tx => { await tx.groupMember.deleteMany({ where: { groupId: group.id } }); return tx.group.update({ where: { id: group.id }, data: { name: input.name, members: { create: input.members } }, include: { members: true } }); }));
}));
app.post('/api/blocks', auth, asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().min(1), category: z.string().min(1), content: z.object({}).passthrough() }).parse(req.body);
  res.status(201).json(await prisma.contentBlock.create({ data: { ...input, ownerId: req.userId! } }));
}));
app.put('/api/blocks/:id', auth, asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().min(1), category: z.string().min(1), content: z.object({}).passthrough() }).parse(req.body);
  const block = await prisma.contentBlock.findFirst({ where: { id: String(req.params.id), ownerId: req.userId } });
  if (!block) { res.status(404).json({ error: 'Content block not found' }); return; }
  res.json(await prisma.contentBlock.update({ where: { id: block.id }, data: input }));
}));
app.post('/api/reports', auth, asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().min(1), groupId: z.string().optional() }).parse(req.body);
  if (input.groupId && !await prisma.group.findFirst({ where: { id: input.groupId, ownerId: req.userId } })) { res.status(404).json({ error: 'Group not found' }); return; }
  res.status(201).json(await prisma.report.create({ data: { ...input, ownerId: req.userId! } }));
}));
app.get('/api/reports/:id', auth, asyncRoute(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: String(req.params.id), ownerId: req.userId }, include: { group: { include: { members: true } }, blocks: { orderBy: { position: 'asc' } } } });
  if (!report) { res.status(404).json({ error: 'Report not found' }); return; } res.json(report);
}));
app.put('/api/reports/:id', auth, asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().min(1), intro: z.object({}).passthrough().nullable().optional(), status: z.nativeEnum(ReportStatus).optional(), blocks: z.array(z.object({ id: z.string().optional(), contentBlockId: z.string().nullable().optional(), title: z.string().min(1), content: z.object({}).passthrough(), notes: z.string().nullable().optional() })) }).parse(req.body);
  const found = await prisma.report.findFirst({ where: { id: String(req.params.id), ownerId: req.userId } });
  if (!found) { res.status(404).json({ error: 'Report not found' }); return; }
  const report = await prisma.$transaction(async tx => {
    await tx.reportBlock.deleteMany({ where: { reportId: found.id } });
    return tx.report.update({ where: { id: found.id }, data: { title: input.title, intro: input.intro === null ? Prisma.JsonNull : input.intro, status: input.status, blocks: { create: input.blocks.map(({ id: _id, ...block }, position) => ({ ...block, position })) }, }, include: { blocks: { orderBy: { position: 'asc' } } } });
  }); res.json(report);
}));
app.post('/api/reports/:id/send', auth, asyncRoute(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: String(req.params.id), ownerId: req.userId }, include: { group: { include: { members: true } } } });
  if (!report?.group) { res.status(400).json({ error: 'Attach a group before sending a report' }); return; }
  const recipients = report.group.members.map(({ name, email }) => ({ name, email }));
  if (!recipients.length) { res.status(400).json({ error: 'This group has no recipients' }); return; }
  // Replace this record-only implementation with Resend, Postmark, or SES in production.
  const delivery = await prisma.reportDelivery.create({ data: { reportId: report.id, recipients, status: 'QUEUED' } });
  await prisma.report.update({ where: { id: report.id }, data: { status: 'SENT' } });
  res.status(202).json({ delivery, message: `Queued for ${recipients.length} recipient(s)` });
}));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', issues: err.issues });
  console.error(err); res.status(500).json({ error: 'Unexpected server error' });
});
app.listen(port, () => console.log(`Leadership DNA API listening on http://localhost:${port}`));
