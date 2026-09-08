import { prisma } from '../db.js';
import { env } from '../env.js';
import { getSiteConfig } from './config.js';
import { SECRET_KEYS, getSecret } from './secrets.js';
import { tryDecrypt } from './crypto.js';
import { sendMetaEvent, toMetaEventName, type MetaResult } from './meta.js';

/**
 * Envio de conversões pelo servidor.
 *
 * Tudo aqui é "dispare e esqueça" do ponto de vista de quem chamou: o
 * comprador nunca espera a Meta responder para ver o QR Code, e uma falha de
 * rastreamento nunca pode derrubar uma venda. O resultado de cada plataforma
 * fica gravado em `FunnelEvent.forwarded`, que é o que a tela de Eventos
 * mostra quando algo não chega no Events Manager.
 */

interface ForwardContext {
  eventId: string;
  event: string;
  eventSourceUrl: string;
  referrerUrl?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  /** Presente só a partir do formulário preenchido. */
  lead?: {
    nome: string;
    email: string;
    /* Nulos porque um lead em rascunho ainda não tem telefone nem CPF. */
    fone?: string | null;
    cpfEnc?: string | null;
  } | null;
  customData?: Record<string, unknown>;
  eventTimeMs?: number;
}

async function metaConfig() {
  const cfg = await getSiteConfig();
  const token = await getSecret(SECRET_KEYS.metaCapiToken);
  if (!cfg.tracking.meta.pixelId || !token) return null;
  return {
    pixelId: cfg.tracking.meta.pixelId,
    accessToken: token,
    testEventCode: cfg.tracking.meta.testEventCode || null,
    enabledEvents: new Set(cfg.tracking.meta.events),
  };
}

/**
 * Manda um evento do funil para as plataformas configuradas.
 *
 * Nunca lança. O retorno é só para quem quiser logar; o efeito colateral que
 * importa é a gravação em `forwarded`.
 */
export async function forwardEvent(ctx: ForwardContext): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  try {
    const meta = await metaConfig();

    if (!meta) {
      results.meta = 'nao_configurado';
    } else if (!meta.enabledEvents.has(ctx.event)) {
      results.meta = 'desligado_para_este_evento';
    } else {
      const metaName = toMetaEventName(ctx.event);
      if (!metaName) {
        results.meta = 'sem_evento_equivalente';
      } else {
        const cpf = ctx.lead?.cpfEnc ? tryDecrypt(ctx.lead.cpfEnc) : null;
        const res: MetaResult = await sendMetaEvent(
          {
            eventName: metaName,
            eventId: ctx.eventId,
            eventTimeMs: ctx.eventTimeMs,
            eventSourceUrl: ctx.eventSourceUrl,
            referrerUrl: ctx.referrerUrl,
            user: {
              email: ctx.lead?.email,
              phone: ctx.lead?.fone,
              fullName: ctx.lead?.nome,
              cpf,
              country: 'br',
              clientIpAddress: ctx.ip,
              clientUserAgent: ctx.userAgent,
              fbp: ctx.fbp,
              fbc: ctx.fbc,
            },
            customData: ctx.customData,
          },
          meta,
        );
        results.meta = res.ok
          ? `ok${res.received ? ` (${res.received})` : ''}${meta.testEventCode ? ' · teste' : ''}`
          : `erro: ${res.error}`;
      }
    }
  } catch (err) {
    results.meta = `falha: ${err instanceof Error ? err.message : String(err)}`;
  }

  // GA4, TikTok e Kwai entram aqui no mesmo formato quando forem ligados.

  await prisma.funnelEvent
    .updateMany({ where: { eventId: ctx.eventId }, data: { forwarded: results } })
    .catch(() => undefined);

  return results;
}

/**
 * Purchase — o único evento que nasce exclusivamente no servidor, no momento
 * em que o pagamento é confirmado.
 *
 * Grava o próprio `FunnelEvent` porque não houve um `POST /api/track` do
 * navegador para este evento: quem paga o Pix costuma estar no app do banco,
 * não na nossa página.
 */
export async function forwardPurchase(orderId: string): Promise<Record<string, string>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lead: true },
  });

  if (!order || !order.purchaseEventId) return { meta: 'pedido_sem_event_id' };

  const utm = (order.utm ?? {}) as Record<string, string>;

  await prisma.funnelEvent
    .create({
      data: {
        eventId: order.purchaseEventId,
        event: 'purchase',
        orderId: order.id,
        leadId: order.leadId,
        sessionId: order.lead.sessionId,
        utm: utm,
        params: { value: order.amountCents / 100, currency: order.currency, order_id: order.reference },
        page: '/obrigado',
        ip: order.lead.ip,
        userAgent: order.lead.userAgent,
      },
    })
    .catch(() => undefined);

  return forwardEvent({
    eventId: order.purchaseEventId,
    event: 'purchase',
    eventSourceUrl: `${env.PUBLIC_URL}/obrigado`,
    ip: order.lead.ip,
    userAgent: order.lead.userAgent,
    fbp: order.lead.fbp,
    fbc: order.lead.fbc,
    eventTimeMs: (order.paidAt ?? new Date()).getTime(),
    lead: {
      nome: order.lead.nome,
      email: order.lead.email,
      fone: order.lead.fone,
      cpfEnc: order.lead.cpfEnc,
    },
    customData: {
      value: order.amountCents / 100,
      currency: order.currency,
      order_id: order.reference,
      content_type: 'product',
      content_ids: ['codigo-vencedor'],
      contents: [{ id: 'codigo-vencedor', quantity: 1, item_price: order.amountCents / 100 }],
    },
  });
}

/** Envia um evento de teste para validar a configuração no Events Manager. */
export async function sendMetaTestEvent(): Promise<{ ok: boolean; detail: string }> {
  const meta = await metaConfig();
  if (!meta) {
    return { ok: false, detail: 'Preencha o Pixel ID e o token da API de Conversões antes de testar.' };
  }

  const res = await sendMetaEvent(
    {
      eventName: 'PageView',
      eventId: `teste-${Date.now()}`,
      eventSourceUrl: env.PUBLIC_URL,
      user: {
        // Dado sintético, só para a chamada ter identificação válida — a doc
        // recusa evento sem nenhum parâmetro de casamento utilizável.
        email: 'teste@codigovencedor.local',
        clientUserAgent: 'CodigoVencedor/1.0 (teste de configuracao)',
        clientIpAddress: '127.0.0.1',
        country: 'br',
      },
    },
    meta,
  );

  if (res.ok) {
    return {
      ok: true,
      detail: meta.testEventCode
        ? `A Meta recebeu ${res.received ?? 1} evento. Confira em Events Manager › Testar eventos, com o código ${meta.testEventCode}.`
        : `A Meta recebeu ${res.received ?? 1} evento. Sem test_event_code preenchido, ele entra no fluxo normal em vez da aba de testes.`,
    };
  }

  return { ok: false, detail: `A Meta recusou: ${res.error}` };
}
