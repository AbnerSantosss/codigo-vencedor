import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { getSiteConfig } from './config.js';
import { firstTouchDoVisitante } from '../lib/attribution.js';
import { renderTemplate } from './emailTemplates.js';
import { sendMail } from './mailer.js';
import { dispatchOutbound, type EventoSaida, type RefSaida } from './outbound.js';

/**
 * Recuperação de vendas.
 *
 * Dois abandonos, dois e-mails, cada um enviado UMA vez:
 *
 *  - **Checkout abandonado** — a pessoa digitou nome e e-mail válidos e não
 *    enviou o formulário. O lead existe como rascunho (`status = draft`).
 *  - **Pix abandonado** — enviou o formulário, o Pix foi gerado e venceu sem
 *    pagamento. O pedido está `expired` (ou `pending` já passado do prazo).
 *
 * O "uma vez" é garantido pela coluna `recoveryEmailAt`: o job só olha para
 * quem tem esse campo nulo, e o grava antes de enviar. Se o envio falhar, o
 * campo fica gravado mesmo assim — melhor deixar de mandar um e-mail do que
 * mandar dez para a mesma pessoa a cada rodada do job.
 */

export interface Log {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}

/**
 * Logger de última instância.
 *
 * `runRecovery()` também é chamado pelo botão "rodar agora" do painel, que não
 * tem `req.log` à mão. Sem este padrão a assinatura viraria obrigatória e a
 * rota do painel teria que ser mexida — e ela é de outro agente.
 */
const SEM_LOG: Log = { info: () => undefined, warn: () => undefined };

/**
 * Minutos parado até o rascunho virar abandono de checkout.
 *
 * Número dado pelo dono, textual: "checkout abandonado, quando o cliente
 * começa a preencher e fecha a tela ou depois de 10 minutos". É **independente**
 * de `checkoutAbandonedAfterMin` (padrão 30), que decide quando o *e-mail* de
 * recuperação sai: o evento precisa chegar cedo ao dashboard e ao CRM, o
 * e-mail espera mais para não atropelar quem só foi buscar o celular.
 */
const ABANDONO_CHECKOUT_APOS_MIN = 10;

/**
 * Teto por rodada, igual aos outros passos: o job roda a cada minuto e uma
 * fila grande se resolve sozinha na rodada seguinte. O que não pode é uma
 * rodada tentar processar tudo e travar o processo.
 */
const TETO_POR_RODADA = 100;

/**
 * `eventId` determinístico.
 *
 * O `@unique` de `FunnelEvent.eventId` é a única trava contra o mesmo abandono
 * entrar duas vezes se a rodada se repetir (reinício no meio, duas instâncias,
 * `run` manual do painel logo depois do job). Derivando o id do id do registro
 * de origem, a segunda gravação é descartada pelo banco em vez de virar um
 * evento novo. Cortado em 32 hex porque o campo aceita 64 e o resto é enfeite.
 */
function eventIdDerivado(prefixo: string, id: string): string {
  return `${prefixo}${createHash('sha1').update(id).digest('hex').slice(0, 32)}`;
}

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Primeiro nome para o e-mail.
 *
 * O rascunho passou a nascer só com e-mail (a LP dispara quando o e-mail fica
 * válido, antes do nome), então `nome` pode ser string vazia — e "Oi, ." é
 * pior do que qualquer aproximação. Cai para a parte antes do `@`, que é o
 * que a pessoa mesma escolheu.
 */
function primeiroNome(lead: { nome: string; email: string }): string {
  const doNome = lead.nome.trim().split(/\s+/)[0];
  if (doNome) return doNome;
  return lead.email.split('@')[0] ?? lead.email;
}

async function supportLine(): Promise<string> {
  const cfg = await getSiteConfig();
  const digits = cfg.links.whatsapp.number.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : cfg.email.fromEmail || cfg.email.smtp.user || '';
}

/* ------------------------------------------------------------------ *
 * Rascunho de lead
 * ------------------------------------------------------------------ */

