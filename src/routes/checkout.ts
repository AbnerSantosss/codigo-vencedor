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
import { validarCupom, MENSAGEM_DE_ERRO } from '../services/coupons.js';
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
  /**
   * Só o código digitado. O desconto **não** vem do navegador — o servidor
   * lê o cupom no banco e refaz a conta. Aceitar valor daqui seria aceitar o
   * preço que o comprador escolher.
   */
  cupom: z.string().trim().max(40).optional(),
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
   * Confere um cupom e devolve o preço resultante, sem criar nada.
   *
   * É o que responde ao botão "Aplicar" do campo de cupom. Não gasta uso, não
   * grava lead e não cria pedido: quem gasta o cupom é a criação do checkout,
   * que reconfere tudo. Conferir aqui e gastar aqui esgotaria um cupom de uso
   * único só de alguém digitar e desistir.
   *
   * O corpo devolve os valores já calculados pelo servidor (cheio, desconto,
   * a pagar). A página **exibe** esses números; ela não os recalcula, e muito
   * menos os envia de volta — o preço da venda sai do banco, sempre.
   *
   * Rate limit apertado porque é uma rota pública que consulta o banco por
   * código: 20 por minuto dá conforto para quem erra o cupom e não dá para
   * quem quiser descobrir cupons por tentativa e erro.
   */
  app.post('/api/checkout/coupon', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ cupom: z.string().trim().min(1).max(40) }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, erro: 'nao_encontrado', message: MENSAGEM_DE_ERRO.nao_encontrado });
    }

    const r = await validarCupom(parsed.data.cupom);
    if (!r.ok) {
      /* 200 com `ok: false`, e não 4xx: cupom errado é resposta normal de um
         formulário, não falha de requisição. A LP trata os dois casos no
         mesmo lugar e o rastreamento distingue pelo campo `erro`. */
      return reply.send({ ok: false, erro: r.erro, message: MENSAGEM_DE_ERRO[r.erro] });
    }

    return reply.send({
      ok: true,
      code: r.cupom.code,
      kind: r.cupom.kind,
      value: r.cupom.value,
      listAmountCents: r.cupom.listAmountCents,
      discountCents: r.cupom.discountCents,
      amountCents: r.cupom.amountCents,
      limitadoPeloMinimo: r.cupom.limitadoPeloMinimo,
    });
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
          cupom: body.cupom,
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

      /**
       * `simulated` só sai quando o pagamento simulado está ligado no painel.
       *
       * É esse campo que faz a LP mostrar o aviso e o botão "já paguei" da
       * compra de teste. Com a trava desligada, a rota de simulação responde
       * 404 — anunciar o botão seria oferecer um caminho que não existe.
       */
      return reply.send({ ...publico, simulated: publico.simulated && cfg.checkout.simulatedPaymentEnabled });
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
        listAmountCents: true,
        discountCents: true,
        couponCode: true,
        currency: true,
        paidAt: true,
        expiresAt: true,
        purchaseEventId: true,
        pixCharge: { select: { raw: true } },
        lead: { select: { nome: true, email: true } },
      },
    });

    if (!order) return reply.code(404).send({ error: 'not_found' });

    /* A configuração é lida antes do desvio porque o `simulated` do bloco
       comum já depende da trava do painel. Ver a rota de simulação abaixo. */
    const cfg = await getSiteConfig();

    const base = {
      status: order.status,
      reference: order.reference,
      expiresAt: order.expiresAt?.toISOString() ?? null,
      simulated: isSimulatedCharge(order.pixCharge?.raw) && cfg.checkout.simulatedPaymentEnabled,
    };

    // Dados do comprador só saem depois do pagamento confirmado, e mesmo
    // assim mascarados: esta rota é pública.
    if (order.status !== 'paid') return reply.send(base);

    return reply.send({
      ...base,
      accessUrl: /^https?:\/\//i.test(cfg.email.accessUrl) ? cfg.email.accessUrl : null,
      amountCents: order.amountCents,
      /* A página de obrigado mostra "de R$ 27,90 por R$ 24,90 com CUPOM10".
         Sem estes três campos ela só saberia o valor cobrado, e o desconto
         desapareceria exatamente na tela em que a pessoa quer vê-lo. */
      listAmountCents: order.listAmountCents ?? order.amountCents,
      discountCents: order.discountCents,
      couponCode: order.couponCode,
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
   *
   * **Além disso, exige a trava do painel.** "Cobrança simulada" não é a
   * mesma coisa que "qualquer visitante pode se dar um pedido pago": esta
   * rota chama o mesmo `confirmarPagamento` do webhook do gateway, ou seja,
   * manda o e-mail de acesso, dispara a Conversions API e os webhooks de
   * saída como se fosse venda. Numa instalação nova, sem gateway configurado,
   * toda cobrança nasce simulada — e sem a trava bastaria conhecer o
   * `publicId` do próprio pedido para liberar o produto e sujar o relatório.
   * Por isso o padrão de `checkout.simulatedPaymentEnabled` é **desligado**,
   * e o dono liga só enquanto está testando.
   */
  app.post(
    '/api/orders/:publicId/simulate-payment',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const params = z.object({ publicId: z.string().uuid() }).safeParse(req.params);
      if (!params.success) return reply.code(404).send({ error: 'not_found' });

      /* 404 e não 403: com a trava desligada a rota simplesmente não existe,
         e responder "proibido" contaria a quem estiver sondando que existe
         um caminho para marcar pedido como pago. */
      const cfg = await getSiteConfig();
      if (!cfg.checkout.simulatedPaymentEnabled) {
        req.log.warn(
          { publicId: params.data.publicId },
          'tentativa de pagamento simulado com a trava desligada',
        );
        return reply.code(404).send({ error: 'not_found' });
      }

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
