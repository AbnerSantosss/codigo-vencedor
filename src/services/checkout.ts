import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { resolveGateway } from '../gateways/index.js';
import { getSiteConfig } from './config.js';
import { encrypt } from './crypto.js';
import { validarCupom, consumirCupom, devolverCupom, normalizarCodigo } from './coupons.js';
import { newReference } from '../lib/cpf.js';
import { firstTouchDoVisitante } from '../lib/attribution.js';
import { dispatchOutbound } from './outbound.js';

interface Log {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}

/** Logger de última instância, para quem chamar sem passar um. */
const SEM_LOG: Log = { info: () => undefined, warn: () => undefined };

export interface CheckoutInput {
  nome: string;
  email: string;
  /** Só dígitos. */
  cpf: string;
  /** Só dígitos. */
  fone: string;
  /** Origem da visita atual (last-touch). */
  utm?: Record<string, string>;
  sessionId?: string;
  /** Cookie de primeira parte, lido pelo servidor. Ver `lib/visitor.ts`. */
  visitorId?: string;
  fbp?: string;
  fbc?: string;
  ip?: string;
  userAgent?: string;
  /**
   * `event_id` do evento que o navegador acabou de disparar
   * (`add_payment_info`). Só serve para achar o `FunnelEvent` correspondente e
   * anexar o bloco `site` ao webhook `pix.created`; a cobrança não depende
   * dele.
   */
  eventId?: string;
  /**
   * Código de cupom digitado pela pessoa, cru, do jeito que veio do campo.
   *
   * O valor do desconto **não** vem daqui — vem do banco. A página manda o
   * código; quem calcula o preço é o servidor. Um cupom inválido no momento
   * da compra (desativado, expirado ou esgotado entre o "Aplicar" e o "Gerar
   * Pix") não derruba a venda: o pedido sai pelo preço cheio e o motivo volta
   * em `couponError`.
   */
  cupom?: string;
}

export interface CheckoutResult {
  /** Id interno do pedido. Nao vai para o navegador — serve para o servidor
   *  ligar os eventos do funil a este pedido. O publico e o `orderPublicId`. */
  orderId: string;
  /** Idem: liga os eventos do funil a esta pessoa. */
  leadId: string;
  orderPublicId: string;
  reference: string;
  /** O que vai ser cobrado de fato — já com o cupom abatido, se houver. */
  amountCents: number;
  /** Preço cheio. Igual a `amountCents` quando não houve cupom. */
  listAmountCents: number;
  /** Quanto o cupom abateu. Zero quando não houve cupom. */
  discountCents: number;
  /** Código do cupom que valeu, normalizado. `null` quando não houve. */
  couponCode: string | null;
  /**
   * Motivo de o cupom digitado não ter sido aplicado, quando foi o caso. A LP
   * usa para avisar "o cupom expirou, o pedido saiu pelo preço cheio" em vez
   * de a pessoa descobrir sozinha na hora de pagar.
   */
  couponError: string | null;
  emv: string;
  qrCodeBase64: string | null;
  expiresAt: string;
  simulated: boolean;
}

/**
 * Gera um `reference` único.
 *
 * São 28^6 combinações; colisão é improvável, mas "improvável" não é
 * "impossível" e o campo é único no banco. Três tentativas antes de desistir
 * evitam que uma venda falhe por azar.
 */
