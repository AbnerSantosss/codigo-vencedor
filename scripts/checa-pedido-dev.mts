import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const o = await prisma.order.findFirst({
  orderBy: { createdAt: 'desc' },
  select: { id: true, publicId: true, status: true, amountCents: true, listAmountCents: true, discountCents: true, couponCode: true, leadId: true },
});
console.log('pedido', o);
console.log('cupons', await prisma.coupon.findMany({ select: { code: true, usedCount: true, maxUses: true } }));
console.log('eventos', await prisma.funnelEvent.groupBy({ by: ['event'], _count: { _all: true } }));
await prisma.$disconnect();
