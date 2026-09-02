import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
async function main() {
  const passwordHash = await bcrypt.hash('welcome123', 12);
  const user = await prisma.user.upsert({ where: { email: 'demo@leadershipdna.com' }, update: {}, create: { email: 'demo@leadershipdna.com', name: 'Demo Consultant', passwordHash } });
  await prisma.contentBlock.createMany({ data: [
    { ownerId: user.id, title: 'Leadership Snapshot', category: 'Profile', content: paragraph('This section captures the individual’s natural leadership style and how it shows up in their work.') },
    { ownerId: user.id, title: 'Growth Opportunities', category: 'Development', content: paragraph('Focus on the few practices that will create the most meaningful growth over the next 90 days.') },
    { ownerId: user.id, title: 'Team Discussion Guide', category: 'Team', content: paragraph('Use these prompts to create an honest conversation about strengths, friction points, and shared commitments.') }
  ], skipDuplicates: true });
}
main().finally(() => prisma.$disconnect());