export interface DraftInput {
  /**
   * Pode vir vazio: a LP dispara o rascunho assim que o **e-mail** fica
   * válido, que costuma ser antes de o nome estar preenchido. É o que o dono
   * pediu — "se tiver pelo menos o email salva o evento com email ou qualquer
   * outro dado que ele preencher".
   */
  nome?: string;
  email: string;
  utm?: Record<string, string>;
  sessionId?: string;
  /** Cookie de primeira parte, lido pelo servidor. Ver `lib/visitor.ts`. */
  visitorId?: string;
  fbp?: string;
  fbc?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * Grava (ou atualiza) o rascunho de quem começou a preencher.
 *
 * Chave: e-mail. Quem volta e digita de novo atualiza o mesmo registro em
 * vez de criar outro — e quem já é lead completo não vira rascunho.
 */
export async function upsertDraftLead(input: DraftInput, log: Log = SEM_LOG): Promise<{ id: string; status: string }> {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.lead.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, firstTouch: true },
  });

  /**
   * O nome só entra quando existe.
   *
   * `Lead.nome` é obrigatório no schema, então o rascunho sem nome nasce com
   * string vazia — mas no `update` a chave é omitida: quem digitou o nome
   * numa passagem anterior e voltou não pode perdê-lo porque o disparo desta
   * vez saiu do campo de e-mail, antes do nome.
   */
  const nome = input.nome?.trim() ?? '';
  const doFormulario: Record<string, unknown> = nome ? { nome } : {};

  /**
   * O resto só entra quando **há** valor.
   *
   * Este objeto é aplicado tanto no `create` quanto no `update`, e com
   * `?? null` o segundo rascunho apagava o que o primeiro havia gravado
   * certo — é o mesmo defeito que o submit tinha. Acontece de verdade aqui:
   * o rascunho é disparado no `blur` do e-mail, que pode ocorrer antes de o
   * cookie do Pixel existir, e numa segunda aba o `fbc` viria vazio e
   * zeraria o que já estava salvo.
   */
  const doNavegador: Record<string, unknown> = {};
  if (input.utm && Object.keys(input.utm).length) doNavegador.utm = input.utm as Prisma.InputJsonValue;
  if (input.fbp) doNavegador.fbp = input.fbp;
  if (input.fbc) doNavegador.fbc = input.fbc;
  if (input.ip) doNavegador.ip = input.ip;
  if (input.userAgent) doNavegador.userAgent = input.userAgent.slice(0, 300);
  if (input.sessionId) doNavegador.sessionId = input.sessionId;
  if (input.visitorId) doNavegador.visitorId = input.visitorId;

  /* Primeira origem: gravada uma vez, nunca sobrescrita. */
  if (!existing?.firstTouch) {
    const primeira = await firstTouchDoVisitante(input.visitorId ?? null);
    if (primeira) doNavegador.firstTouch = primeira as unknown as Prisma.InputJsonValue;
  }

  if (existing) {
    // Um lead completo continua completo; só o rascunho ganha os dados novos.
    if (existing.status === 'complete') return { id: existing.id, status: existing.status };
    await prisma.lead.update({
      where: { id: existing.id },
      data: { ...doFormulario, ...doNavegador },
    });
    return { id: existing.id, status: existing.status };
  }

  const created = await prisma.lead.create({
    data: {
      nome,
      ...doFormulario,
      email,
      status: 'draft',
      cpfEnc: null,
      cpfLast3: null,
      fone: null,
      ...doNavegador,
    },
    select: { id: true, status: true },
  });

  /**
   * `lead.created` sai só na **criação**.
   *
   * O rascunho é reenviado a cada `blur` do formulário; disparar no `update`
   * mandaria o mesmo lead cinco vezes para o CRM de quem integra. Sem `await`
   * e com `.catch()`: a captura do lead não pode depender de um webhook de
   * terceiro estar de pé.
   */
  dispatchOutbound('lead.created', { leadId: created.id }, log).catch((err) =>
    log.warn({ err, leadId: created.id }, 'falha ao enfileirar webhook de saída'),
  );

  return created;
}

/* ------------------------------------------------------------------ *
 * Envios
 * ------------------------------------------------------------------ */

export async function sendPurchaseApproved(orderId: string): Promise<boolean> {
  const cfg = await getSiteConfig();
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { lead: true } });
  if (!order) return false;

  const tpl = renderTemplate(cfg.email.templates.purchase_approved, {
    nome: order.lead.nome.split(' ')[0],
    email: order.lead.email,
    pedido: order.reference,
    valor: brl(order.amountCents),
    link_acesso: cfg.email.accessUrl || env.PUBLIC_URL,
    suporte: await supportLine(),
  });

  const res = await sendMail({
    to: order.lead.email,
    subject: tpl.subject,
    text: tpl.body,
    template: 'purchase_approved',
    orderId: order.id,
  });
  return res.ok;
}

