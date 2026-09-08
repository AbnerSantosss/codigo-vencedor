import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAdmin } from '../../lib/auth.js';

/**
 * O que acontece no site.
 *
 * Duas visões: um resumo do funil no período (com as taxas que interessam) e
 * a lista crua dos últimos eventos, para conferir se o rastreamento está
 * chegando enquanto se mexe no GTM.
 */

const FUNNEL_ORDER = [
  { event: 'page_view', label: 'Visitas' },
  { event: 'view_content', label: 'Viram o conteúdo' },
  { event: 'select_promotion', label: 'Clicaram no CTA' },
  { event: 'begin_checkout', label: 'Começaram o checkout' },
  { event: 'generate_lead', label: 'Enviaram o formulário' },
  { event: 'add_payment_info', label: 'Pix gerado' },
  { event: 'purchase', label: 'Pagaram' },
] as const;

const rangeQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
});

const listQuery = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  event: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

export const eventsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  /** Resumo do funil: eventos, sessões únicas e taxa em relação às visitas. */
  app.get('/events/summary', async (req, reply) => {
    const { days } = rangeQuery.parse(req.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [totals, sessions] = await Promise.all([
      prisma.funnelEvent.groupBy({
        by: ['event'],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      // Sessões distintas por etapa: uma pessoa que recarrega a página cinco
      // vezes é uma visita, não cinco. É a contagem que faz a taxa significar
      // alguma coisa.
      prisma.$queryRaw<{ event: string; sessions: bigint }[]>`
        SELECT "event", COUNT(DISTINCT "sessionId") AS sessions
        FROM "FunnelEvent"
        WHERE "createdAt" >= ${since} AND "sessionId" IS NOT NULL
        GROUP BY "event"
      `,
    ]);

    const byEvent = new Map(totals.map((t) => [t.event, t._count._all]));
    const bySession = new Map(sessions.map((s) => [s.event, Number(s.sessions)]));
    const visits = bySession.get('page_view') ?? 0;

    const funnel = FUNNEL_ORDER.map(({ event, label }) => {
      const uniques = bySession.get(event) ?? 0;
      return {
        event,
        label,
        total: byEvent.get(event) ?? 0,
        uniques,
        rate: visits > 0 ? Number(((uniques / visits) * 100).toFixed(1)) : null,
      };
    });

    /** Por onde o tráfego chegou. */
    const sources = await prisma.$queryRaw<{ source: string | null; sessions: bigint }[]>`
      SELECT COALESCE(NULLIF("utm"->>'utm_source', ''), 'direto') AS source,
             COUNT(DISTINCT "sessionId") AS sessions
      FROM "FunnelEvent"
      WHERE "createdAt" >= ${since} AND "event" = 'page_view' AND "sessionId" IS NOT NULL
      GROUP BY 1
      ORDER BY sessions DESC
      LIMIT 10
    `;

    return reply.send({
      days,
      visits,
      funnel,
      sources: sources.map((s) => ({ source: s.source ?? 'direto', sessions: Number(s.sessions) })),
    });
  });

  /** Lista crua, paginada por cursor. */
  app.get('/events', async (req, reply) => {
    const { days, event, limit, cursor } = listQuery.parse(req.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.funnelEvent.findMany({
      where: { createdAt: { gte: since }, ...(event ? { event } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        event: true,
        eventId: true,
        sessionId: true,
        page: true,
        referrer: true,
        utm: true,
        params: true,
        createdAt: true,
      },
    });

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return reply.send({
      items: items.map((r) => ({
        ...r,
        // O visitante não precisa aparecer identificado numa tela de debug.
        sessionId: r.sessionId ? `${r.sessionId.slice(0, 8)}…` : null,
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    });
  });
};
