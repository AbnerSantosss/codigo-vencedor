import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAdmin } from '../../lib/auth.js';
import { maskEmail } from '../../services/crypto.js';

/**
 * Métricas de venda.
 *
 * Duas regras que valem para tudo aqui:
 *
 *  - **Comparação sempre contra o período anterior de mesmo tamanho.** "7 dias"
 *    compara com os 7 dias que vieram antes, não com "a semana passada no
 *    calendário". Sem isso a variação muda de significado conforme o dia da
 *    semana em que se olha.
 *  - **Visitas contam sessões distintas, não disparos.** Alguém que recarrega
 *    a página cinco vezes é uma visita. É isso que faz a taxa de conversão
 *    significar alguma coisa.
 */

const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(7) });

interface Window {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

function windowFor(days: number): Window {
  const to = new Date();
  const span = days * 24 * 60 * 60 * 1000;
  const from = new Date(to.getTime() - span);
  return { from, to, prevFrom: new Date(from.getTime() - span), prevTo: from };
}

/** Variação percentual, com o cuidado de não dividir por zero. */
function delta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

async function paidStats(from: Date, to: Date) {
  const agg = await prisma.order.aggregate({
    where: { status: 'paid', paidAt: { gte: from, lt: to } },
    _sum: { amountCents: true },
    _count: { _all: true },
  });
  return { revenueCents: agg._sum.amountCents ?? 0, orders: agg._count._all };
}

async function distinctSessions(event: string, from: Date, to: Date): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(DISTINCT "sessionId") AS n
    FROM "FunnelEvent"
    WHERE "event" = ${event} AND "createdAt" >= ${from} AND "createdAt" < ${to} AND "sessionId" IS NOT NULL
  `;
  return Number(rows[0]?.n ?? 0);
}

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  /** Os cartões do topo do dashboard. */
  app.get('/metrics/summary', async (req, reply) => {
    const { days } = rangeQuery.parse(req.query);
    const w = windowFor(days);

    const [now, prev, visits, prevVisits, pixCreated, refunded, drafts, expiredOrders, recoveryEmails, recovered] =
      await Promise.all([
        paidStats(w.from, w.to),
        paidStats(w.prevFrom, w.prevTo),
        distinctSessions('page_view', w.from, w.to),
        distinctSessions('page_view', w.prevFrom, w.prevTo),
        prisma.order.count({ where: { createdAt: { gte: w.from, lt: w.to } } }),
        prisma.order.aggregate({
          where: { status: 'refunded', refundedAt: { gte: w.from, lt: w.to } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
        // Abandonos: quem preencheu e não gerou o Pix, quem gerou e não pagou.
        prisma.lead.count({ where: { status: 'draft', createdAt: { gte: w.from, lt: w.to } } }),
        prisma.order.count({ where: { status: 'expired', createdAt: { gte: w.from, lt: w.to } } }),
        prisma.emailLog.count({
          where: {
            status: 'enviado',
            template: { in: ['checkout_abandoned', 'pix_abandoned'] },
            createdAt: { gte: w.from, lt: w.to },
          },
        }),
        // Venda que voltou pelo link do e-mail de recuperação (utm_medium=recuperacao).
        prisma.order.aggregate({
          where: { status: 'paid', paidAt: { gte: w.from, lt: w.to }, utm: { path: ['utm_medium'], equals: 'recuperacao' } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
      ]);

    const refundedCents = refunded._sum.amountCents ?? 0;
    const netCents = now.revenueCents - refundedCents;

    return reply.send({
      days,
      revenue: {
        cents: netCents,
        grossCents: now.revenueCents,
        refundedCents,
        deltaPct: delta(now.revenueCents, prev.revenueCents),
      },
      paidOrders: { value: now.orders, deltaAbs: now.orders - prev.orders },
      visits: { value: visits, deltaAbs: visits - prevVisits },
      // Conversão em pontos percentuais: comparar "3,2%" com "3,6%" como
      // variação relativa (-11%) confunde mais do que ajuda.
      conversion: {
        pct: visits > 0 ? Number(((now.orders / visits) * 100).toFixed(2)) : null,
        deltaPp:
          visits > 0 && prevVisits > 0
            ? Number((((now.orders / visits) - (prev.orders / prevVisits)) * 100).toFixed(2))
            : null,
      },
      averageTicketCents: now.orders > 0 ? Math.round(now.revenueCents / now.orders) : 0,
      pixPaidRate: {
        pct: pixCreated > 0 ? Number(((now.orders / pixCreated) * 100).toFixed(1)) : null,
        paid: now.orders,
        created: pixCreated,
      },
      refunds: { count: refunded._count._all, cents: refundedCents },
      abandon: {
        drafts,
        expiredOrders,
        recoveryEmails,
        recovered: { count: recovered._count._all, cents: recovered._sum.amountCents ?? 0 },
      },
    });
  });

  /** Série do gráfico de receita: um ponto por dia, sem buracos. */
  app.get('/metrics/daily', async (req, reply) => {
    const { days } = rangeQuery.parse(req.query);
    const w = windowFor(days);

    const rows = await prisma.$queryRaw<{ dia: Date; receita: bigint; pedidos: bigint }[]>`
      SELECT date_trunc('day', "paidAt") AS dia,
             SUM("amountCents")          AS receita,
             COUNT(*)                    AS pedidos
      FROM "Order"
      WHERE "status" = 'paid' AND "paidAt" >= ${w.from} AND "paidAt" < ${w.to}
      GROUP BY 1
      ORDER BY 1
    `;

    const byDay = new Map(rows.map((r) => [r.dia.toISOString().slice(0, 10), r]));

    // Dias sem venda precisam existir como zero. Sem isso o gráfico ligaria
    // dois pontos distantes por uma reta e sugeriria vendas que não houve.
    const series: { date: string; revenueCents: number; orders: number }[] = [];
    const cursor = new Date(w.from);
    cursor.setHours(0, 0, 0, 0);

    while (cursor < w.to) {
      const key = cursor.toISOString().slice(0, 10);
      const row = byDay.get(key);
      series.push({
        date: key,
        revenueCents: row ? Number(row.receita) : 0,
        orders: row ? Number(row.pedidos) : 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    return reply.send({ days, series });
  });

  /**
   * Origem do tráfego.
   *
   * Devolve as 8 maiores nomeadas e agrupa o resto. Uma versão anterior
   * cortava em 3 + "outras" por causa do limite de cores categóricas — mas
   * com o tráfego distribuído entre várias fontes, "outras" virava o maior
   * grupo do gráfico e escondia justamente o que se quer ver. O gráfico
   * passou a ser de barras de uma cor só, que não tem esse teto.
   */
  app.get('/metrics/sources', async (req, reply) => {
    const { days } = rangeQuery.parse(req.query);
    const w = windowFor(days);

    const rows = await prisma.$queryRaw<{ source: string; sessoes: bigint }[]>`
      SELECT COALESCE(NULLIF("utm"->>'utm_source', ''), 'direto') AS source,
             COUNT(DISTINCT "sessionId")                          AS sessoes
      FROM "FunnelEvent"
      WHERE "event" = 'page_view' AND "createdAt" >= ${w.from} AND "createdAt" < ${w.to}
        AND "sessionId" IS NOT NULL
      GROUP BY 1
      ORDER BY sessoes DESC
    `;

    const all = rows.map((r) => ({ source: r.source, sessions: Number(r.sessoes) }));
    const top = all.slice(0, 8);
    const rest = all.slice(8).reduce((sum, r) => sum + r.sessions, 0);
    if (rest > 0) top.push({ source: 'outras', sessions: rest });

    return reply.send({ days, sources: top, total: all.reduce((s, r) => s + r.sessions, 0) });
  });

  /** Últimos pedidos, para a tabela do canto inferior direito. */
  app.get('/metrics/recent-orders', async (req, reply) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(8) }).parse(req.query);

    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        publicId: true,
        reference: true,
        amountCents: true,
        status: true,
        createdAt: true,
        paidAt: true,
        provider: true,
        lead: { select: { nome: true, email: true } },
      },
    });

    return reply.send({
      orders: orders.map((o) => ({
        publicId: o.publicId,
        reference: o.reference,
        amountCents: o.amountCents,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
        paidAt: o.paidAt?.toISOString() ?? null,
        provider: o.provider,
        customer: o.lead.nome,
        // E-mail mascarado: o dashboard não é lugar de listar dado pessoal
        // por inteiro, mesmo atrás de login.
        email: maskEmail(o.lead.email),
      })),
    });
  });
};