async function sendCheckoutAbandoned(lead: { id: string; nome: string; email: string }): Promise<boolean> {
  const cfg = await getSiteConfig();
  const tpl = renderTemplate(cfg.email.templates.checkout_abandoned, {
    nome: primeiroNome(lead),
    valor: brl(cfg.content.priceCents),
    link_checkout: `${env.PUBLIC_URL}/?utm_source=email&utm_medium=recuperacao&utm_campaign=checkout#checkout`,
    suporte: await supportLine(),
  });
  const res = await sendMail({ to: lead.email, subject: tpl.subject, text: tpl.body, template: 'checkout_abandoned' });
  return res.ok;
}

async function sendPixAbandoned(order: { id: string; reference: string; amountCents: number; lead: { nome: string; email: string } }): Promise<boolean> {
  const cfg = await getSiteConfig();
  const tpl = renderTemplate(cfg.email.templates.pix_abandoned, {
    nome: order.lead.nome.split(' ')[0],
    pedido: order.reference,
    valor: brl(order.amountCents),
    link_checkout: `${env.PUBLIC_URL}/?utm_source=email&utm_medium=recuperacao&utm_campaign=pix#checkout`,
    suporte: await supportLine(),
  });
  const res = await sendMail({
    to: order.lead.email,
    subject: tpl.subject,
    text: tpl.body,
    template: 'pix_abandoned',
    orderId: order.id,
  });
  return res.ok;
}

/* ------------------------------------------------------------------ *
 * Job
 * ------------------------------------------------------------------ */

/**
 * Grava um evento de funil nascido no servidor e enfileira o webhook dele.
 *
 * `createMany` de uma linha só, pelo `skipDuplicates`: com o `eventId`
 * determinístico, o `@unique` do banco é quem garante que a mesma rodada
 * repetida não gere um segundo evento — e o `count` é o que diz se a linha
 * entrou agora. Sem essa leitura, um `run` manual do painel logo depois do
 * job mandaria o mesmo abandono duas vezes para o CRM de quem integra.
 *
 * O id interno vem de uma leitura extra porque `createMany` não o devolve, e
 * é ele que traz o bloco `site` (IP, user-agent, página, sessão, params) para
 * o corpo do webhook.
 */
async function gravarEDisparar(
  evento: EventoSaida,
  dados: Prisma.FunnelEventCreateManyInput,
  ref: RefSaida,
  log: Log,
): Promise<boolean> {
  const { count } = await prisma.funnelEvent.createMany({ skipDuplicates: true, data: [dados] });
  if (count === 0) return false;

  const gravado = await prisma.funnelEvent.findUnique({ where: { eventId: dados.eventId }, select: { id: true } });

  dispatchOutbound(evento, { ...ref, ...(gravado ? { funnelEventId: gravado.id } : {}) }, log).catch((err) =>
    log.warn({ err, evento, eventId: dados.eventId }, 'falha ao enfileirar webhook de saída'),
  );

  return true;
}

/**
 * Cobrança vencida vira `expired` — e vira `pix_abandoned`.
 *
 * Os ids são lidos **antes** do `updateMany`: depois dele não há mais como
 * saber quais pedidos morreram nesta rodada; na rodada seguinte eles são só
 * "expirados", indistinguíveis dos de ontem, e o evento nunca sairia.
 *
 * A leitura prévia trouxe junto o teto por rodada. Em troca, um acúmulo maior
 * que o teto leva alguns minutos a mais para expirar — aceitável num job de
 * 60s, e melhor do que expirar em massa sem registrar abandono nenhum.
 *
 * O evento fica no histórico mesmo quando o Pix cai atrasado:
 * `confirmarPagamento` aceita `expired → paid` de propósito, e o dashboard
 * trata isso como recuperação. Apagar o evento é que estragaria a conta.
 */
