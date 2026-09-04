import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const prisma = new PrismaClient();
const paragraph = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
async function main() {
  // Seed only a new demo account so deleted starter blocks stay deleted on restart.
  if (await prisma.user.findUnique({ where: { email: 'demo@leadershipdna.com' } })) return;
  const passwordHash = await bcrypt.hash('welcome123', 12);
  const user = await prisma.user.upsert({ where: { email: 'demo@leadershipdna.com' }, update: {}, create: { email: 'demo@leadershipdna.com', name: 'Demo Consultant', passwordHash } });
  const blocks = [
    { ownerId: user.id, title: 'Leadership Snapshot', category: 'Profile', content: paragraph('This section captures the individual’s natural leadership style and how it shows up in their work.') },
    { ownerId: user.id, title: 'Growth Opportunities', category: 'Development', content: paragraph('Focus on the few practices that will create the most meaningful growth over the next 90 days.') },
    { ownerId: user.id, title: 'Team Discussion Guide', category: 'Team', content: paragraph('Use these prompts to create an honest conversation about strengths, friction points, and shared commitments.') }
  ];
  for (const block of blocks) {
    const exists = await prisma.contentBlock.findFirst({ where: { ownerId: user.id, title: block.title } });
    if (!exists) await prisma.contentBlock.create({ data: block });
  }
}
main().finally(() => prisma.$disconnect());
