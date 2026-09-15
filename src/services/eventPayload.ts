import { randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { firstTouchDoVisitante } from '../lib/attribution.js';
import { maskCpf } from './crypto.js';

/**
 * Montador único do payload de evento.
 *
 * Existe um motivo forte para este arquivo ser separado: o corpo que sai no
 * webhook e o corpo que o dono vê no backoffice ao abrir um evento **têm que
 * ser o mesmo objeto**. Enquanto eram duas montagens, qualquer campo novo
 * entrava numa e faltava na outra, e o painel passava a mentir sobre o que o
 * destino recebeu. Aqui só existe uma função; o webhook a chama para enviar e
 * a tela de Eventos a chama para mostrar.
 *
 * Três regras herdadas do desenho de saída, que continuam valendo:
 *
 * 1. **CPF não sai em claro.** Só o mascarado (`***.***.**X-XX`). O CPF vive
 *    cifrado no banco de propósito; mandá-lo para uma URL digitada num
 *    formulário desfaria isso sem ninguém perceber.
 * 2. **O payload é auto-suficiente.** Quem recebe não deve precisar consultar
 *    nossa API para saber de onde veio a venda — por isso `attribution` leva
 *    o last-touch e o first-touch juntos.
 * 3. **Campo ausente vira `null`, não some.** Consumidor de webhook quebra
 *    mais por chave que aparece e desaparece do que por valor nulo.
 */

/* ------------------------------------------------------------------ *
 * Catálogo de eventos de saída
 * ------------------------------------------------------------------ */

export const EVENTOS_SAIDA = {
  'order.paid': 'Pagamento confirmado',
  'order.refunded': 'Pagamento estornado',
  'pix.created': 'Pix gerado',
  'lead.created': 'Lead capturado (nome e e-mail)',
  'checkout.started': 'Formulário de checkout enviado',
  'checkout.abandoned': 'Checkout abandonado',
  'pix.abandoned': 'Pix expirou sem pagamento',
} as const;

export type EventoSaida = keyof typeof EVENTOS_SAIDA;

export const EVENTOS_SAIDA_LISTA = Object.keys(EVENTOS_SAIDA) as EventoSaida[];

export function eventoSaidaValido(v: unknown): v is EventoSaida {
  return typeof v === 'string' && v in EVENTOS_SAIDA;
}

/**
 * De qual evento do site nasce cada evento de webhook.
 *
 * Serve para a tela de Eventos dizer, ao lado de cada disparo, para onde ele
 * vai (ou por que não vai). Os quatro eventos de navegação — `page_view`,
 * `view_content`, `select_promotion` e `click` — mapeiam para `null` de
 * propósito: são milhares por dia e inundariam a fila de entregas. Quem
 * precisa desse volume em tempo real usa o GTM, onde isso é problema
 * resolvido.
 */
const SITE_PARA_SAIDA: Record<string, EventoSaida> = {
  checkout_abandoned: 'checkout.abandoned',
  generate_lead: 'checkout.started',
  add_payment_info: 'pix.created',
  pix_abandoned: 'pix.abandoned',
  purchase: 'order.paid',
};

export function eventoSaidaDoSite(siteEvent: string): EventoSaida | null {
  return SITE_PARA_SAIDA[siteEvent] ?? null;
}

/* ------------------------------------------------------------------ *
 * Referência
 * ------------------------------------------------------------------ */

/**
 * O que ancora o payload. Pelo menos um dos três precisa vir.
 *
 * `funnelEventId` é o que traz o bloco `site` (IP, user-agent, página,
 * referrer, sessão, visitante, params) — a parte que o dono chamou de "tudo
 * que estiver disponível no payload do nosso site".
 */
export interface RefSaida {
  orderId?: string;
  leadId?: string;
  funnelEventId?: string;
}

/* ------------------------------------------------------------------ *
 * Formato do corpo
 * ------------------------------------------------------------------ */

export interface BlocoSite {
  /** `event_id` do FunnelEvent — é a chave de deduplicação na Meta e aqui. */
  eventId: string | null;
  /** Nome interno do evento do site (`checkout_abandoned`, `purchase`, …). */
  siteEvent: string | null;
  at: string | null;
  page: string | null;
  referrer: string | null;
  /** UTM capturada pelo próprio site no momento do evento. */
  utm: Record<string, unknown> | null;
  sessionId: string | null;
  visitorId: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Resumo legível do user-agent, para não obrigar quem lê a interpretá-lo. */
  device: string | null;
  params: Record<string, unknown> | null;
  fbp: string | null;
  fbc: string | null;
  /** Resultado do envio às APIs de conversão: `{ meta: "ok (1)" }`. */
  forwarded: Record<string, unknown> | null;
}

export interface CorpoSaida {
  event: string;
  /** Identificador desta ocorrência. O destino usa para idempotência. */
  id: string;
  sentAt: string;
  site: BlocoSite | null;
  attribution: { utm: unknown; firstTouch: unknown } | null;
  order?: Record<string, unknown>;
  lead?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Auxiliares
 * ------------------------------------------------------------------ */

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Resumo do user-agent, do tipo "Android · Chrome".
 *
 * Não é detecção de dispositivo séria e não pretende ser: serve para o dono
 * bater o olho e saber se o abandono veio de celular. Quem precisar do dado
 * exato tem o user-agent cru logo ao lado no mesmo payload.
 */
export function describeDevice(ua: string | null): string | null {
  if (!ua) return null;
  const so = /iPhone|iPad/i.test(ua)
    ? 'iOS'
    : /Android/i.test(ua)
      ? 'Android'
      : /Windows/i.test(ua)
        ? 'Windows'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : null;
  // A ordem importa: o Edge e o Opera também dizem "Chrome" no user-agent.
  const nav = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\//i.test(ua)
      ? 'Opera'
      : /Chrome\//i.test(ua)
        ? 'Chrome'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Safari\//i.test(ua)
            ? 'Safari'
            : null;
  if (so && nav) return `${so} · ${nav}`;
  return so ?? nav;
}

/* ------------------------------------------------------------------ *
 * Montagem
 * ------------------------------------------------------------------ */

async function carregarSite(funnelEventId: string): Promise<BlocoSite | null> {
  const ev = await prisma.funnelEvent.findUnique({
    where: { id: funnelEventId },
    select: {
      eventId: true,
      event: true,
      createdAt: true,
      page: true,
      referrer: true,
      utm: true,
      sessionId: true,
      visitorId: true,
      ip: true,
      userAgent: true,
      params: true,
      forwarded: true,
    },
  });
  if (!ev) return null;

  // `fbp`/`fbc` são gravados dentro de `params` pela rota de ingestão
  // (`routes/track.ts`). Aqui eles sobem para o topo do bloco porque é onde
  // quem consome o webhook espera encontrá-los.
  const params = objeto(ev.params);

  return {
    eventId: ev.eventId,
    siteEvent: ev.event,
    at: ev.createdAt.toISOString(),
    page: ev.page,
    referrer: ev.referrer,
    utm: objeto(ev.utm),
    sessionId: ev.sessionId,
    visitorId: ev.visitorId,
    ip: ev.ip,
    userAgent: ev.userAgent,
    device: describeDevice(ev.userAgent),
    params,
    fbp: texto(params?.fbp),
    fbc: texto(params?.fbc),
    forwarded: objeto(ev.forwarded),
  };
}

/**
 * Monta o corpo canônico do evento.
 *
 * `event` é o nome que vai no corpo — o do webhook (`checkout.abandoned`)
 * quando há um, senão o do site (`page_view`), para a tela de Eventos poder
 * exibir payload de evento que não vai para webhook nenhum.
 *
 * Devolve `null` quando a referência não existe mais (pedido ou lead
 * apagado): quem chama decide se isso é aviso de log ou 404.
 */
export async function montarPayload(event: string, ref: RefSaida): Promise<CorpoSaida | null> {
  const base: CorpoSaida = {
    event,
    id: randomUUID(),
    sentAt: new Date().toISOString(),
    site: null,
    attribution: null,
  };

  if (ref.funnelEventId) {
    base.site = await carregarSite(ref.funnelEventId);
  }

  if (ref.orderId) {
    const order = await prisma.order.findUnique({
      where: { id: ref.orderId },
      select: {
        publicId: true,
        reference: true,
        amountCents: true,
        listAmountCents: true,
        discountCents: true,
        couponCode: true,
        currency: true,
        status: true,
        provider: true,
        providerPaymentId: true,
        createdAt: true,
        paidAt: true,
        expiresAt: true,
        refundedAt: true,
        utm: true,
        firstTouch: true,
        pixCharge: { select: { expiresAt: true } },
        lead: {
          select: {
            nome: true,
            email: true,
            fone: true,
            cpfLast3: true,
            status: true,
            visitorId: true,
            sessionId: true,
            firstTouch: true,
          },
        },
      },
    });
    if (!order) return null;

    return {
      ...base,
      attribution: {
        // A UTM do evento entra como último recurso: pedido criado antes de a
        // atribuição ser congelada ainda assim mostra de onde a visita veio.
        utm: order.utm ?? base.site?.utm ?? null,
        firstTouch: order.firstTouch ?? order.lead.firstTouch ?? null,
      },
      order: {
        reference: order.reference,
        publicId: order.publicId,
        amount: order.amountCents / 100,
        amountCents: order.amountCents,
        /**
         * Preço cheio, desconto e cupom viajam junto com o valor cobrado.
         *
         * Sem estes três, quem recebe o webhook vê uma venda de R$ 24,90 e
         * não tem como saber se o produto baixou de preço ou se houve cupom —
         * e a conciliação do CRM com o relatório do painel não fecha. Quando
         * não houve cupom, `listAmount` é igual a `amount` e `discount` é
         * zero, então integração já existente continua lendo o mesmo número.
         */
        listAmountCents: order.listAmountCents ?? order.amountCents,
        listAmount: (order.listAmountCents ?? order.amountCents) / 100,
        discountCents: order.discountCents,
        discount: order.discountCents / 100,
        coupon: order.couponCode,
        currency: order.currency,
        status: order.status,
        provider: order.provider,
        providerPaymentId: order.providerPaymentId,
        createdAt: order.createdAt.toISOString(),
        paidAt: order.paidAt?.toISOString() ?? null,
        expiresAt: (order.expiresAt ?? order.pixCharge?.expiresAt)?.toISOString() ?? null,
        refundedAt: order.refundedAt?.toISOString() ?? null,
        // Repetidos aqui dentro por compatibilidade: webhooks já cadastrados
        // leem `order.utm`, e tirar a chave quebraria integração em produção.
        utm: order.utm ?? null,
        firstTouch: order.firstTouch ?? order.lead.firstTouch ?? null,
      },
      lead: {
        nome: order.lead.nome,
        email: order.lead.email,
        fone: order.lead.fone,
        // Mascarado de propósito — ver a regra 1 no topo do arquivo.
        cpfMasked: order.lead.cpfLast3 ? maskCpf(order.lead.cpfLast3) : null,
        status: order.lead.status,
        visitorId: order.lead.visitorId,
        sessionId: order.lead.sessionId,
      },
    };
  }

  if (ref.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: ref.leadId },
      select: {
        nome: true,
        email: true,
        fone: true,
        cpfLast3: true,
        status: true,
        visitorId: true,
        sessionId: true,
        utm: true,
        firstTouch: true,
        createdAt: true,
      },
    });
    if (!lead) return null;

    return {
      ...base,
      attribution: {
        utm: lead.utm ?? base.site?.utm ?? null,
        firstTouch: lead.firstTouch ?? null,
      },
      lead: {
        nome: lead.nome,
        email: lead.email,
        fone: lead.fone,
        cpfMasked: lead.cpfLast3 ? maskCpf(lead.cpfLast3) : null,
        status: lead.status,
        visitorId: lead.visitorId,
        sessionId: lead.sessionId,
        utm: lead.utm ?? null,
        firstTouch: lead.firstTouch ?? null,
        createdAt: lead.createdAt.toISOString(),
      },
    };
  }

  // Sobrou o evento puro de site (`page_view`, e o `checkout_abandoned` de
  // quem nunca chegou a virar lead). Aqui a atribuição não pode vir de
  // pedido nem de lead — mas a pergunta "de onde veio?" continua tendo
  // resposta: a UTM que o próprio evento carrega, e o first-touch derivado
  // do visitante. Sem isso o payload do abandono, que é justamente o que o
  // dono abre para saber qual campanha perdeu a venda, sairia sem origem.
  if (!base.site) return null;
  base.attribution = {
    utm: base.site.utm,
    firstTouch: await firstTouchDoVisitante(base.site.visitorId),
  };
  return base;
}