async function expirarPixVencido(now: Date, log: Log): Promise<{ expirados: number; eventos: number }> {
  const candidatos = await prisma.order.findMany({
    where: { status: 'pending', expiresAt: { lt: now } },
    take: TETO_POR_RODADA,
    select: { id: true },
  });
  if (candidatos.length === 0) return { expirados: 0, eventos: 0 };

  const ids = candidatos.map((o) => o.id);

  const { count } = await prisma.order.updateMany({
    where: { id: { in: ids }, status: 'pending' },
    data: { status: 'expired' },
  });

  /* Relê já com o status novo: um pedido pago entre a leitura e a escrita não
     aparece aqui, e não pode virar "Pix abandonado". */
  const expirados = await prisma.order.findMany({
    where: { id: { in: ids }, status: 'expired' },
    select: {
      id: true,
      reference: true,
      amountCents: true,
      provider: true,
      expiresAt: true,
      leadId: true,
      lead: { select: { sessionId: true, visitorId: true, ip: true, userAgent: true, utm: true } },
    },
  });

  let eventos = 0;

  for (const order of expirados) {
    const criou = await gravarEDisparar(
      'pix.abandoned',
      {
        eventId: eventIdDerivado('pxa_', order.id),
        event: 'pix_abandoned',
        orderId: order.id,
        leadId: order.leadId,
        sessionId: order.lead.sessionId,
        visitorId: order.lead.visitorId,
        ip: order.lead.ip,
        userAgent: order.lead.userAgent,
        utm: (order.lead.utm ?? {}) as Prisma.InputJsonValue,
        page: '/',
        params: {
          reference: order.reference,
          amount_cents: order.amountCents,
          provider: order.provider,
          expires_at: order.expiresAt?.toISOString() ?? null,
        } as Prisma.InputJsonValue,
      },
      { orderId: order.id, leadId: order.leadId },
      log,
    );
    if (criou) eventos++;
  }

  return { expirados: count, eventos };
}

/**
 * Abandono de checkout pelo relógio.
 *
 * A outra metade da regra do dono: o navegador manda `checkout_abandoned` ao
 * fechar a tela, mas quem deixa a aba aberta e some não dispara `pagehide`
 * nenhum. Passados 10 minutos sem toque no rascunho, o servidor registra o
 * abandono com o que a pessoa chegou a preencher.
 */
async function emitirCheckoutAbandonado(now: Date, log: Log): Promise<number> {
  const corte = new Date(now.getTime() - ABANDONO_CHECKOUT_APOS_MIN * 60_000);

  const rascunhos = await prisma.lead.findMany({
    where: {
      status: 'draft',
      updatedAt: { lt: corte },
      /* Rascunho que virou Pix não é abandono de checkout: quem gerou a
         cobrança chegou ao fim do formulário, e o abandono dele é o
         `pix_abandoned`. */
      orders: { none: {} },
      /* Já registrado — pelo navegador, ou por uma rodada anterior. */
      funnelEvents: { none: { event: 'checkout_abandoned' } },
    },
    take: TETO_POR_RODADA,
    select: {
      id: true,
      nome: true,
      email: true,
      fone: true,
      cpfLast3: true,
      sessionId: true,
      visitorId: true,
      ip: true,
      userAgent: true,
      utm: true,
    },
  });
  if (rascunhos.length === 0) return 0;

  /**
   * Segunda checagem, por sessão.
   *
   * O evento do navegador pode ter chegado **antes** de o rascunho existir
   * (o `pagehide` e o `blur` disputam), e nesse caso ele está gravado com a
   * sessão e sem `leadId` — invisível para o filtro por relação acima.
   */
  const sessoes = rascunhos.map((l) => l.sessionId).filter((s): s is string => Boolean(s));
  const jaPorSessao = new Set<string | null>(
    sessoes.length === 0
      ? []
      : (
          await prisma.funnelEvent.findMany({
            where: { event: 'checkout_abandoned', sessionId: { in: sessoes } },
            select: { sessionId: true },
          })
        ).map((e) => e.sessionId),
  );

  let emitidos = 0;

  for (const lead of rascunhos) {
    if (lead.sessionId && jaPorSessao.has(lead.sessionId)) continue;

    /* Só o que a pessoa realmente preencheu. O e-mail existe sempre: é ele
       que cria o rascunho. */
    const preenchidos: string[] = ['email'];
    if (lead.nome.trim()) preenchidos.push('nome');
    if (lead.fone) preenchidos.push('fone');
    if (lead.cpfLast3) preenchidos.push('cpf_last3');

    const criou = await gravarEDisparar(
      'checkout.abandoned',
      {
        eventId: eventIdDerivado('cka_', lead.id),
        event: 'checkout_abandoned',
        leadId: lead.id,
        sessionId: lead.sessionId,
        visitorId: lead.visitorId,
        ip: lead.ip,
        userAgent: lead.userAgent,
        utm: (lead.utm ?? {}) as Prisma.InputJsonValue,
        page: '/',
        params: {
          reason: 'inatividade_10min',
          has_email: true,
          email: lead.email,
          nome: lead.nome,
          fone: lead.fone ?? '',
          /* Três dígitos, nunca o documento: o CPF completo só existe cifrado
             em `Lead.cpfEnc` e não sai daqui nem para o webhook. */
          cpf_last3: lead.cpfLast3 ?? '',
          fields_filled: preenchidos,
        } as Prisma.InputJsonValue,
      },
      { leadId: lead.id },
      log,
    );
    if (criou) emitidos++;
  }

  return emitidos;
}

