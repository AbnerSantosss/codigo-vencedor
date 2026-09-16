import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const ligar = process.argv[2] === 'on';
const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } });
const checkout = { ...((cfg?.checkout as Record<string, unknown>) ?? {}) };
checkout.simulatedPaymentEnabled = ligar;
await prisma.siteConfig.update({ where: { id: 1 }, data: { checkout } });
console.log('simulatedPaymentEnabled =', ligar);
await prisma.$disconnect();
