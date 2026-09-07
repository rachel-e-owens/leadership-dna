import 'dotenv/config';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { renderPdf } from './pdf.js';
import { reportDraftSchema, reportUpdateSchema } from './report-input.js';

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
  const [reports, blocks] = await Promise.all([
    prisma.report.findMany({ where: { ownerId: req.userId }, include: { _count: { select: { blocks: true } } }, orderBy: { updatedAt: 'desc' } }),
    prisma.contentBlock.findMany({ where: { ownerId: req.userId }, orderBy: { updatedAt: 'desc' } })
  ]);
  res.json({ reports, blocks });
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
app.delete('/api/blocks/:id', auth, asyncRoute(async (req, res) => {
  const result = await prisma.contentBlock.deleteMany({ where: { id: String(req.params.id), ownerId: req.userId! } });
  if (!result.count) { res.status(404).json({ error: 'Content block not found' }); return; }
  res.json({ deleted: true });
}));
app.post('/api/reports', auth, asyncRoute(async (req, res) => {
  const input = z.object({ title: z.string().min(1) }).parse(req.body);
  res.status(201).json(await prisma.report.create({ data: { ...input, ownerId: req.userId! } }));
}));
app.get('/api/reports/:id', auth, asyncRoute(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: String(req.params.id), ownerId: req.userId }, include: { blocks: { orderBy: { position: 'asc' } } } });
  if (!report) { res.status(404).json({ error: 'Report not found' }); return; } res.json(report);
}));
app.delete('/api/reports/:id', auth, asyncRoute(async (req, res) => {
  const result = await prisma.report.deleteMany({ where: { id: String(req.params.id), ownerId: req.userId! } });
  if (!result.count) { res.status(404).json({ error: 'Report not found' }); return; }
  res.json({ deleted: true });
}));
let activePdfExports = 0;
app.post('/api/reports/:id/pdf', auth, asyncRoute(async (req, res) => {
  const report = await prisma.report.findFirst({ where: { id: String(req.params.id), ownerId: req.userId }, include: { blocks: { orderBy: { position: 'asc' } } } });
  if (!report) { res.status(404).json({ error: 'Report not found' }); return; }
  const draft = reportDraftSchema.optional().parse(req.body?.draft);
  if (activePdfExports >= 2) { res.status(503).json({ error: 'PDF export is busy. Please try again shortly.' }); return; }
  activePdfExports++;
  try {
    const pdf = await renderPdf({ ...report, ...draft });
    const filename = ((draft?.title || report.title).replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100) || 'report') + '.pdf';
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }).send(pdf);
  } finally { activePdfExports--; }
}));
app.put('/api/reports/:id', auth, asyncRoute(async (req, res) => {
  const input = reportUpdateSchema.parse(req.body);
  const found = await prisma.report.findFirst({ where: { id: String(req.params.id), ownerId: req.userId } });
  if (!found) { res.status(404).json({ error: 'Report not found' }); return; }
  // A legacy client must not silently replace a saved continuous document.
  if (found.document && !input.document) { res.status(409).json({ error: 'Reload this report to use the continuous editor.' }); return; }
  const report = await prisma.$transaction(async tx => {
    if (!input.document && input.blocks) await tx.reportBlock.deleteMany({ where: { reportId: found.id } });
    for (const note of input.blockNotes || []) {
      await tx.reportBlock.updateMany({ where: { id: note.id, reportId: found.id }, data: { notes: note.notes } });
    }
    return tx.report.update({ where: { id: found.id }, data: {
      title: input.title, intro: input.intro === null ? Prisma.JsonNull : input.intro, status: input.status,
      document: input.document as Prisma.InputJsonValue | undefined,
      documentStyle: input.documentStyle,
      ...(!input.document && input.blocks ? { blocks: { create: input.blocks.map(({ id: _id, ...block }, position) => ({ ...block, position })) } } : {}),
    }, include: { blocks: { orderBy: { position: 'asc' } } } });
  }); res.json(report);
}));
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', issues: err.issues });
  console.error(err); res.status(500).json({ error: 'Unexpected server error' });
});
const server = app.listen(port, () => {
  const address = server.address();
  console.log(`Leadership DNA API listening on http://localhost:${typeof address === 'object' && address ? address.port : port}`);
});
