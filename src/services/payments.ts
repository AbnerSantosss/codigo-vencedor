import { randomUUID } from 'node:crypto';
import type { OrderStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { forwardPurchase } from './conversions.js';
import { sendPurchaseApproved } from './recovery.js';
import { dispatchOutbound } from './outbound.js';

/**
 * Mudança de status de pedido — o único lugar onde isso acontece.
 *
 * Existem três caminhos que confirmam um pagamento: o webhook do gateway, a
 * consulta de status feita em laço pela landing page, e a confirmação
 * simulada de demonstração. Antes disso morava dentro da rota de checkout, o
 * que significava que ligar o webhook criaria uma **segunda** implementação
 * da mesma regra — e duas implementações da mesma regra divergem.
 *
 * O que este módulo garante e uma rota isolada não garantiria:
 *
 * 1. **Confirmar duas vezes não cobra nem entrega duas vezes.** A transição
 *    é um `updateMany` condicionado a `status: 'pending'`, então o banco
 *    decide quem chegou primeiro. Os efeitos colaterais (conversão, e-mail,
 *    webhook de saída) só disparam para quem virou a chave — `count === 1`.
 *    Ler-e-depois-escrever não serviria: o webhook e o laço da página chegam
 *    ao mesmo tempo, os dois leem `pending`, e o comprador recebe dois
 *    e-mails e a Meta conta duas vendas.
 * 2. **`purchaseEventId` nasce uma vez.** É o que faz a Meta deduplicar o
 *    Purchase entre o servidor e a página de obrigado. Gerar outro numa
 *    segunda confirmação contaria a mesma venda de novo.
 */

export type OrigemConfirmacao = 'webhook' | 'polling' | 'simulacao' | 'painel';

export interface ResultadoConfirmacao {
  /** Verdadeiro só para a chamada que efetivamente mudou o status. */
  mudou: boolean;
  status: OrderStatus;
  purchaseEventId: string | null;
}

interface Log {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}

/**
 * Marca o pedido como pago, se ele ainda estiver pendente.
 *
 * Devolve `mudou: false` sem erro quando o pedido já estava pago — o webhook
 * do Mercado Pago reenvia a mesma notificação, e isso é normal, não falha.
 */
export async function confirmarPagamento(
  orderId: string,
  origem: OrigemConfirmacao,
  log: Log,
): Promise<ResultadoConfirmacao | null> {
  const antes = await prisma.order.findUnique({
    where: { id: orderId },
    select: { status: true, purchaseEventId: true },
  });
  if (!antes) return null;

  if (antes.status === 'paid') {
    return { mudou: false, status: 'paid', purchaseEventId: antes.purchaseEventId };
  }

  const purchaseEventId = randomUUID();

  /**
   * A condição `status: 'pending'` é o trinco.
   *
   * Um pedido `expired` pode virar pago: o Pix pode cair depois do prazo que
   * a página mostra, e negar o acesso de quem pagou seria muito pior do que
   * aceitar um pagamento atrasado. Já `refunded` e `failed` ficam de fora —
   * de lá para pago não existe transição legítima, e aceitar uma abriria a
   * porta para uma notificação repetida reabrir um estorno.
   */
  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: { in: ['pending', 'expired'] } },
    data: { status: 'paid', paidAt: new Date(), purchaseEventId },
  });

  if (count === 0) {
    // Outro caminho confirmou entre a leitura e a escrita, ou o status não
    // permite a transição. Reler para dizer a verdade a quem chamou.
    const agora = await prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true, purchaseEventId: true },
    });
    return agora
      ? { mudou: false, status: agora.status, purchaseEventId: agora.purchaseEventId }
      : null;
  }

  log.info({ orderId, origem, deExpirado: antes.status === 'expired' }, 'pagamento confirmado');

  /**
   * Efeitos colaterais sem `await`: nenhum deles pode atrasar a resposta.
   *
   * No webhook isso é obrigatório e não só desejável — o Mercado Pago tem
   * poucos segundos de paciência e trata demora como falha, então reenviaria
   * a notificação enquanto a primeira ainda está processando.
   */
  forwardPurchase(orderId).catch((err) => log.warn({ err, orderId }, 'falha ao enviar conversão'));
  sendPurchaseApproved(orderId).catch((err) => log.warn({ err, orderId }, 'falha ao enviar e-mail de acesso'));
  dispatchOutbound('order.paid', { orderId }, log).catch((err) =>
    log.warn({ err, orderId }, 'falha ao enfileirar webhook de saída'),
  );

  return { mudou: true, status: 'paid', purchaseEventId };
}

/**
 * Aplica um status que não é "pago" vindo do gateway (estorno, recusa).
 *
 * Separado de `confirmarPagamento` porque as regras de transição são outras:
 * aqui um pedido pago **pode** virar estornado, o que é justamente a
 * transição que a função de cima proíbe no sentido inverso.
 */
export async function aplicarStatusDoGateway(
  orderId: string,
  novo: Exclude<OrderStatus, 'paid'>,
  origem: OrigemConfirmacao,
  log: Log,
): Promise<ResultadoConfirmacao | null> {
  const antes = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!antes) return null;
  if (antes.status === novo) return { mudou: false, status: novo, purchaseEventId: null };

  /**
   * `pending` nunca é aplicado de volta: é o estado inicial, e voltar para
   * ele apagaria uma confirmação já dada. Notificação de "em análise" sobre
   * pedido pago é ruído, não retrocesso.
   */
  if (novo === 'pending') return { mudou: false, status: antes.status, purchaseEventId: null };

  const { count } = await prisma.order.updateMany({
    where: { id: orderId, status: { not: novo } },
    data: {
      status: novo,
      ...(novo === 'refunded' ? { refundedAt: new Date() } : {}),
    },
  });

  if (count === 0) return { mudou: false, status: antes.status, purchaseEventId: null };

  log.info({ orderId, de: antes.status, para: novo, origem }, 'status do pedido alterado pelo gateway');

  if (novo === 'refunded') {
    dispatchOutbound('order.refunded', { orderId }, log).catch((err) =>
      log.warn({ err, orderId }, 'falha ao enfileirar webhook de saída'),
    );
  }

  return { mudou: true, status: novo, purchaseEventId: null };
}
