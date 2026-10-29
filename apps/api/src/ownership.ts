import type { Request } from 'express';
import type { Prisma, UserRole } from '@prisma/client';

export type AuthedRequest = Request & { userId?: string; user?: { id: string; email: string; name: string; role: UserRole } };
// Fail closed: undefined must never reach Prisma, where it would omit the filter.
export function ownerScope(req: AuthedRequest): { ownerId: string } {
  if (!req.userId) throw new Error('Authenticated owner required');
  return { ownerId: req.userId };
}
export function ownedId(req: AuthedRequest) {
  return { id: String(req.params.id), ...ownerScope(req) };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requireConsultantGroup(db: Prisma.TransactionClient, req: AuthedRequest, activeOnly = false) {
  if (!req.userId || req.user?.role !== 'CONSULTANT') throw new HttpError(404, 'Group not found');
  const group = await db.group.findFirst({ where: {
    id: String(req.params.groupId), consultantId: req.userId,
    ...(activeOnly ? { status: 'ACTIVE' as const } : {}),
  } });
  if (!group) throw new HttpError(404, 'Group not found');
  return group;
}
export function activeMemberScope(req: AuthedRequest): Prisma.GroupMemberWhereInput {
  if (!req.userId) throw new HttpError(401, 'Authentication required');
  return { userId: req.userId, status: 'ACTIVE', group: { status: 'ACTIVE' } };
}
