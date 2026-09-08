import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { requireAdmin } from '../../lib/auth.js';
import { runRecovery } from '../../services/recovery.js';

/**
 * Recuperação de vendas — a tela que lista quem ficou pelo caminho.
 *
 * Duas listas, com os mesmos campos que o lojista quer ver ao clicar:
 * quando aconteceu, quem é (nome, e-mail, telefone, final do CPF), de onde
 * veio (UTM, dispositivo) e se o e-mail de recuperação saiu.
 *
 *  - **Checkout abandonado**: lead `draft` — digitou nome e e-mail, não
 *    enviou o formulário.
 *  - **Pix abandonado**: pedido `expired` — gerou o Pix, não pagou.
 *
 * Nada aqui descriptografa CPF: o `cpfLast3` é o que o admin precisa para
 * reconhecer a pessoa no suporte.
 */

const rangeQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

type Utm = Record<string, string> | null;

function pickUtm(raw: unknown): Utm {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (typeof u[k] === 'string' && u[k]) out[k] = u[k] as string;
  }
  return Object.keys(out).length ? out : null;
}

/** Resume o user-agent em algo legível: "Android · Chrome", "iPhone · Safari". */
function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Outro';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : 'navegador';
  return `${os} · ${browser}`;
}

export const recoveryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  app.get('/recovery', async (req, reply) => {
    const { days } = rangeQuery.parse(req.query);
    const from = new Date(Date.now() - days * 86_400_000);

    const [drafts, expired, emailAgg, recovered] = await Promise.all([
      prisma.lead.findMany({
        where: { status: 'draft', createdAt: { gte: from } },
        orderBy: { updatedAt: 'desc' },
        take: 300,
        select: {
          id: true,
          nome: true,
          email: true,
          createdAt: true,
          updatedAt: true,
          recoveryEmailAt: true,
          utm: true,
          ip: true,
          userAgent: true,
        },
      }),
      prisma.order.findMany({
        where: { status: 'expired', createdAt: { gte: from } },
        orderBy: { createdAt: 'desc' },
        take: 300,
        select: {
          id: true,
          reference: true,
          amountCents: true,
          createdAt: true,
          expiresAt: true,
          recoveryEmailAt: true,
          utm: true,
          lead: { select: { id: true, nome: true, email: true, fone: true, cpfLast3: true, ip: true, userAgent: true } },
          emails: {
            where: { template: 'pix_abandoned' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, error: true, sentAt: true, createdAt: true },
          },
        },
      }),
      prisma.emailLog.groupBy({
        by: ['template', 'status'],
        where: { createdAt: { gte: from } },
        _count: { _all: true },
      }),
      // Venda que voltou pelo link do e-mail: o link carrega utm_medium=recuperacao.
      prisma.order.aggregate({
        where: { status: 'paid', paidAt: { gte: from }, utm: { path: ['utm_medium'], equals: 'recuperacao' } },
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
    ]);

    // E-mails de checkout abandonado não têm pedido: o vínculo é o destinatário.
    const draftEmails = drafts.length
      ? await prisma.emailLog.findMany({
          where: { template: 'checkout_abandoned', to: { in: drafts.map((d) => d.email) } },
          orderBy: { createdAt: 'desc' },
          select: { to: true, status: true, error: true, sentAt: true, createdAt: true },
        })
      : [];
    const lastEmailByTo = new Map<string, (typeof draftEmails)[number]>();
    for (const e of draftEmails) if (!lastEmailByTo.has(e.to)) lastEmailByTo.set(e.to, e);

    const emailStats: Record<string, { enviado: number; falhou: number }> = {};
    for (const row of emailAgg) {
      const bucket = (emailStats[row.template] ??= { enviado: 0, falhou: 0 });
      if (row.status === 'enviado') bucket.enviado += row._count._all;
      else bucket.falhou += row._count._all;
    }

    return reply.send({
      days,
      summary: {
        checkoutAbandoned: drafts.length,
        checkoutEmailed: drafts.filter((d) => d.recoveryEmailAt).length,
        pixAbandoned: expired.length,
        pixEmailed: expired.filter((o) => o.recoveryEmailAt).length,
        recovered: { count: recovered._count._all, cents: recovered._sum.amountCents ?? 0 },
        emails: emailStats,
      },
      checkout: drafts.map((d) => {
        const mail = lastEmailByTo.get(d.email);
        return {
          id: d.id,
          nome: d.nome,
          email: d.email,
          startedAt: d.createdAt,
          lastSeenAt: d.updatedAt,
          utm: pickUtm(d.utm),
          ip: d.ip,
          device: describeDevice(d.userAgent),
          recovery: d.recoveryEmailAt
            ? { at: d.recoveryEmailAt, status: mail?.status ?? 'enviado', error: mail?.error ?? null }
            : null,
        };
      }),
      pix: expired.map((o) => {
        const mail = o.emails[0];
        return {
          id: o.id,
          reference: o.reference,
          amountCents: o.amountCents,
          nome: o.lead.nome,
          email: o.lead.email,
          fone: o.lead.fone,
          cpfLast3: o.lead.cpfLast3,
          generatedAt: o.createdAt,
          expiredAt: o.expiresAt,
          utm: pickUtm(o.utm),
          ip: o.lead.ip,
          device: describeDevice(o.lead.userAgent),
          recovery: o.recoveryEmailAt
            ? { at: o.recoveryEmailAt, status: mail?.status ?? 'enviado', error: mail?.error ?? null }
            : null,
        };
      }),
    });
  });

  /** Roda o job agora, em vez de esperar o próximo minuto. */
  app.post('/recovery/run', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (_req, reply) => {
    const result = await runRecovery();
    return reply.send({ ok: true, ...result });
  });
};
