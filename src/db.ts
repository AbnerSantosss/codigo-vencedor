import { PrismaClient } from '@prisma/client';
import { isProd } from './env.js';

/**
 * Em desenvolvimento o tsx recarrega o módulo a cada save; sem o cache global
 * cada reload abriria um pool novo e o Postgres esgotaria as conexões.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['warn', 'error'] : ['warn', 'error'],
  });

if (!isProd) globalForPrisma.prisma = prisma;
