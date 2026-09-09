import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { clientIp } from '../lib/security.js';
import { isValidCpf, isValidPhone } from '../lib/cpf.js';
import { createCheckout, isSimulatedCharge } from '../services/checkout.js';
import { getSiteConfig } from '../services/config.js';
import { maskEmail } from '../services/crypto.js';
import { upsertDraftLead } from '../services/recovery.js';
import { confirmarPagamento } from '../services/payments.js';
import { readVisitorId } from '../lib/visitor.js';
import { sanitizeUtm } from '../lib/attribution.js';

const checkoutBody = z.object({
  nome: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(200),
  cpf: z.string().max(20),
  fone: z.string().max(20),
  utm: z.record(z.string().max(300)).optional(),
  session_id: z.string().max(64).optional(),
  event_id: z.string().max(64).optional(),
  fbp: z.string().max(120).optional(),
  fbc: z.string().max(200).optional(),
});

const draftBody = z.object({
  /**
   * Opcional, e aceita vazio: a LP dispara o rascunho assim que o **e-mail**
   * fica válido, que na prática é antes de o nome estar completo. Exigir nome
   * aqui fazia o rascunho ser descartado em silêncio — e sem rascunho não há
   * lead, não há abandono de checkout e não há recuperação.
   */
  nome: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200),
  utm: z.record(z.string().max(300)).optional(),
  session_id: z.string().max(64).optional(),
  fbp: z.string().max(120).optional(),
  fbc: z.string().max(200).optional(),
});

