import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAdmin } from '../../lib/auth.js';
import { eventoSaidaDoSite, montarPayload } from '../../services/eventPayload.js';

/**
 * O que acontece no site.
 *
 * Três visões: um resumo do funil no período (com as taxas que interessam),
 * a lista crua dos últimos eventos, para conferir se o rastreamento está
 * chegando enquanto se mexe no GTM, e o detalhe de um evento com o payload
 * exato que sai (ou sairia) no webhook.
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
  // Texto livre de propósito, não allowlist: é uma tela de conferência de
  // rastreamento, e nomes de evento novos (`checkout_abandoned`,
  // `pix_abandoned`) precisam poder ser filtrados no dia em que passam a ser
  // gravados, sem esperar uma lista aqui ser atualizada. O valor só entra em
  // igualdade num `where` do Prisma — não há como injetar nada por ele.
  event: z.string().max(40).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
});

/**
 * `id` do evento no detalhe.
 *
 * Não é `uuid()` de propósito: a coluna é texto no banco, e responder 400 a
 * um id que simplesmente não existe mais esconde o 404 que explica o caso.
 */
const idParam = z.object({ id: z.string().trim().min(1).max(64) });

/**
 * Entregas de webhook que nasceram deste evento.
 *
 * São dois vínculos, e os dois são necessários. O confiável é `orderId` +
 * `event`, mas ele só existe para o que tem pedido; `checkout.abandoned`
 * nasce de um lead e é gravado com `orderId` nulo — e é justamente o evento
 * que o dono mais quer inspecionar. Por isso também casa por
 * `payload.site.eventId`, que o `montarPayload` sempre grava quando o
 * disparo passa um `funnelEventId`.
 *
 * O casamento por payload seria caro se a tabela fosse grande, mas
 * `OutboundDelivery` cresce com vendas e leads (dezenas por dia), não com
 * navegação (milhares) — e nenhum dos dois vínculos tem índice, então as
 * duas buscas custam o mesmo. Eventos sem evento de saída nem chegam aqui:
 * `page_view` e companhia devolvem `[]` sem tocar no banco.
 *
 * Só o `name` do webhook sai daqui. O `secret` nunca — é o mesmo cuidado do
 * `SELECT_WEBHOOK` em `routes/admin/webhooks.ts`.
 */
async function entregasDoEvento(outboundEvent: string, orderId: string | null, eventId: string) {
  const rows = await prisma.outboundDelivery.findMany({
    where: {
      event: outboundEvent,
      OR: [
        ...(orderId ? [{ orderId }] : []),
        { payload: { path: ['site', 'eventId'], equals: eventId } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true,
      statusCode: true,
      attempt: true,
      deliveredAt: true,
      createdAt: true,
      webhook: { select: { name: true } },
    },
  });

  return rows.map((d) => ({
    id: d.id,
    webhookName: d.webhook.name,
    statusCode: d.statusCode,
    attempt: d.attempt,
    deliveredAt: d.deliveredAt,
    createdAt: d.createdAt,
  }));
}

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
        forwarded: true,
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
        // Para onde este evento vai (ou `null`, quando não vai a lugar
        // nenhum). Sem isto a lista não explica por que `page_view` nunca
        // aparece na fila de entregas.
        outboundEvent: eventoSaidaDoSite(r.event),
        forwarded: r.forwarded ?? null,
      })),
      nextCursor: hasMore ? items[items.length - 1]?.id : null,
    });
  });

  /**
   * Detalhe de um evento: o payload que sai no webhook, mais as entregas.
   *
   * O payload **não** é montado aqui: vem do mesmo `montarPayload` que o
   * disparo usa. Enquanto eram duas montagens, um campo novo entrava numa e
   * faltava na outra, e a tela passava a mentir sobre o que o destino
   * recebeu.
   */
  app.get('/events/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    reply.header('Cache-Control', 'no-store');

    const ev = await prisma.funnelEvent.findUnique({
      where: { id },
      select: {
        id: true,
        eventId: true,
        event: true,
        createdAt: true,
        sessionId: true,
        visitorId: true,
        leadId: true,
        orderId: true,
        page: true,
        referrer: true,
        ip: true,
        userAgent: true,
        utm: true,
        params: true,
        forwarded: true,
      },
    });
    if (!ev) return reply.code(404).send({ error: 'nao_encontrado' });

    const outboundEvent = eventoSaidaDoSite(ev.event);

    // O nome no corpo é o do webhook quando existe um; senão o do próprio
    // site, para eventos de navegação também terem payload para mostrar.
    const nomeEvento = outboundEvent ?? ev.event;
    const payload =
      (await montarPayload(nomeEvento, {
        funnelEventId: ev.id,
        orderId: ev.orderId ?? undefined,
        leadId: ev.leadId ?? undefined,
      })) ??
      // Pedido ou lead apagado: o evento do site continua existindo e a tela
      // sempre tem o que mostrar sobre ele. Devolver `payload: null` seria
      // esconder o bloco `site`, que é justamente o que se veio ver.
      (await montarPayload(nomeEvento, { funnelEventId: ev.id }));

    const deliveries = outboundEvent ? await entregasDoEvento(outboundEvent, ev.orderId, ev.eventId) : [];

    return reply.send({
      // Aqui o `sessionId` vai inteiro: na lista ele é truncado porque é uma
      // varredura; no detalhe o dono já escolheu olhar este evento, e sem a
      // sessão completa não dá para cruzar com o resto do funil.
      event: ev,
      payload,
      outboundEvent,
      deliveries,
    });
  });
};