async function uniqueReference(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = newReference();
    const taken = await prisma.order.findUnique({ where: { reference: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Último recurso: sufixo temporal, feio mas garantidamente livre.
  return `${newReference()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

export async function createCheckout(input: CheckoutInput, log: Log = SEM_LOG): Promise<CheckoutResult> {
  const cfg = await getSiteConfig();
  const gateway = await resolveGateway();

  const cpfLast3 = input.cpf.slice(-3);

  /**
   * O lead é reaproveitado por e-mail + CPF: quem tenta comprar duas vezes é
   * a mesma pessoa, e duplicar o cadastro estragaria a contagem de leads.
   * O CPF é regravado cifrado a cada passagem — a cifra tem IV aleatório, e
   * comparar por ela não funcionaria.
   */
  /**
   * Procura primeiro pelo par e-mail + CPF (mesma pessoa completando de
   * novo); se não achar, procura um rascunho com o mesmo e-mail — é o caso
   * de quem começou, saiu e voltou. Nos dois casos o registro é reaproveitado
   * e vira `complete`; um rascunho que virou compra deixa de contar como
   * abandono.
   */
  const existing =
    (await prisma.lead.findFirst({
      where: { email: input.email, cpfLast3 },
      orderBy: { createdAt: 'desc' },
    })) ??
    (await prisma.lead.findFirst({
      where: { email: input.email, status: 'draft' },
      orderBy: { createdAt: 'desc' },
    }));

  /* O que o submit sempre sabe melhor: ele acabou de ser digitado. */
  const dadosDoFormulario = {
    nome: input.nome,
    email: input.email,
    status: 'complete' as const,
    cpfEnc: encrypt(input.cpf),
    cpfLast3,
    fone: input.fone,
  };

  /**
   * O que o submit pode não saber, e o rascunho pode já ter guardado.
   *
   * Estes campos nascem no navegador (`sessionStorage`, cookies do Pixel) e o
   * rascunho os envia no `blur` do e-mail. Se o objeto abaixo fosse aplicado
   * com `null` no `update`, o submit **apagaria** o que o rascunho gravou
   * certo — era o defeito. Por isso a chave só entra quando há valor.
   *
   * Consequência de não corrigir: `Lead.sessionId` ficava sempre nulo, o
   * `purchase` nascia sem sessão, o funil (que filtra `sessionId IS NOT NULL`)
   * mostrava zero em "Pagaram", e o `Purchase` ia para a Meta sem `fbp`/`fbc`
   * — justamente na conversão que mais importa para o casamento.
   */
  const doNavegador: Record<string, unknown> = {};
  if (input.utm && Object.keys(input.utm).length) doNavegador.utm = input.utm as Prisma.InputJsonValue;
  if (input.fbp) doNavegador.fbp = input.fbp;
  if (input.fbc) doNavegador.fbc = input.fbc;
  if (input.ip) doNavegador.ip = input.ip;
  if (input.userAgent) doNavegador.userAgent = input.userAgent.slice(0, 300);
  if (input.sessionId) doNavegador.sessionId = input.sessionId;
  if (input.visitorId) doNavegador.visitorId = input.visitorId;

  /**
   * A primeira origem é gravada **uma vez** e nunca sobrescrita.
   *
   * Só é calculada quando ainda não há: se o rascunho já congelou a primeira
   * visita, o submit não pode reescrevê-la — senão `firstTouch` viraria mais
   * uma cópia do last-touch e perderia todo o sentido.
   */
  if (!existing?.firstTouch) {
    const primeira = await firstTouchDoVisitante(input.visitorId ?? null);
    if (primeira) doNavegador.firstTouch = primeira as unknown as Prisma.InputJsonValue;
  }

  const lead = existing
    ? await prisma.lead.update({
        where: { id: existing.id },
        data: { ...dadosDoFormulario, ...doNavegador },
      })
    : await prisma.lead.create({
        data: {
          ...dadosDoFormulario,
          utm: {} as Prisma.InputJsonValue,
          fbp: null,
          fbc: null,
          ip: null,
          userAgent: null,
          sessionId: null,
          ...doNavegador,
        },
      });

  const reference = await uniqueReference();

  /**
   * Cupom: confere e **gasta** antes de criar o pedido.
   *
   * A ordem importa. Gastar depois de criar deixaria o pedido existindo com
   * desconto enquanto o uso ainda não foi contado — e duas pessoas usando o
   * último uso ao mesmo tempo levariam as duas. Gastar antes faz o banco
   * decidir quem ficou com o uso, e quem perdeu compra pelo preço cheio.
   *
   * A reconferência aqui não é redundante com a da rota de pré-visualização:
   * entre digitar o cupom e apertar "Gerar Pix" passa tempo real, suficiente
   * para o dono desativar o cupom no painel.
   */
  const listAmountCents = cfg.content.priceCents;
  let amountCents = listAmountCents;
  let discountCents = 0;
  let couponCode: string | null = null;
  let couponError: string | null = null;

  if (input.cupom && input.cupom.trim()) {
    const conferido = await validarCupom(input.cupom, listAmountCents);
    if (!conferido.ok) {
      couponError = conferido.erro;
      log.info({ cupom: normalizarCodigo(input.cupom), motivo: conferido.erro }, 'cupom recusado no checkout');
    } else if (await consumirCupom(conferido.cupom.code)) {
      amountCents = conferido.cupom.amountCents;
      discountCents = conferido.cupom.discountCents;
      couponCode = conferido.cupom.code;
    } else {
      /* Perdeu a corrida pelo último uso, ou o cupom saiu do ar entre a
         conferência e o `UPDATE`. Venda segue, sem desconto. */
      couponError = 'esgotado';
      log.info({ cupom: conferido.cupom.code }, 'cupom esgotou entre conferir e gastar');
    }
  }

  const order = await prisma.order.create({
    data: {
      reference,
      leadId: lead.id,
      amountCents,
      listAmountCents,
      discountCents,
      couponCode,
      currency: cfg.content.currency,
      status: 'pending',
      provider: cfg.gatewayActive,
      utm: (input.utm ?? {}) as Prisma.InputJsonValue,
      /**
       * A primeira origem é copiada do `Lead` para o pedido, e é isso que
       * torna o relatório reproduzível: o `Lead` continua recebendo visitas
       * depois da venda, então ler a atribuição de lá faria o mesmo
       * relatório mudar de resposta com o tempo.
       *
       * Espalhado condicionalmente em vez de `firstTouch: … ?? Prisma.DbNull`
       * porque num `create` o campo ausente já nasce nulo — e assim o
       * `Prisma` continua sendo só `import type`, sem virar import de valor
       * apenas para escrever "nulo".
       */
      ...(lead.firstTouch ? { firstTouch: lead.firstTouch as Prisma.InputJsonValue } : {}),
      expiresAt: new Date(Date.now() + cfg.pixExpiresMin * 60_000),
    },
  });

  /**
   * Se o gateway recusar, o uso do cupom volta.
   *
   * Sem isto, cada tentativa que morre no provedor queimaria um uso de um
   * cupom limitado — e um cupom de uso único ficaria gasto sem nenhuma venda
   * existir. O pedido criado acima fica como `pending` e expira sozinho, que
   * é o comportamento que já havia antes do cupom.
   */
  let charge;
  try {
    charge = await gateway.createPixCharge({
      order,
      customer: {
        nome: input.nome,
        email: input.email,
        cpf: input.cpf,
        fone: input.fone,
        // A Appmax exige o IP para criar o cliente; os outros adaptadores
        // ignoram o campo.
        ip: input.ip,
      },
      expiresInMin: cfg.pixExpiresMin,
    });
  } catch (err) {
    if (couponCode) {
      await devolverCupom(couponCode).catch(() => undefined);
      log.warn({ cupom: couponCode, orderId: order.id }, 'uso do cupom devolvido: gateway recusou a cobrança');
    }
    throw err;
  }

  await prisma.$transaction([
    prisma.pixCharge.create({
      data: {
        orderId: order.id,
        emv: charge.emv,
        qrCodeBase64: charge.qrCodeBase64,
        expiresAt: charge.expiresAt,
        raw: { simulated: charge.simulated, gateway: gateway.id } as Prisma.InputJsonValue,
      },
    }),
    prisma.order.update({
      where: { id: order.id },
      data: {
        providerOrderId: charge.providerOrderId,
        providerPaymentId: charge.providerPaymentId,
        expiresAt: charge.expiresAt,
      },
    }),
  ]);

  /**
   * Dois webhooks, um momento só — e é de propósito.
   *
   * "Formulário enviado" (`checkout.started`) e "cobrança gerada"
   * (`pix.created`) acontecem na mesma requisição hoje, mas são perguntas
   * diferentes para quem integra CRM: a primeira é a intenção de compra com
   * os dados completos, a segunda é o meio de pagamento existindo. Se um dia
   * entrar cartão, a primeira continua valendo e a segunda não.
   *
   * Sem `await` e com `.catch()`, como no resto do projeto: uma venda já
   * criada não pode falhar porque o n8n de alguém está fora do ar.
   */
  dispatchOutbound('checkout.started', { orderId: order.id, leadId: lead.id }, log).catch((err) =>
    log.warn({ err, orderId: order.id }, 'falha ao enfileirar webhook de saída'),
  );

  /**
   * O `pix.created` sai depois de tentar achar o `FunnelEvent` do navegador —
   * é ele que traz o bloco `site` (IP, user-agent, página, sessão, fbp/fbc)
   * para o corpo do webhook.
   *
   * A busca fica **dentro** do encadeamento sem `await`: o comprador não pode
   * esperar por ela. E se o evento ainda não estiver gravado (o `sendBeacon`
   * do navegador e este POST correm juntos), o webhook sai sem o bloco `site`
   * em vez de não sair — perder o disparo seria bem pior do que perder o
   * detalhe.
   */
  const eventoDoNavegador = input.eventId
    ? prisma.funnelEvent.findUnique({ where: { eventId: input.eventId }, select: { id: true } }).catch(() => null)
    : Promise.resolve(null);

  eventoDoNavegador
    .then((ev) =>
      dispatchOutbound(
        'pix.created',
        { orderId: order.id, leadId: lead.id, ...(ev ? { funnelEventId: ev.id } : {}) },
        log,
      ),
    )
    .catch((err) => log.warn({ err, orderId: order.id }, 'falha ao enfileirar webhook de saída'));

  return {
    orderId: order.id,
    leadId: lead.id,
    orderPublicId: order.publicId,
    reference: order.reference,
    amountCents: order.amountCents,
    listAmountCents,
    discountCents,
    couponCode,
    couponError,
    emv: charge.emv,
    qrCodeBase64: charge.qrCodeBase64,
    expiresAt: charge.expiresAt.toISOString(),
    simulated: charge.simulated,
  };
}

/** Uma cobrança é de demonstração quando foi gravada assim na criação. */
export function isSimulatedCharge(raw: unknown): boolean {
  return Boolean(raw && typeof raw === 'object' && (raw as { simulated?: unknown }).simulated === true);
}