export const checkoutRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Rascunho do lead — chamado pela página assim que o e-mail fica válido,
   * antes de a pessoa apertar "Gerar Pix".
   *
   * É o que torna "checkout abandonado" mensurável e recuperável: sem isto,
   * quem sai antes de enviar o formulário simplesmente não existe para nós.
   * Responde 204 sempre; um rascunho que falhou não é problema do visitante.
   *
   * **E-mail válido basta.** A regra antiga exigia nome com sobrenome junto,
   * e quem preenchia só o e-mail e sumia era descartado sem registro nenhum —
   * exatamente a pessoa que o dono quer recuperar ("se tiver pelo menos o
   * email salva o evento com email ou qualquer outro dado que ele preencher").
   */
  app.post('/api/checkout/draft', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = draftBody.safeParse(req.body);
    if (!parsed.success) return reply.code(204).send();

    upsertDraftLead(
      {
        nome: parsed.data.nome,
        email: parsed.data.email,
        utm: sanitizeUtm(parsed.data.utm),
        sessionId: parsed.data.session_id,
        visitorId: readVisitorId(req) ?? undefined,
        fbp: parsed.data.fbp,
        fbc: parsed.data.fbc,
        ip: clientIp(req, env.TRUST_CLOUDFLARE),
        userAgent: req.headers['user-agent'],
      },
      req.log,
    ).catch((err) => req.log.warn({ err }, 'falha ao gravar rascunho de lead'));

    return reply.code(204).send();
  });

  /**
   * Cria o pedido e devolve o Pix.
   *
   * Rate limit apertado: gerar cobrança escreve em três tabelas e chama o
   * provedor. Cinco por minuto por IP é folgado para uma pessoa comprando e
   * apertado para quem quiser encher o banco.
   */
  app.post('/api/checkout', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const cfg = await getSiteConfig();

    if (cfg.checkout.mode === 'link') {
      return reply.code(409).send({ error: 'checkout_externo', message: 'Esta página usa um checkout externo.' });
    }

    const parsed = checkoutBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados_invalidos', campo: parsed.error.issues[0]?.path.join('.') });
    }

    const body = parsed.data;
    const cpf = body.cpf.replace(/\D/g, '');
    const fone = body.fone.replace(/\D/g, '');

    // As mesmas checagens do navegador, refeitas aqui: validação no cliente
    // é conveniência, não barreira — qualquer um chama a rota direto.
    if (body.nome.trim().split(/\s+/).length < 2) {
      return reply.code(400).send({ error: 'nome_incompleto', message: 'Informe nome e sobrenome.' });
    }
    if (!isValidCpf(cpf)) {
      return reply.code(400).send({ error: 'cpf_invalido', message: 'CPF inválido.' });
    }
    if (!isValidPhone(fone)) {
      return reply.code(400).send({ error: 'telefone_invalido', message: 'Informe um WhatsApp com DDD.' });
    }

    try {
      const result = await createCheckout(
        {
          nome: body.nome.trim(),
          email: body.email.toLowerCase(),
          cpf,
          fone,
          utm: sanitizeUtm(body.utm),
          sessionId: body.session_id,
          visitorId: readVisitorId(req) ?? undefined,
          fbp: body.fbp,
          fbc: body.fbc,
          ip: clientIp(req, env.TRUST_CLOUDFLARE),
          userAgent: req.headers['user-agent'],
          /* Só para o `pix.created` achar o evento do navegador e levar o
             bloco `site` no webhook. Ver `createCheckout`. */
          eventId: body.event_id,
        },
        req.log,
      );

      /**
       * Liga o evento que o navegador acabou de disparar a este pedido e a
       * esta pessoa.
       *
       * Antes isto gravava `orderId: null` — o valor que já estava lá —, ou
       * seja, não fazia nada, apesar do comentário dizer o contrário. Com o
       * vínculo real, dá para partir de um pedido e listar o caminho que a
       * pessoa fez até ele, que é o que a tela de eventos precisa.
       *
       * `updateMany` e não `update` porque `eventId` ainda não é único no
       * banco. Sem `await`: o visitante não deve esperar por isto, e uma
       * falha aqui não pode derrubar uma venda que já foi criada.
       */
      if (body.event_id) {
        prisma.funnelEvent
          .updateMany({
            where: { eventId: body.event_id },
            data: { orderId: result.orderId, leadId: result.leadId },
          })
          .catch(() => undefined);
      }

      /**
       * O `orderId` e o `leadId` são de uso interno: servem para o vínculo
       * acima e não podem sair daqui. O identificador público do pedido é o
       * `orderPublicId` — existe exatamente para que o id de banco nunca
       * precise ser exposto. Separar por desestruturação em vez de confiar em
       * quem for editar depois lembrar de tirar.
       */
      const { orderId: _orderId, leadId: _leadId, ...publico } = result;

      return reply.send(publico);
    } catch (err) {
      req.log.error({ err }, 'falha ao criar cobrança');
      return reply.code(502).send({ error: 'gateway_indisponivel' });
    }
  });

  /**
   * Status do pedido, consultado em laço pela landing page.
   *
   * `publicId` é UUID justamente para esta rota poder ser pública sem virar
   * uma listagem de pedidos por tentativa e erro.
   */
  app.get('/api/orders/:publicId/status', { config: { rateLimit: { max: 120, timeWindow: '1 minute' } } }, async (req, reply) => {
    const params = z.object({ publicId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });

    const order = await prisma.order.findUnique({
      where: { publicId: params.data.publicId },
      select: {
        status: true,
        reference: true,
        amountCents: true,
        currency: true,
        paidAt: true,
        expiresAt: true,
        purchaseEventId: true,
        pixCharge: { select: { raw: true } },
        lead: { select: { nome: true, email: true } },
      },
    });

    if (!order) return reply.code(404).send({ error: 'not_found' });

    const base = {
      status: order.status,
      reference: order.reference,
      expiresAt: order.expiresAt?.toISOString() ?? null,
      simulated: isSimulatedCharge(order.pixCharge?.raw),
    };

    // Dados do comprador só saem depois do pagamento confirmado, e mesmo
    // assim mascarados: esta rota é pública.
    if (order.status !== 'paid') return reply.send(base);

    const cfg = await getSiteConfig();
    return reply.send({
      ...base,
      accessUrl: /^https?:\/\//i.test(cfg.email.accessUrl) ? cfg.email.accessUrl : null,
      amountCents: order.amountCents,
      currency: order.currency,
      paidAt: order.paidAt?.toISOString() ?? null,
      purchaseEventId: order.purchaseEventId,
      firstName: order.lead.nome.split(' ')[0],
      emailMasked: maskEmail(order.lead.email),
    });
  });

  /**
   * Confirma o pagamento de uma cobrança de DEMONSTRAÇÃO.
   *
   * Existe para dar de testar o fluxo inteiro — formulário, QR, contador,
   * confirmação, página de obrigado — antes de haver credencial de gateway.
   *
   * Só responde para cobranças marcadas como simuladas, e uma cobrança só é
   * simulada quando não há chave Pix cadastrada. Ou seja: no momento em que a
   * chave real entra, esta rota deixa de existir na prática. Um pedido de
   * verdade nunca pode ser marcado como pago por aqui.
   */
  app.post(
    '/api/orders/:publicId/simulate-payment',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const params = z.object({ publicId: z.string().uuid() }).safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found' });

      const order = await prisma.order.findUnique({
        where: { publicId: params.data.publicId },
        select: { id: true, status: true, pixCharge: { select: { raw: true } } },
      });

      if (!order || !isSimulatedCharge(order.pixCharge?.raw)) {
        return reply.code(404).send({ error: 'not_found' });
      }
      /**
       * A regra inteira — transição atômica, `purchaseEventId` gerado uma
       * vez, conversão, e-mail e webhook de saída — vive em
       * `confirmarPagamento`, que é o **mesmo** caminho do webhook do
       * gateway. Manter uma cópia aqui faria as duas divergirem na primeira
       * mudança, e a divergência apareceria como "a venda simulada libera
       * acesso e a de verdade não".
       */
      const r = await confirmarPagamento(order.id, 'simulacao', req.log);
      if (!r) return reply.code(404).send({ error: 'not_found' });
      if (r.status !== 'paid') {
        return reply.code(409).send({ error: 'pedido_nao_pendente', status: r.status });
      }

      return reply.send({ ok: true, status: 'paid', purchaseEventId: r.purchaseEventId });
    },
  );
};
