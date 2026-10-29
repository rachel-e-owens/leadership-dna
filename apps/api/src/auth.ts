import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { PrismaClient } from '@prisma/client';
import type { AuthedRequest } from './ownership.js';

export const asyncRoute = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  (req: AuthedRequest, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };
export const publicUser = { id: true, name: true, email: true, role: true } as const;
export function authentication(prisma: PrismaClient, secret: string, optional = false) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    void (async () => {
      if (!req.headers.authorization && optional) { next(); return; }
      const match = req.headers.authorization?.match(/^Bearer (.+)$/);
      if (!match) { res.status(401).json({ error: 'Authentication required' }); return; }
      let subject: string;
      try {
        const payload = jwt.verify(match[1], secret, { algorithms: ['HS256'] });
        if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new Error();
        subject = payload.sub;
      } catch { res.status(401).json({ error: 'Invalid or expired session' }); return; }
      const user = await prisma.user.findUnique({ where: { id: subject }, select: publicUser });
      if (!user) { res.status(401).json({ error: 'Invalid or expired session' }); return; }
      req.userId = user.id; req.user = user; next();
    })().catch(next);
  };
}
export function consultant(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.user?.role !== 'CONSULTANT') { res.status(404).json({ error: 'Not found' }); return; }
  next();
}
