import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../db.js';
import { getPublicConfig, getSiteConfig } from '../services/config.js';

/**
 * Contagens "reais" para os blocos de escassez, quando o admin escolhe o modo
 * `from_sales` em vez de um número fixo.
 *
 * Cache curto: o número aparece em toda visita e uma diferença de 30s não
 * muda nada para o visitante, mas duas queries por pageview mudam para o banco.
 */
let liveCache: { spots: number; buyers: number; at: number } | null = null;
const LIVE_TTL_MS = 30_000;

async function liveCounters(totalSpots: number): Promise<{ spots: number; buyers: number }> {
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) {
    return { spots: liveCache.spots, buyers: liveCache.buyers };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [paidTotal, paid24h] = await Promise.all([
    prisma.order.count({ where: { status: 'paid' } }),
    prisma.order.count({ where: { status: 'paid', paidAt: { gte: since } } }),
  ]);

  const value = { spots: Math.max(0, totalSpots - paidTotal), buyers: paid24h, at: Date.now() };
  liveCache = value;
  return { spots: value.spots, buyers: value.buyers };
}

export const publicRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Config que a landing page consome no boot.
   *
   * Público de propósito — só contém o que já é visível na página. Nenhum
   * token, nenhuma credencial: esses ficam em `Secret` e só o servidor lê.
   *
   * De rastreamento sai só `tracking.gtmIds` (containers ativos) e
   * `tracking.gtmId` (o primeiro deles, para quem já lia o campo antigo). A
   * projeção é montada em `getPublicConfig`, em `services/config.ts` — id de
   * pixel e measurement id não passam por aqui: o envio é do servidor.
   */
  app.get('/api/config', async (_req, reply) => {
    const cfg = await getSiteConfig();

    const needsLive =
      cfg.scarcity.spots.mode === 'from_sales' || cfg.scarcity.buyers.mode === 'from_sales';

    const live = needsLive ? await liveCounters(cfg.scarcity.spots.value) : {};
    const publicCfg = await getPublicConfig(live);

    return reply
      // 30s de cache no navegador: mudança no admin aparece rápido, mas um
      // F5 seguido não bate no servidor de novo.
      .header('Cache-Control', 'public, max-age=30')
      .send(publicCfg);
  });
};
