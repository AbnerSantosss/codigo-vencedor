import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { getSiteConfig } from './config.js';
import { firstTouchDoVisitante } from '../lib/attribution.js';
import { renderTemplate } from './emailTemplates.js';
import { sendMail } from './mailer.js';

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

const brl = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function supportLine(): Promise<string> {
  const cfg = await getSiteConfig();
  const digits = cfg.links.whatsapp.number.replace(/\D/g, '');
  return digits ? `https://wa.me/${digits}` : cfg.email.fromEmail || cfg.email.smtp.user || '';
}

/* ------------------------------------------------------------------ *
 * Rascunho de lead
 * ------------------------------------------------------------------ */

export interface DraftInput {
  nome: string;
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
export async function upsertDraftLead(input: DraftInput): Promise<{ id: string; status: string }> {
  const email = input.email.toLowerCase().trim();

  const existing = await prisma.lead.findFirst({
    where: { email },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, firstTouch: true },
  });

  /* O nome vem sempre: é o que a pessoa acabou de digitar. */
  const doFormulario = { nome: input.nome.trim() };

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
    nome: lead.nome.split(' ')[0],
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

export interface RecoveryRun {
  expired: number;
  checkoutEmails: number;
  pixEmails: number;
}

/**
 * Uma rodada do job. Idempotente: rodar duas vezes seguidas não envia nada
 * na segunda.
 */
export async function runRecovery(): Promise<RecoveryRun> {
  const cfg = await getSiteConfig();
  const now = new Date();
  const out: RecoveryRun = { expired: 0, checkoutEmails: 0, pixEmails: 0 };

  /* 1. Pix pendente que passou do prazo vira expirado. */
  const expired = await prisma.order.updateMany({
    where: { status: 'pending', expiresAt: { lt: now } },
    data: { status: 'expired' },
  });
  out.expired = expired.count;

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
export function startRecoveryJob(log: { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void }): void {
  const tick = async () => {
    try {
      const r = await runRecovery();
      if (r.expired || r.checkoutEmails || r.pixEmails) log.info(r, 'recuperação: rodada concluída');
    } catch (err) {
      log.warn({ err }, 'recuperação: falha na rodada');
    }
  };
  setTimeout(tick, 15_000);
  setInterval(tick, 60_000);
}
