import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../lib/auth.js';
import {
  EVENTOS_SAIDA,
  EVENTOS_SAIDA_LISTA,
  MAX_TENTATIVAS,
  conferirUrlDestino,
  dispatchTeste,
  reprocessar,
} from '../../services/outbound.js';

/**
 * Webhooks de saída — cadastro, histórico e reprocessamento.
 *
 * **O segredo aparece uma vez só.** Ele é gerado aqui, mostrado na resposta
 * da criação (ou da rotação) e nunca mais devolvido por nenhuma rota. É o
 * mesmo raciocínio de senha: guardar para poder exibir depois obriga a
 * guardar de forma reversível, e aí o valor vaza junto com o banco. Quem
 * perdeu o segredo rotaciona e reconfigura o destino.
 */

const MOTIVO_URL: Record<string, string> = {
  formato: 'A URL não é válida.',
  protocolo: 'Use http:// ou https://.',
  credencial: 'Não coloque usuário e senha na URL — use o campo de headers.',
  metadados: 'Este endereço é o de metadados da nuvem e não pode ser usado como destino.',
};

const METODOS = ['POST', 'PUT', 'PATCH'] as const;

/**
 * Headers do destino.
 *
 * Limitados em quantidade e tamanho porque vão inteiros para dentro de uma
 * requisição que o servidor faz — e um header gigante viraria uma falha
 * difícil de entender do outro lado.
 */
const headersSchema = z
  .record(z.string().max(1024))
  .refine((h) => Object.keys(h).length <= 15, { message: 'no máximo 15 headers' })
  .refine((h) => Object.keys(h).every((k) => /^[A-Za-z0-9-]{1,64}$/.test(k)), {
    message: 'nome de header inválido (use letras, números e hífen)',
  });

const corpoBase = {
  name: z.string().trim().min(2).max(80),
  url: z.string().trim().min(8).max(500),
  method: z.enum(METODOS).default('POST'),
  events: z.array(z.enum(EVENTOS_SAIDA_LISTA as [string, ...string[]])).min(1).max(EVENTOS_SAIDA_LISTA.length),
  headers: headersSchema.optional(),
  active: z.boolean().default(true),
};

const criarBody = z.object(corpoBase);
const atualizarBody = z.object(corpoBase).partial();
const idParam = z.object({ id: z.string().uuid() });

/** Nunca inclui `secret`. */
const SELECT_WEBHOOK = {
  id: true,
  name: true,
  url: true,
  method: true,
  events: true,
  headers: true,
  active: true,
  createdAt: true,
  updatedAt: true,
} as const;

function novoSegredo(): string {
  return 'whsec_' + randomBytes(24).toString('base64url');
}

function erroZod(reply: import('fastify').FastifyReply, err: z.ZodError) {
  return reply.code(400).send({
    error: 'dados_invalidos',
    issues: err.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
  });
}

