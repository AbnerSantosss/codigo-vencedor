import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const desde = new Date(Date.now() - 60 * 60 * 1000);
console.log('por pagina (ultima hora):');
console.log(await prisma.funnelEvent.groupBy({ by: ['page', 'event'], where: { createdAt: { gte: desde } }, _count: { _all: true }, orderBy: { page: 'asc' } }));
console.log('cliques com rotulo:');
console.log(await prisma.funnelEvent.findMany({ where: { event: 'click', createdAt: { gte: desde } }, select: { page: true, cta: true, clickLabel: true, clickSection: true }, take: 8, orderBy: { createdAt: 'desc' } }));
await prisma.$disconnect();