export interface RecoveryRun {
  expired: number;
  checkoutEmails: number;
  pixEmails: number;
  /** Eventos `checkout_abandoned` criados pela regra dos 10 minutos. */
  checkoutAbandonedEvents: number;
  /** Eventos `pix_abandoned` criados junto com a expiração da cobrança. */
  pixAbandonedEvents: number;
}

/**
 * Uma rodada do job. Idempotente: rodar duas vezes seguidas não envia nada
 * na segunda.
 */
export async function runRecovery(log: Log = SEM_LOG): Promise<RecoveryRun> {
  const cfg = await getSiteConfig();
  const now = new Date();
  const out: RecoveryRun = {
    expired: 0,
    checkoutEmails: 0,
    pixEmails: 0,
    checkoutAbandonedEvents: 0,
    pixAbandonedEvents: 0,
  };

  /* 1. Pix pendente que passou do prazo vira expirado — e vira evento. */
  const expiracao = await expirarPixVencido(now, log);
  out.expired = expiracao.expirados;
  out.pixAbandonedEvents = expiracao.eventos;

  /* 2. Abandono de checkout pelo relógio: rascunho parado há 10 minutos.
     Fica ANTES do corte por provedor de e-mail de propósito — o evento
     alimenta dashboard e webhook, que existem mesmo sem e-mail configurado. */
  out.checkoutAbandonedEvents = await emitirCheckoutAbandonado(now, log);

  if (cfg.email.provider === 'none') return out;

  /* 2. Checkout abandonado: rascunho parado há mais de N minutos. */
  if (cfg.email.recovery.checkoutAbandonedEnabled) {
    const cutoff = new Date(now.getTime() - cfg.email.recovery.checkoutAbandonedAfterMin * 60_000);
    const drafts = await prisma.lead.findMany({
      where: { status: 'draft', recoveryEmailAt: null, updatedAt: { lt: cutoff } },
      take: 50,
      select: { id: true, nome: true, email: true },
    });

    for (const lead of drafts) {
      // Marca antes de enviar: nunca duas vezes para a mesma pessoa.
      await prisma.lead.update({ where: { id: lead.id }, data: { recoveryEmailAt: now } });
      if (await sendCheckoutAbandoned(lead)) out.checkoutEmails++;
    }
  }

  /* 3. Pix abandonado: expirado há mais de N minutos, sem outro pedido pago. */
  if (cfg.email.recovery.pixAbandonedEnabled) {
    const cutoff = new Date(now.getTime() - cfg.email.recovery.pixAbandonedAfterMin * 60_000);
    const orders = await prisma.order.findMany({
      where: {
        status: 'expired',
        recoveryEmailAt: null,
        expiresAt: { lt: cutoff },
        // Se a pessoa gerou outro Pix depois e pagou, não faz sentido cobrar.
        lead: { orders: { none: { status: 'paid' } } },
      },
      take: 50,
      include: { lead: { select: { nome: true, email: true } } },
    });

    for (const order of orders) {
      await prisma.order.update({ where: { id: order.id }, data: { recoveryEmailAt: now } });
      if (await sendPixAbandoned(order)) out.pixEmails++;
    }
  }

  return out;
}

/** Liga o job no boot. Roda a cada minuto; erros só vão para o log. */
export function startRecoveryJob(log: Log): void {
  const tick = async () => {
    try {
      const r = await runRecovery(log);
      if (r.expired || r.checkoutEmails || r.pixEmails || r.checkoutAbandonedEvents || r.pixAbandonedEvents) {
        log.info(r, 'recuperação: rodada concluída');
      }
    } catch (err) {
      log.warn({ err }, 'recuperação: falha na rodada');
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
