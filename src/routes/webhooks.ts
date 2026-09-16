import type { FastifyPluginAsync, RouteHandlerMethod } from 'fastify';
import type { GatewayId, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { mercadoPagoGateway, assinaturaVelha, verifyMercadoPagoSignature } from '../gateways/mercadopago.js';
import { appmaxGateway, conferirTokenDeWebhook } from '../gateways/appmax.js';
import { fyhubGateway, conferirTokenFyhub } from '../gateways/fyhub.js';
import { aplicarStatusDoGateway, confirmarPagamento } from '../services/payments.js';

/**
 * Notificações de entrada dos gateways.
 *
 * Quatro regras que valem para qualquer provedor que entre aqui depois:
 *
 * 1. **Sem assinatura válida, não passa.** É o que separa "o Mercado Pago
 *    avisou que foi pago" de "alguém descobriu a URL e mandou um POST". A
 *    validação falha fechada: sem segredo cadastrado, tudo é recusado.
 * 2. **O status nunca vem do corpo.** A notificação diz apenas *qual*
 *    pagamento mudou; o estado real é consultado na API do provedor. Isso
 *    torna inofensiva a repetição de uma notificação antiga — reenviar um
 *    "approved" de um pedido já estornado não o marca como pago, porque a
 *    consulta devolve `refunded`.
 * 3. **Notificação repetida não processa duas vezes.** O índice único
 *    `(provider, externalId)` de `WebhookEvent` é o trinco, no banco. E o
 *    provedor *vai* repetir: é assim que ele garante entrega.
 * 4. **Responder rápido e com 2xx quando o recado foi entendido.** O
 *    Mercado Pago trata demora e erro como falha e reenvia. Erro nosso ao
 *    processar devolve 500 de propósito, para ele reenviar; recado que não
 *    nos serve devolve 200, para ele parar de tentar.
 */

/** Corpo máximo aceito de um webhook, acima do `bodyLimit` global de 16 KB. */
const CORPO_MAX = 64 * 1024;

interface MpNotificacao {
  id?: unknown;
  type?: unknown;
  action?: unknown;
  data?: { id?: unknown };
  live_mode?: unknown;
}

/** `data.id` da query string, que é o valor que o Mercado Pago assina. */
function dataIdDaQuery(query: unknown): string | undefined {
  if (!query || typeof query !== 'object') return undefined;
  const q = query as Record<string, unknown>;
  const bruto = q['data.id'] ?? q.id ?? q['data_id'];
  return typeof bruto === 'string' && bruto ? bruto : undefined;
}

function textoDoHeader(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

/* ------------------------------------------------------------------ *
 * Idempotência — o trinco, no banco
 * ------------------------------------------------------------------ */

type Decisao =
  | { tipo: 'processar'; registroId: string }
  | { tipo: 'repetida' }
  | { tipo: 'corrida' };

/**
 * Registra a notificação **antes** de processar e diz o que fazer com ela.
 *
 * Extraído de dentro da rota do Mercado Pago quando a Appmax entrou: a regra
 * é a mesma para qualquer provedor, e duas cópias dela divergiriam na
 * primeira correção — que é exatamente o tipo de defeito que já apareceu
 * neste projeto (o mesmo `?? null` consertado num arquivo e vivo no
 * vizinho).
 *
 * O que decide "já processei" é `processedAt`, não a existência da linha. A
 * diferença importa: uma tentativa que falhou deixa a linha com `processedAt`
 * nulo, e o reenvio do provedor **precisa** poder tentar de novo — senão uma
 * falha momentânea da API dele viraria um pagamento sem acesso liberado,
 * para sempre. Guardar a linha da falha é também o que dá histórico e erro
 * visível no painel.
 */
async function registrarNotificacao(
  provider: GatewayId,
  externalId: string,
  eventType: string,
  payload: unknown,
  log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void },
): Promise<Decisao> {
  try {
    const criado = await prisma.webhookEvent.create({
      data: {
        provider,
        externalId,
        eventType,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return { tipo: 'processar', registroId: criado.id };
  } catch {
    // Violação do índice único `(provider, externalId)`: já vimos esta.
    const anterior = await prisma.webhookEvent.findUnique({
      where: { provider_externalId: { provider, externalId } },
      select: { id: true, processedAt: true },
    });

    if (!anterior) {
      // Corrida improvável: alguém apagou entre o create e o findUnique.
      log.warn({ provider, externalId }, 'webhook: registro sumiu, pedindo reenvio');
      return { tipo: 'corrida' };
    }

    if (anterior.processedAt) {
      log.info({ provider, externalId }, 'webhook: notificação repetida, já processada');
      return { tipo: 'repetida' };
    }

    log.info({ provider, externalId }, 'webhook: retentativa de notificação que falhou antes');
    return { tipo: 'processar', registroId: anterior.id };
  }
}

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Mercado Pago.
   *
   * O limite é generoso porque uma notificação recusada por excesso de
   * requisição some — o Mercado Pago reenvia algumas vezes e desiste, e o
   * prejuízo seria um pagamento sem acesso liberado. É seguro: só passa daqui
   * quem tem assinatura válida, e quem não tem nem chega ao banco.
   */
  app.post(
    '/mercadopago',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      bodyLimit: CORPO_MAX,
    },
    async (req, reply) => {
      const headers = req.headers as Record<string, unknown>;

      const assinatura = await verifyMercadoPagoSignature({
        signature: textoDoHeader(headers['x-signature']),
        requestId: textoDoHeader(headers['x-request-id']),
        dataId: dataIdDaQuery(req.query),
      });

      if (!assinatura.ok) {
        /**
         * O motivo vai para o log, não para a resposta. Dizer a quem chamou
         * *qual* parte falhou ajudaria a forjar a próxima tentativa; e no
         * caso `sem_segredo` revelaria que a integração está pela metade.
         */
        req.log.warn({ motivo: assinatura.motivo }, 'webhook mercadopago: assinatura recusada');
        return reply.code(401).send({ error: 'unauthorized' });
      }

      if (assinaturaVelha(assinatura.idadeS)) {
        // Registrado, não recusado — ver a explicação em `verifyMercadoPagoSignature`.
        req.log.warn({ idadeS: assinatura.idadeS }, 'webhook mercadopago: assinatura com horário fora do esperado');
      }

      const body = (req.body ?? {}) as MpNotificacao;
      const paymentId = String((body.data?.id ?? dataIdDaQuery(req.query) ?? '') || '');
      const tipo = String(body.type ?? body.action ?? 'unknown');

      if (!paymentId) {
        req.log.warn({ tipo }, 'webhook mercadopago: notificação sem id de pagamento');
        // 200: reenviar não vai fazer aparecer um id que não veio.
        return reply.code(200).send({ ok: true, ignored: 'sem_id' });
      }

      /**
       * Só notificação de pagamento interessa. O Mercado Pago manda várias
       * famílias pela mesma URL (`plan`, `subscription`, `invoice`), e um 4xx
       * nelas faria a integração aparecer como quebrada no painel dele.
       */
      if (!tipo.startsWith('payment')) {
        return reply.code(200).send({ ok: true, ignored: tipo });
      }

      /**
       * Trinco de idempotência **antes** de processar.
       *
       * O `externalId` é o id do pagamento somado ao tipo da ação: o Mercado
       * Pago manda `payment.created` e depois `payment.updated` para o mesmo
       * pagamento, e as duas precisam passar. O que não pode passar duas
       * vezes é a *mesma* notificação.
       *
       * O que decide "já processei" é `processedAt`, não a existência da
       * linha. A diferença importa: uma tentativa anterior que falhou deixa a
       * linha gravada com `processedAt` nulo, e o reenvio do Mercado Pago
       * **precisa** poder tentar de novo — senão uma falha momentânea da API
       * dele viraria um pagamento sem acesso liberado, para sempre. Guardar a
       * linha da falha é também o que dá histórico e log de erro no painel.
       */
      const externalId = paymentId + ':' + tipo;

      const decisao = await registrarNotificacao('mercadopago', externalId, tipo, req.body, req.log);
      if (decisao.tipo === 'repetida') return reply.code(200).send({ ok: true, duplicate: true });
      if (decisao.tipo === 'corrida') return reply.code(500).send({ error: 'processing_failed' });
      const registroId = decisao.registroId;

      try {
        const resultado = await processarPagamento(paymentId, req.log);

        await prisma.webhookEvent.update({
          where: { id: registroId },
          data: { processedAt: new Date(), orderId: resultado.orderId, result: resultado.resumo },
        });

        return reply.code(200).send({ ok: true });
      } catch (err) {
        req.log.error({ err, paymentId }, 'webhook mercadopago: falha ao processar');

        /**
         * `processedAt` fica **nulo** de propósito: é isso que autoriza o
         * reenvio a tentar de novo, em vez de ser barrado como repetido.
         */
        await prisma.webhookEvent
          .update({
            where: { id: registroId },
            data: { result: 'erro: ' + (err instanceof Error ? err.message : 'desconhecido').slice(0, 200) },
          })
          .catch(() => undefined);

        /**
         * 500 de propósito: a falha aqui costuma ser a API do Mercado Pago
         * fora do ar por um instante, e é ele reenviando que salva a venda.
         * Devolver 200 marcaria a notificação como tratada e perderia o
         * pagamento.
         */
        return reply.code(500).send({ error: 'processing_failed' });
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * Appmax
   *
   * Aqui a regra 1 muda de forma, e por um motivo documentado por eles: a
   * Appmax **não** envia header de assinatura nem token nas notificações. Sem
   * nenhuma prova, esta URL seria um endereço público capaz de mexer em
   * pedido — bastaria descobri-la.
   *
   * Duas defesas:
   *
   *   • **Segredo na URL.** O dono cadastra na Appmax
   *     `https://…/webhooks/appmax?t=<segredo>`, e o segredo fica cifrado em
   *     `appmax.webhookToken`. Falha fechada: sem segredo gravado, nada
   *     passa.
   *   • **O corpo não decide nada.** A notificação só diz *qual* pedido
   *     mexeu; o estado é lido de volta em `GET /v1/orders/{id}`. Mesmo que
   *     o segredo vaze, uma notificação forjada só provoca uma releitura na
   *     API da Appmax — não marca pagamento.
   * ---------------------------------------------------------------- */
  app.post(
    '/appmax',
    {
      config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
      bodyLimit: CORPO_MAX,
    },
    async (req, reply) => {
      const query = (req.query ?? {}) as Record<string, unknown>;
      const token =
        (typeof query.t === 'string' ? query.t : undefined) ??
        (typeof query.token === 'string' ? query.token : undefined) ??
        textoDoHeader((req.headers as Record<string, unknown>)['x-cv-token']);

      if (!(await conferirTokenDeWebhook(token))) {
        // Sem detalhar o motivo: dizer "não há segredo cadastrado" contaria
        // ao visitante que a integração está pela metade.
        req.log.warn({ temToken: Boolean(token) }, 'webhook appmax: token da URL recusado');
        return reply.code(401).send({ error: 'unauthorized' });
      }

      const corpo = (req.body ?? {}) as {
        event?: unknown;
        event_type?: unknown;
        data?: Record<string, unknown>;
      };
      const evento = String(corpo.event ?? corpo.event_type ?? 'unknown');
      const dados = corpo.data ?? {};
      const pedidoExterno = String((dados.order_id ?? dados.id ?? '') || '');

      if (!pedidoExterno) {
        req.log.warn({ evento }, 'webhook appmax: notificação sem id de pedido');
        // 200: reenviar não vai fazer aparecer um id que não veio.
        return reply.code(200).send({ ok: true, ignored: 'sem_id' });
      }

      /**
       * Eventos de cliente e de assinatura chegam pela mesma URL e não
       * mudam pedido. Devolver 200 evita que a integração apareça como
       * quebrada no painel da Appmax.
       */
      const tipoDoEvento = String(corpo.event_type ?? '');
      if (tipoDoEvento && tipoDoEvento !== 'order' && tipoDoEvento !== 'payment') {
        return reply.code(200).send({ ok: true, ignored: tipoDoEvento });
      }

      const externalId = pedidoExterno + ':' + evento;
      const decisao = await registrarNotificacao('appmax', externalId, evento, req.body, req.log);
      if (decisao.tipo === 'repetida') return reply.code(200).send({ ok: true, duplicate: true });
      if (decisao.tipo === 'corrida') return reply.code(500).send({ error: 'processing_failed' });

      try {
        const resultado = await processarPedidoAppmax(pedidoExterno, req.log);

        await prisma.webhookEvent.update({
          where: { id: decisao.registroId },
          data: { processedAt: new Date(), orderId: resultado.orderId, result: resultado.resumo },
        });

        return reply.code(200).send({ ok: true });
      } catch (err) {
        req.log.error({ err, pedidoExterno }, 'webhook appmax: falha ao processar');

        await prisma.webhookEvent
          .update({
            where: { id: decisao.registroId },
            data: { result: 'erro: ' + (err instanceof Error ? err.message : 'desconhecido').slice(0, 200) },
          })
          .catch(() => undefined);

        // 500 para a Appmax reenviar: a falha típica é a API dela fora do ar
        // por um instante, e é o reenvio que salva a venda.
        return reply.code(500).send({ error: 'processing_failed' });
      }
    },
  );

  /* ---------------------------------------------------------------- *
   * FyHub — Pix pelo padrão do Banco Central
   *
   * Três diferenças em relação às rotas acima, e todas vêm da
   * especificação, não de uma escolha nossa:
   *
   *   1. **O segredo vai no caminho da URL, não na query.** O padrão manda
   *      o PSP chamar `{webhookUrl}/pix`, concatenando. Uma URL terminada
   *      em `?t=SEGREDO` viraria `?t=SEGREDO/pix` — o segredo corrompido e
   *      a rota recusando tudo. De quebra, mantém o segredo fora da query
   *      string, que é o que as regras de privacidade do projeto já pedem.
   *
   *   2. **Duas rotas, um só tratador.** Alguns PSP validam a URL com um
   *      POST no endereço puro antes de começar a mandar `/pix`. Recusar
   *      esse POST faria o cadastro do webhook falhar sem explicação.
   *
   *   3. **Uma notificação carrega vários Pix.** O corpo é `{ pix: [...] }`
   *      e o padrão permite agrupar. Cada item ganha seu próprio registro
   *      de idempotência: se um falhar, o reenvio do lote inteiro
   *      reprocessa só ele.
   *
   * O de sempre continua valendo: o status **nunca** vem do corpo. A
   * notificação diz qual `txid` mexeu; se foi pago mesmo, quem responde é o
   * `GET /cob/{txid}`. Segredo vazado, aqui, compra no máximo uma releitura
   * na API da FyHub.
   * ---------------------------------------------------------------- */
  const tratarFyhub: RouteHandlerMethod = async (req, reply) => {
    const { token } = (req.params ?? {}) as { token?: string };

    if (!(await conferirTokenFyhub(token))) {
      req.log.warn({ temToken: Boolean(token) }, 'webhook fyhub: segredo da URL recusado');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const corpo = (req.body ?? {}) as { pix?: unknown };
    const itens = Array.isArray(corpo.pix) ? (corpo.pix as Record<string, unknown>[]) : [];

    /**
     * Corpo sem `pix`: é o POST de validação que o PSP faz ao cadastrar a
     * URL. 200 é o que confirma o cadastro para ele.
     */
    if (itens.length === 0) {
      return reply.code(200).send({ ok: true, ignored: 'sem_pix' });
    }

    let houveFalha = false;

    for (const item of itens) {
      const txid = String(item.txid ?? '');
      if (!txid) {
        req.log.warn({}, 'webhook fyhub: item de notificação sem txid');
        continue;
      }

      /**
       * O `endToEndId` identifica o pagamento de forma única em todo o
       * arranjo Pix — é a melhor chave de idempotência disponível aqui.
       * Sem ele, o par txid+horário serve: o mesmo `txid` só volta com
       * outro horário se for outro pagamento.
       */
      const externalId = String(item.endToEndId ?? '') || txid + ':' + String(item.horario ?? '');

      const decisao = await registrarNotificacao('fyhub', externalId, 'pix', item, req.log);
      if (decisao.tipo === 'repetida') continue;
      if (decisao.tipo === 'corrida') {
        houveFalha = true;
        continue;
      }

      try {
        const resultado = await processarCobrancaFyhub(txid, req.log);

        await prisma.webhookEvent.update({
          where: { id: decisao.registroId },
          data: { processedAt: new Date(), orderId: resultado.orderId, result: resultado.resumo },
        });
      } catch (err) {
        houveFalha = true;
        req.log.error({ err, txid }, 'webhook fyhub: falha ao processar');

        await prisma.webhookEvent
          .update({
            where: { id: decisao.registroId },
            data: {
              result: 'erro: ' + (err instanceof Error ? err.message : 'desconhecido').slice(0, 200),
            },
          })
          .catch(() => undefined);
      }
    }

    /**
     * 500 quando qualquer item falhou: a FyHub reenvia o lote inteiro, e o
     * índice único de `WebhookEvent` impede que os itens já processados
     * sejam contados duas vezes.
     */
    if (houveFalha) return reply.code(500).send({ error: 'processing_failed' });
    return reply.code(200).send({ ok: true });
  };

  const opcoesFyhub = {
    config: { rateLimit: { max: 600, timeWindow: '1 minute' } },
    bodyLimit: CORPO_MAX,
  };

  app.post('/fyhub/:token/pix', opcoesFyhub, tratarFyhub);
  app.post('/fyhub/:token', opcoesFyhub, tratarFyhub);
};

/* ------------------------------------------------------------------ *
 * Processamento
 * ------------------------------------------------------------------ */

interface Log {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}

/**
 * Consulta o status real na API e aplica no pedido.
 *
 * Lança quando a consulta falha, para a rota devolver 500 e o Mercado Pago
 * reenviar. Um status que não conseguimos ler é diferente de um status que
 * lemos como "não pago".
 */
async function processarPagamento(
  paymentId: string,
  log: Log,
): Promise<{ orderId: string | null; resumo: string }> {
  const status = await mercadoPagoGateway.getStatus({ providerOrderId: null, providerPaymentId: paymentId });

  if (status === null) {
    throw new Error('mercadopago: status indisponível para ' + paymentId);
  }

  const order = await prisma.order.findFirst({
    where: { providerPaymentId: paymentId },
    select: { id: true, status: true },
  });

  if (!order) {
    /**
     * Pagamento que não é nosso, ou cuja cobrança nem terminou de ser
     * gravada. Não é erro: devolver 500 faria o Mercado Pago reenviar para
     * sempre uma notificação que nunca vai encontrar pedido.
     */
    log.warn({ paymentId, status }, 'webhook mercadopago: pagamento sem pedido correspondente');
    return { orderId: null, resumo: 'sem_pedido:' + status };
  }

  if (status === 'paid') {
    const r = await confirmarPagamento(order.id, 'webhook', log);
    return { orderId: order.id, resumo: r?.mudou ? 'confirmado' : 'ja_estava:' + (r?.status ?? '?') };
  }

  const r = await aplicarStatusDoGateway(order.id, status, 'webhook', log);
  return { orderId: order.id, resumo: r?.mudou ? 'status:' + status : 'sem_mudanca:' + (r?.status ?? '?') };
}

/**
 * Mesmo desenho, do lado da Appmax: o status vem da API, nunca do corpo.
 *
 * A busca é por `providerOrderId` porque é o id do pedido da Appmax que o
 * adaptador grava ali — a Appmax organiza tudo por pedido, e não por
 * pagamento como o Mercado Pago.
 */
async function processarPedidoAppmax(
  pedidoExterno: string,
  log: Log,
): Promise<{ orderId: string | null; resumo: string }> {
  const status = await appmaxGateway.getStatus({ providerOrderId: pedidoExterno, providerPaymentId: null });

  if (status === null) {
    throw new Error('appmax: status indisponível para o pedido ' + pedidoExterno);
  }

  const order = await prisma.order.findFirst({
    where: { providerOrderId: pedidoExterno, provider: 'appmax' },
    select: { id: true, status: true },
  });

  if (!order) {
    log.warn({ pedidoExterno, status }, 'webhook appmax: pedido sem correspondente aqui');
    return { orderId: null, resumo: 'sem_pedido:' + status };
  }

  if (status === 'paid') {
    const r = await confirmarPagamento(order.id, 'webhook', log);
    return { orderId: order.id, resumo: r?.mudou ? 'confirmado' : 'ja_estava:' + (r?.status ?? '?') };
  }

  const r = await aplicarStatusDoGateway(order.id, status, 'webhook', log);
  return { orderId: order.id, resumo: r?.mudou ? 'status:' + status : 'sem_mudanca:' + (r?.status ?? '?') };
}

/**
 * Mesmo desenho, do lado da FyHub: o status vem do `GET /cob/{txid}`.
 *
 * A busca é por `providerOrderId` porque é ali que o adaptador grava o
 * `txid` que ele mesmo gerou. O filtro por `provider` não é decoração: sem
 * ele, um `txid` que por acaso coincidisse com o id de pedido de outro
 * provedor confirmaria a venda errada.
 */
async function processarCobrancaFyhub(
  txid: string,
  log: Log,
): Promise<{ orderId: string | null; resumo: string }> {
  const status = await fyhubGateway.getStatus({ providerOrderId: txid, providerPaymentId: null });

  if (status === null) {
    throw new Error('fyhub: status indisponível para a cobrança ' + txid);
  }

  const order = await prisma.order.findFirst({
    where: { providerOrderId: txid, provider: 'fyhub' },
    select: { id: true, status: true },
  });

  if (!order) {
    log.warn({ txid, status }, 'webhook fyhub: cobrança sem pedido correspondente');
    return { orderId: null, resumo: 'sem_pedido:' + status };
  }

  if (status === 'paid') {
    const r = await confirmarPagamento(order.id, 'webhook', log);
    return { orderId: order.id, resumo: r?.mudou ? 'confirmado' : 'ja_estava:' + (r?.status ?? '?') };
  }

  const r = await aplicarStatusDoGateway(order.id, status, 'webhook', log);
  return { orderId: order.id, resumo: r?.mudou ? 'status:' + status : 'sem_mudanca:' + (r?.status ?? '?') };
}
