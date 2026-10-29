import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Express } from 'express';
import { z } from 'zod';
import { authentication, asyncRoute, consultant, publicUser } from './auth.js';
import { activeMemberScope, HttpError, requireConsultantGroup, type AuthedRequest } from './ownership.js';
import { authRateLimit } from './http.js';
import type { EmailProvider } from './email.js';

export const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const memberInput = z.object({ displayName: z.string().trim().min(1).max(200), email: emailSchema });
const groupInput = z.object({ name: z.string().trim().min(1).max(200), clientName: z.string().trim().max(200).nullable().optional() });
const invalidInvite = () => new HttpError(404, 'Invitation unavailable. Ask your consultant for a new invitation.');
const tokenSelect = { id: true, expiresAt: true, usedAt: true, revokedAt: true, createdAt: true } as const;
// Retry serialization conflicts so accept/resend/revoke/archive cannot race past each other.
async function serial<T>(db: PrismaClient, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await db.$transaction(fn, { isolationLevel: 'Serializable' }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 3) continue;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, 'This account or member already exists. Sign in or refresh and try again.');
      throw error;
    }
  }
}
function validInvitation(raw: string) {
  if (!/^[a-f0-9]{64}$/.test(raw)) throw invalidInvite();
  return { tokenHash: hashToken(raw), usedAt: null, revokedAt: null, expiresAt: { gt: new Date() },
    groupMember: { status: 'INVITED' as const, group: { status: 'ACTIVE' as const } } };
}
export function groupRoutes(app: Express, prisma: PrismaClient, secret: string, origin: string, email: EmailProvider, sign: (id: string) => string) {
  const auth = authentication(prisma, secret);
  const guard = [auth, consultant];
  const revoke = (tx: Prisma.TransactionClient, memberId: string) => tx.inviteToken.updateMany({
    where: { groupMemberId: memberId, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() },
  });
  async function issue(tx: Prisma.TransactionClient, memberId: string) {
    await revoke(tx, memberId);
    const raw = randomBytes(32).toString('hex');
    const invitation = await tx.inviteToken.create({ data: { groupMemberId: memberId, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 7 * 86400_000) }, select: tokenSelect });
    await tx.groupMember.update({ where: { id: memberId }, data: { invitedAt: new Date() } });
    return { raw, invitation };
  }
  async function deliver(result: { raw: string; invitation: { id: string }; to: string; groupName: string }) {
    try {
      await email.sendInvitation({ to: result.to, groupName: result.groupName, url: `${origin}/#invite=${result.raw}` });
    } catch {
      // A failed or ambiguous delivery must not leave a usable, untracked invitation.
      await prisma.inviteToken.updateMany({ where: { id: result.invitation.id, usedAt: null }, data: { revokedAt: new Date() } });
      throw new HttpError(502, 'Invitation could not be delivered. The member was saved; use Resend invitation to try again.');
    }
  }
  app.get('/api/me', auth, asyncRoute(async (req, res) => { res.json({ user: req.user }); }));
  app.get('/api/me/dashboard', auth, asyncRoute(async (req, res) => {
    // Only own active memberships are loaded; never expose a roster or peer status.
    const memberships = await prisma.groupMember.findMany({ where: activeMemberScope(req), select: { id: true } });
    res.json({ forms: [], reports: [], activeMembershipCount: memberships.length });
  }));
  app.get('/api/groups', ...guard, asyncRoute(async (req, res) => {
    res.json(await prisma.group.findMany({ where: { consultantId: req.userId! }, orderBy: { createdAt: 'desc' } }));
  }));
  app.post('/api/groups', ...guard, asyncRoute(async (req, res) => {
    res.status(201).json(await prisma.group.create({ data: { ...groupInput.parse(req.body), consultantId: req.userId! } }));
  }));
  app.get('/api/groups/:groupId', ...guard, asyncRoute(async (req, res) => {
    const group = await requireConsultantGroup(prisma, req);
    const members = await prisma.groupMember.findMany({ where: { groupId: group.id, group: { consultantId: req.userId! } }, orderBy: { invitedAt: 'asc' },
      select: { id: true, email: true, displayName: true, role: true, status: true, invitedAt: true, joinedAt: true, removedAt: true,
        invitations: { orderBy: { createdAt: 'desc' }, take: 1, select: tokenSelect } } });
    res.json({ ...group, members: members.map(({ invitations, ...member }) => {
      const invite = invitations[0];
      const invitationStatus = !invite ? 'NONE' : invite.usedAt ? 'ACCEPTED' : invite.revokedAt ? 'REVOKED' : invite.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING';
      return { ...member, invitationStatus, invitationExpiresAt: invite?.expiresAt ?? null };
    }) });
  }));
  app.patch('/api/groups/:groupId', ...guard, asyncRoute(async (req, res) => {
    const input = groupInput.partial().extend({ status: z.enum(['ACTIVE', 'ARCHIVED']).optional() }).parse(req.body);
    const group = await serial(prisma, async tx => {
      const group = await requireConsultantGroup(tx, req);
      if (input.status === 'ARCHIVED') await tx.inviteToken.updateMany({ where: { groupMember: { groupId: group.id }, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      return tx.group.update({ where: { id: group.id, consultantId: req.userId! }, data: { ...input,
        ...(input.status ? { archivedAt: input.status === 'ARCHIVED' ? new Date() : null } : {}) } });
    });
    res.json(group);
  }));
  app.post('/api/groups/:groupId/members', ...guard, asyncRoute(async (req, res) => {
    const input = memberInput.parse(req.body);
    const result = await serial(prisma, async tx => {
      const group = await requireConsultantGroup(tx, req, true);
      const existing = await tx.groupMember.findUnique({ where: { groupId_email: { groupId: group.id, email: input.email } } });
      if (existing && existing.status !== 'REMOVED') throw new HttpError(409, 'This member is already in the group. Use Resend invitation.');
      const member = existing ? await tx.groupMember.update({ where: { id: existing.id }, data: { displayName: input.displayName, status: 'INVITED', removedAt: null, joinedAt: null } })
        : await tx.groupMember.create({ data: { ...input, groupId: group.id } });
      return { member, ...await issue(tx, member.id), to: member.email, groupName: group.name };
    });
    await deliver(result);
    res.status(201).json({ member: result.member, invitation: result.invitation });
  }));
  async function scopedMember(tx: Prisma.TransactionClient, req: AuthedRequest) {
    const group = await requireConsultantGroup(tx, req, true);
    const member = await tx.groupMember.findFirst({ where: { id: String(req.params.memberId), groupId: group.id, group: { consultantId: req.userId! }, status: { not: 'REMOVED' } } });
    if (!member) throw new HttpError(404, 'Member not found');
    return { group, member };
  }
  app.post('/api/groups/:groupId/members/:memberId/invitations', ...guard, asyncRoute(async (req, res) => {
    const result = await serial(prisma, async tx => {
      const { group, member } = await scopedMember(tx, req);
      if (member.status === 'ACTIVE') throw new HttpError(409, 'This member has already joined.');
      return { ...await issue(tx, member.id), to: member.email, groupName: group.name };
    });
    await deliver(result); res.status(201).json({ invitation: result.invitation });
  }));
  app.delete('/api/groups/:groupId/members/:memberId/invitations', ...guard, asyncRoute(async (req, res) => {
    await serial(prisma, async tx => { const { member } = await scopedMember(tx, req); await revoke(tx, member.id); });
    res.json({ revoked: true });
  }));
  app.delete('/api/groups/:groupId/members/:memberId', ...guard, asyncRoute(async (req, res) => {
    await serial(prisma, async tx => {
      const { member } = await scopedMember(tx, req);
      await revoke(tx, member.id);
      await tx.groupMember.update({ where: { id: member.id }, data: { status: 'REMOVED', removedAt: new Date() } });
    });
    res.json({ removed: true });
  }));
  app.use('/api/invitations', authRateLimit());
  app.post('/api/invitations/inspect', authentication(prisma, secret, true), asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const invitation = await prisma.inviteToken.findFirst({ where: validInvitation(String(req.body?.token)), include: { groupMember: { include: { group: true } } } });
    if (!invitation || (req.user && req.user.email.toLowerCase() !== invitation.groupMember.email)) throw invalidInvite();
    const account = await prisma.user.findFirst({ where: { email: { equals: invitation.groupMember.email, mode: 'insensitive' } }, select: { id: true } });
    res.json({ groupName: invitation.groupMember.group.name, displayName: invitation.groupMember.displayName, requiresSignIn: !!account });
  }));
  app.post('/api/invitations/accept', authentication(prisma, secret, true), asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const input = z.object({ password: z.string().min(8).max(72).optional() }).parse(req.body);
    // Hash outside the transaction so expensive bcrypt doesn't hold DB locks.
    const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : undefined;
    const user = await serial(prisma, async tx => {
      const where = validInvitation(String(req.body?.token));
      const invitation = await tx.inviteToken.findFirst({ where, include: { groupMember: true } });
      if (!invitation) throw invalidInvite();
      const member = invitation.groupMember;
      let account = await tx.user.findFirst({ where: { email: { equals: member.email, mode: 'insensitive' } } });
      if (req.user && req.user.email.toLowerCase() !== member.email) throw invalidInvite();
      if (account && req.userId !== account.id) throw new HttpError(401, 'Sign in with the invited email to join this group.');
      if (!account) {
        if (!passwordHash) throw new HttpError(400, 'Set a password of at least 8 characters.');
        account = await tx.user.create({ data: { email: member.email, name: member.displayName, passwordHash, role: 'MEMBER' } });
      }
      const claimed = await tx.inviteToken.updateMany({ where: { id: invitation.id, ...where }, data: { usedAt: new Date() } });
      if (claimed.count !== 1) throw invalidInvite();
      await tx.groupMember.update({ where: { id: member.id }, data: { userId: account.id, status: 'ACTIVE', joinedAt: new Date() } });
      await revoke(tx, member.id);
      return tx.user.findUniqueOrThrow({ where: { id: account.id }, select: publicUser });
    });
    res.json({ token: sign(user.id), user });
  }));
}
