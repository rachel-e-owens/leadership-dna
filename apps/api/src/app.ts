import 'dotenv/config';
import bcrypt from 'bcryptjs';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { reportUpdateSchema } from './report-input.js';
import { authentication, asyncRoute, consultant } from './auth.js';
import { groupRoutes, emailSchema } from './groups.js';
import { ConsoleEmailProvider, ResendEmailProvider, type EmailProvider } from './email.js';
import { loadConfig } from './config.js';
import { ownerScope, ownedId } from './ownership.js';
import { requestLogger, restrictedCors, authRateLimit, errorHandler, log, type LogSink } from './http.js';

export function createApp(prisma: PrismaClient, config: ReturnType<typeof loadConfig>, email: EmailProvider = config.production ? new ResendEmailProvider(process.env.RESEND_API_KEY!, process.env.EMAIL_FROM!) : new ConsoleEmailProvider(), writeLog: LogSink = log) {
  const app = express();
  const secret = config.jwtSecret;
  app.disable('x-powered-by');
  app.use(requestLogger(writeLog));
  app.use(restrictedCors(config.appOrigin));
  app.use('/api/auth', authRateLimit());
  app.use(express.json({ limit: '2mb' }));

  const auth = authentication(prisma, secret);
  const sign = (id: string) => jwt.sign({ sub: id }, secret, { expiresIn: '7d' });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.post('/api/auth/register', asyncRoute(async (req, res) => {
    const input = z.object({ name: z.string().min(2), email: emailSchema, password: z.string().min(8).max(72) }).parse(req.body);
    const exists = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } } });
    if (exists) { res.status(409).json({ error: 'An account already exists for this email' }); return; }
    let user;
    try { user = await prisma.user.create({ data: { name: input.name, email: input.email, passwordHash: await bcrypt.hash(input.password, 12) } }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') { res.status(409).json({ error: 'An account already exists for this email' }); return; }
      throw error;
    }
    res.status(201).json({ token: sign(user.id), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }));
  app.post('/api/auth/login', asyncRoute(async (req, res) => {
    const input = z.object({ email: emailSchema, password: z.string().min(1) }).parse(req.body);
    const user = await prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' } } });
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) { res.status(401).json({ error: 'Incorrect email or password' }); return; }
    res.json({ token: sign(user.id), user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  }));

  app.get('/api/dashboard', auth, consultant, asyncRoute(async (req, res) => {
    const [reports, blocks] = await Promise.all([
      prisma.report.findMany({ where: ownerScope(req), include: { _count: { select: { blocks: true } } }, orderBy: { updatedAt: 'desc' } }),
      prisma.contentBlock.findMany({ where: ownerScope(req), orderBy: { updatedAt: 'desc' } })
    ]);
    res.json({ reports, blocks });
  }));
  app.post('/api/blocks', auth, consultant, asyncRoute(async (req, res) => {
    const input = z.object({ title: z.string().min(1), category: z.string().min(1), content: z.object({}).passthrough() }).parse(req.body);
    res.status(201).json(await prisma.contentBlock.create({ data: { ...input, ...ownerScope(req) } }));
  }));
  app.put('/api/blocks/:id', auth, consultant, asyncRoute(async (req, res) => {
    const input = z.object({ title: z.string().min(1), category: z.string().min(1), content: z.object({}).passthrough() }).parse(req.body);
    const block = await prisma.contentBlock.findFirst({ where: ownedId(req) });
    if (!block) { res.status(404).json({ error: 'Content block not found' }); return; }
    res.json(await prisma.contentBlock.update({ where: ownedId(req), data: input }));
  }));
  app.delete('/api/blocks/:id', auth, consultant, asyncRoute(async (req, res) => {
    const result = await prisma.contentBlock.deleteMany({ where: ownedId(req) });
    if (!result.count) { res.status(404).json({ error: 'Content block not found' }); return; }
    res.json({ deleted: true });
  }));
  app.post('/api/reports', auth, consultant, asyncRoute(async (req, res) => {
    const input = z.object({ title: z.string().min(1) }).parse(req.body);
    res.status(201).json(await prisma.report.create({ data: { ...input, ...ownerScope(req) } }));
  }));
  app.get('/api/reports/:id', auth, consultant, asyncRoute(async (req, res) => {
    const report = await prisma.report.findFirst({ where: ownedId(req), include: { blocks: { orderBy: { position: 'asc' } } } });
    if (!report) { res.status(404).json({ error: 'Report not found' }); return; } res.json(report);
  }));
  app.delete('/api/reports/:id', auth, consultant, asyncRoute(async (req, res) => {
    const result = await prisma.report.deleteMany({ where: ownedId(req) });
    if (!result.count) { res.status(404).json({ error: 'Report not found' }); return; }
    res.json({ deleted: true });
  }));
  app.put('/api/reports/:id', auth, consultant, asyncRoute(async (req, res) => {
    const input = reportUpdateSchema.parse(req.body);
    const found = await prisma.report.findFirst({ where: ownedId(req) });
    if (!found) { res.status(404).json({ error: 'Report not found' }); return; }
    // A legacy client must not silently replace a saved continuous document.
    if (found.document && !input.document) { res.status(409).json({ error: 'Reload this report to use the continuous editor.' }); return; }
    if (!input.document && input.blocks) {
      const ids = [...new Set(input.blocks.flatMap(block => block.contentBlockId ? [block.contentBlockId] : []))];
      const count = await prisma.contentBlock.count({ where: { id: { in: ids }, ...ownerScope(req) } });
      if (count !== ids.length) { res.status(404).json({ error: 'Content block not found' }); return; }
    }
    const report = await prisma.$transaction(async tx => {
      if (!input.document && input.blocks) await tx.reportBlock.deleteMany({ where: { reportId: found.id } });
      for (const note of input.blockNotes || []) {
        await tx.reportBlock.updateMany({ where: { id: note.id, reportId: found.id }, data: { notes: note.notes } });
      }
      return tx.report.update({ where: ownedId(req), data: {
        title: input.title, intro: input.intro === null ? Prisma.JsonNull : input.intro, status: input.status,
        document: input.document as Prisma.InputJsonValue | undefined,
        documentStyle: input.documentStyle,
        ...(!input.document && input.blocks ? { blocks: { create: input.blocks.map(({ id: _id, ...block }, position) => ({ ...block, position })) } } : {}),
      }, include: { blocks: { orderBy: { position: 'asc' } } } });
    }); res.json(report);
  }));
  groupRoutes(app, prisma, secret, config.appOrigin, email, sign);
  app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
  app.use(errorHandler(writeLog));
  return app;
}
