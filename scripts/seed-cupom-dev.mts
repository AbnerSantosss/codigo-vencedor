/* Liga cupons no ambiente de dev e cria dois cupons de teste.
   Só para desenvolvimento: não roda nada disso em produção. */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const cfg = await prisma.siteConfig.findUnique({ where: { id: 1 } });
const checkout = { ...((cfg?.checkout as Record<string, unknown>) ?? {}) };
checkout.couponsEnabled = true;
checkout.simulatedPaymentEnabled = false;
await prisma.siteConfig.update({ where: { id: 1 }, data: { checkout } });

for (const c of [
  { code: 'TESTE10', kind: 'percent' as const, value: 10, maxUses: null as number | null },
  { code: 'TUDO100', kind: 'percent' as const, value: 100, maxUses: 3 as number | null },
]) {
  await prisma.coupon.upsert({
    where: { code: c.code },
    update: { kind: c.kind, value: c.value, active: true, maxUses: c.maxUses },
    create: { code: c.code, kind: c.kind, value: c.value, active: true, maxUses: c.maxUses },
  });
}

console.log('checkout:', JSON.stringify(checkout));
console.log('cupons:', (await prisma.coupon.findMany({ select: { code: true, kind: true, value: true, maxUses: true, usedCount: true } })));
await prisma.$disconnect();