export const webhooksAdminRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  /* -------------------------------------------------------------- *
   * Listagem
   * -------------------------------------------------------------- */
  app.get('/webhooks', async (_req, reply) => {
    const webhooks = await prisma.outboundWebhook.findMany({
      orderBy: { createdAt: 'asc' },
      select: SELECT_WEBHOOK,
    });

    /**
     * Resumo de entregas por webhook, para a lista já mostrar o estado sem
     * o painel ter que buscar o histórico de cada um.
     */
    const [porWebhook, mortasPorWebhook] = await Promise.all([
      prisma.outboundDelivery.groupBy({
        by: ['webhookId'],
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      prisma.outboundDelivery.groupBy({
        by: ['webhookId'],
        where: { deliveredAt: null, nextRetryAt: null },
        _count: { _all: true },
      }),
    ]);

    const total = new Map(porWebhook.map((r) => [r.webhookId, r]));
    const mortas = new Map(mortasPorWebhook.map((r) => [r.webhookId, r._count._all]));

    return reply.send({
      eventos: EVENTOS_SAIDA,
      maxTentativas: MAX_TENTATIVAS,
      webhooks: webhooks.map((w) => ({
        ...w,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
        // Booleano, nunca o valor. O segredo só sai na criação e na rotação.
        hasSecret: true,
        entregas: total.get(w.id)?._count._all ?? 0,
        ultimaEntregaAt: total.get(w.id)?._max.createdAt?.toISOString() ?? null,
        cartasMortas: mortas.get(w.id) ?? 0,
        avisoHttp: !w.url.startsWith('https://'),
      })),
    });
  });

  /* -------------------------------------------------------------- *
   * Criar
   * -------------------------------------------------------------- */
  app.post('/webhooks', async (req, reply) => {
    const parsed = criarBody.safeParse(req.body);
    if (!parsed.success) return erroZod(reply, parsed.error);

    const alvo = conferirUrlDestino(parsed.data.url);
    if (!alvo.ok) return reply.code(400).send({ error: 'url_invalida', message: MOTIVO_URL[alvo.motivo] });

    const secret = novoSegredo();
    const criado = await prisma.outboundWebhook.create({
      data: {
        name: parsed.data.name,
        url: parsed.data.url,
        method: parsed.data.method,
        events: parsed.data.events,
        headers: (parsed.data.headers ?? undefined) as Prisma.InputJsonValue | undefined,
        active: parsed.data.active,
        secret,
      },
      select: SELECT_WEBHOOK,
    });

    await audit(req, 'webhook.create', 'OutboundWebhook', criado.id, null, {
      name: criado.name,
      url: criado.url,
      events: criado.events,
    });

    return reply.code(201).send({
      webhook: { ...criado, createdAt: criado.createdAt.toISOString(), updatedAt: criado.updatedAt.toISOString() },
      /** Única vez que este valor sai daqui. */
      secret,
    });
  });

  /* -------------------------------------------------------------- *
   * Atualizar
   * -------------------------------------------------------------- */
  app.put('/webhooks/:id', async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });

    const parsed = atualizarBody.safeParse(req.body);
    if (!parsed.success) return erroZod(reply, parsed.error);

    if (parsed.data.url !== undefined) {
      const alvo = conferirUrlDestino(parsed.data.url);
      if (!alvo.ok) return reply.code(400).send({ error: 'url_invalida', message: MOTIVO_URL[alvo.motivo] });
    }

    const antes = await prisma.outboundWebhook.findUnique({ where: { id: p.data.id }, select: SELECT_WEBHOOK });
    if (!antes) return reply.code(404).send({ error: 'not_found' });

    const atualizado = await prisma.outboundWebhook.update({
      where: { id: p.data.id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.url !== undefined ? { url: parsed.data.url } : {}),
        ...(parsed.data.method !== undefined ? { method: parsed.data.method } : {}),
        ...(parsed.data.events !== undefined ? { events: parsed.data.events } : {}),
        ...(parsed.data.headers !== undefined ? { headers: parsed.data.headers as Prisma.InputJsonValue } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      },
      select: SELECT_WEBHOOK,
    });

    await audit(req, 'webhook.update', 'OutboundWebhook', atualizado.id, antes, atualizado);

    return reply.send({
      webhook: {
        ...atualizado,
        createdAt: atualizado.createdAt.toISOString(),
        updatedAt: atualizado.updatedAt.toISOString(),
      },
    });
  });

  /* -------------------------------------------------------------- *
   * Rotacionar segredo
   * -------------------------------------------------------------- */
  app.post('/webhooks/:id/rotate-secret', async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });

    const existe = await prisma.outboundWebhook.findUnique({ where: { id: p.data.id }, select: { id: true } });
    if (!existe) return reply.code(404).send({ error: 'not_found' });

    const secret = novoSegredo();
    await prisma.outboundWebhook.update({ where: { id: p.data.id }, data: { secret } });
    await audit(req, 'webhook.rotate_secret', 'OutboundWebhook', p.data.id, null, null);

    /**
     * As entregas já na fila passam a ser assinadas com o segredo novo. É o
     * comportamento certo: rotacionar existe justamente para invalidar o
     * antigo, e o destino precisa ser reconfigurado de qualquer forma.
     */
    return reply.send({ secret, aviso: 'Reconfigure o destino com este segredo — ele não será exibido de novo.' });
  });

  /* -------------------------------------------------------------- *
   * Remover
   * -------------------------------------------------------------- */
  app.delete('/webhooks/:id', async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });

    const antes = await prisma.outboundWebhook.findUnique({ where: { id: p.data.id }, select: SELECT_WEBHOOK });
    if (!antes) return reply.code(404).send({ error: 'not_found' });

    // As entregas vão junto — `onDelete: Cascade` no schema.
    await prisma.outboundWebhook.delete({ where: { id: p.data.id } });
    await audit(req, 'webhook.delete', 'OutboundWebhook', p.data.id, antes, null);

    return reply.send({ ok: true });
  });

  /* -------------------------------------------------------------- *
   * Testar
   * -------------------------------------------------------------- */
  app.post(
    '/webhooks/:id/test',
    { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const p = idParam.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not_found' });

      const existe = await prisma.outboundWebhook.findUnique({ where: { id: p.data.id }, select: { id: true } });
      if (!existe) return reply.code(404).send({ error: 'not_found' });

      const r = await dispatchTeste(p.data.id, req.log);

      const d = await prisma.outboundDelivery.findUnique({
        where: { id: r.deliveryId },
        select: { statusCode: true, responseSnippet: true, deliveredAt: true },
      });

      return reply.send({
        ok: r.entregue,
        statusCode: d?.statusCode ?? null,
        resposta: d?.responseSnippet ?? null,
        deliveryId: r.deliveryId,
      });
    },
  );

  /* -------------------------------------------------------------- *
   * Histórico de entregas
   * -------------------------------------------------------------- */
  app.get('/webhooks/:id/deliveries', async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });

    const q = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(30),
        estado: z.enum(['todas', 'entregues', 'pendentes', 'mortas']).default('todas'),
      })
      .safeParse(req.query);
    if (!q.success) return erroZod(reply, q.error);

    const filtro =
      q.data.estado === 'entregues'
        ? { deliveredAt: { not: null } }
        : q.data.estado === 'pendentes'
          ? { deliveredAt: null, nextRetryAt: { not: null } }
          : q.data.estado === 'mortas'
            ? { deliveredAt: null, nextRetryAt: null }
            : {};

    const linhas = await prisma.outboundDelivery.findMany({
      where: { webhookId: p.data.id, ...filtro },
      orderBy: { createdAt: 'desc' },
      take: q.data.limit,
      select: {
        id: true,
        event: true,
        attempt: true,
        statusCode: true,
        responseSnippet: true,
        nextRetryAt: true,
        deliveredAt: true,
        createdAt: true,
        order: { select: { reference: true } },
      },
    });

    return reply.send({
      deliveries: linhas.map((d) => ({
        id: d.id,
        event: d.event,
        attempt: d.attempt,
        statusCode: d.statusCode,
        resposta: d.responseSnippet,
        nextRetryAt: d.nextRetryAt?.toISOString() ?? null,
        deliveredAt: d.deliveredAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        reference: d.order?.reference ?? null,
        /** Sem entrega e sem próxima tentativa: parou de tentar. */
        morta: !d.deliveredAt && !d.nextRetryAt,
      })),
    });
  });

  /* -------------------------------------------------------------- *
   * Ver o corpo de uma entrega
   * -------------------------------------------------------------- */
  app.get('/webhooks/deliveries/:id', async (req, reply) => {
    const p = idParam.safeParse(req.params);
    if (!p.success) return reply.code(404).send({ error: 'not_found' });

    const d = await prisma.outboundDelivery.findUnique({
      where: { id: p.data.id },
      select: { id: true, event: true, payload: true, statusCode: true, responseSnippet: true, attempt: true },
    });
    if (!d) return reply.code(404).send({ error: 'not_found' });

    return reply.send({ delivery: d });
  });

  /* -------------------------------------------------------------- *
   * Reprocessar
   * -------------------------------------------------------------- */
  app.post(
    '/webhooks/deliveries/:id/retry',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const p = idParam.safeParse(req.params);
      if (!p.success) return reply.code(404).send({ error: 'not_found' });

      const d = await prisma.outboundDelivery.findUnique({
        where: { id: p.data.id },
        select: { id: true, deliveredAt: true },
      });
      if (!d) return reply.code(404).send({ error: 'not_found' });
      if (d.deliveredAt) return reply.send({ ok: true, jaEntregue: true });

      const entregue = await reprocessar(p.data.id, req.log);
      await audit(req, 'webhook.retry', 'OutboundDelivery', p.data.id, null, { entregue });

      const depois = await prisma.outboundDelivery.findUnique({
        where: { id: p.data.id },
        select: { statusCode: true, responseSnippet: true },
      });

      return reply.send({ ok: entregue, statusCode: depois?.statusCode ?? null, resposta: depois?.responseSnippet ?? null });
    },
  );

  /* -------------------------------------------------------------- *
   * Notificações recebidas do gateway
   * -------------------------------------------------------------- */
  app.get('/webhooks/inbound', async (req, reply) => {
    const q = z
      .object({ limit: z.coerce.number().int().min(1).max(100).default(30) })
      .safeParse(req.query);
    if (!q.success) return erroZod(reply, q.error);

    const linhas = await prisma.webhookEvent.findMany({
      orderBy: { receivedAt: 'desc' },
      take: q.data.limit,
      select: {
        id: true,
        provider: true,
        eventType: true,
        externalId: true,
        receivedAt: true,
        processedAt: true,
        result: true,
        order: { select: { reference: true } },
      },
    });

    return reply.send({
      inbound: linhas.map((e) => ({
        id: e.id,
        provider: e.provider,
        eventType: e.eventType,
        externalId: e.externalId,
        receivedAt: e.receivedAt.toISOString(),
        processedAt: e.processedAt?.toISOString() ?? null,
        result: e.result,
        reference: e.order?.reference ?? null,
      })),
    });
  });
};
