-- Additive: existing accounts retain their consultant workspaces and all report data.
CREATE TYPE "UserRole" AS ENUM ('CONSULTANT', 'MEMBER');
CREATE TYPE "GroupStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "MemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'REMOVED');
CREATE TYPE "MemberRole" AS ENUM ('MEMBER');
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'CONSULTANT';
CREATE TABLE "Group" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "consultantId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL, "clientName" TEXT,
  "status" "GroupStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "archivedAt" TIMESTAMP(3)
);
CREATE TABLE "GroupMember" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "groupId" TEXT NOT NULL REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "email" TEXT NOT NULL, "displayName" TEXT NOT NULL,
  "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
  "status" "MemberStatus" NOT NULL DEFAULT 'INVITED',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "joinedAt" TIMESTAMP(3), "removedAt" TIMESTAMP(3)
);
CREATE TABLE "InviteToken" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "groupMemberId" TEXT NOT NULL REFERENCES "GroupMember"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Group_consultantId_status_idx" ON "Group"("consultantId", "status");
CREATE UNIQUE INDEX "GroupMember_groupId_email_key" ON "GroupMember"("groupId", "email");
CREATE INDEX "GroupMember_userId_status_idx" ON "GroupMember"("userId", "status");
CREATE UNIQUE INDEX "InviteToken_tokenHash_key" ON "InviteToken"("tokenHash");
CREATE INDEX "InviteToken_groupMemberId_idx" ON "InviteToken"("groupMemberId");
-- Preserve email spelling and existing IDs; prevent case-variant duplicate accounts.
-- Existing case-collisions must be resolved by an operator before this index can apply.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (lower("email"));
