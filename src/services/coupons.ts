import { prisma } from '../db.js';
import { getSiteConfig } from './config.js';

/**
 * Cupons de desconto.
 *
 * Três regras moldam este arquivo inteiro:
 *
 * 1. **O servidor decide o preço.** A landing page manda o código digitado,
 *    nunca o valor. Quem confia no desconto que chega do navegador vende por
 *    R$ 0,01 no dia em que alguém abrir o DevTools.
 * 2. **Nenhum cupom zera o pedido.** O piso é o `checkout.pixMinCents` do
 *    painel. Um cupom de 100% resulta no mínimo do Pix — cobrança sem valor
 *    não existe para o gateway, e o pedido nasceria impossível de pagar.
 * 3. **O uso só é contado quando vira pedido.** Conferir (`validarCupom`) é
 *    de graça e acontece a cada vez que a pessoa aperta "Aplicar"; gastar
 *    (`consumirCupom`) acontece uma vez, dentro da criação do checkout.
 *    Contar na conferência esgotaria um cupom de 1 uso só de alguém digitar
 *    e desistir.
 */

/** Motivos de recusa. Saem crus daqui e são traduzidos na borda (rota/LP). */
export type CupomErro =
  | 'cupons_desligados'
  | 'nao_encontrado'
  | 'inativo'
  | 'ainda_nao_vale'
  | 'expirado'
  | 'esgotado';

export interface CupomAplicado {
  /** Já normalizado (maiúsculas, sem espaços) — é como está no banco. */
  code: string;
  kind: 'percent' | 'fixed';
  /** `percent`: 1..100. `fixed`: centavos. Serve para a tela mostrar "10% OFF". */
  value: number;
  /** Preço cheio, antes do cupom. Vai para `Order.listAmountCents`. */
  listAmountCents: number;
  /** Quanto foi abatido de verdade, já respeitado o piso do Pix. */
  discountCents: number;
  /** O que a pessoa vai pagar. Nunca menor que o piso. */
  amountCents: number;
  /**
   * `true` quando o desconto pedido era maior do que o piso permitia e foi
   * aparado. A LP usa isso para explicar por que um cupom de 100% ainda cobra
   * o mínimo, em vez de a pessoa achar que o cupom não funcionou.
   */
  limitadoPeloMinimo: boolean;
}

export type ResultadoCupom = { ok: true; cupom: CupomAplicado } | { ok: false; erro: CupomErro };

/**
 * Normaliza o código dos dois lados da comparação.
 *
 * Sem isto, "vip10", "VIP10 " e "Vip 10" viram cupons diferentes para quem
 * digita e o mesmo para quem criou — e o suporte vira "mas eu digitei certo".
 */
export function normalizarCodigo(bruto: string): string {
  return bruto.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * Piso efetivo do pedido.
 *
 * É o mínimo do Pix, **exceto** quando o próprio preço cheio já é menor que
 * ele: nesse caso o piso é o preço. Um cupom nunca pode deixar o pedido mais
 * caro do que era sem cupom.
 */
function pisoDoPedido(listAmountCents: number, pixMinCents: number): number {
  return Math.min(pixMinCents, listAmountCents);
}

/**
 * Calcula o desconto de um cupom já carregado sobre um preço.
 *
 * Separada da consulta ao banco de propósito: é uma função pura, e é ela que
 * a rota de pré-visualização, a criação do checkout e os testes usam — três
 * lugares que precisam chegar ao mesmo centavo.
 */
export function aplicarDesconto(
  cupom: { code: string; kind: 'percent' | 'fixed'; value: number },
  listAmountCents: number,
  pixMinCents: number,
): CupomAplicado {
  const piso = pisoDoPedido(listAmountCents, pixMinCents);

  /* `floor` e não `round`: arredondar para cima cobraria um centavo a mais do
     que a porcentagem anunciada, e o comprador confere. */
  const pedido = cupom.kind === 'percent' ? Math.floor((listAmountCents * cupom.value) / 100) : cupom.value;

  const maximo = Math.max(0, listAmountCents - piso);
  const discountCents = Math.max(0, Math.min(pedido, maximo));

  return {
    code: cupom.code,
    kind: cupom.kind,
    value: cupom.value,
    listAmountCents,
    discountCents,
    amountCents: listAmountCents - discountCents,
    limitadoPeloMinimo: pedido > maximo,
  };
}

/**
 * Confere um código digitado e devolve os valores resultantes.
 *
 * **Não** gasta o cupom. É chamada quando a pessoa aperta "Aplicar" e de novo
 * no momento de criar o pedido — e é a segunda chamada que vale, porque entre
 * uma e outra o cupom pode ter sido desativado no painel.
 *
 * `precoCents` só é passado explicitamente pelos testes; no caminho normal o
 * preço é o oficial do painel, e ninguém de fora escolhe sobre qual valor o
 * desconto incide.
 */
export async function validarCupom(codigoBruto: string, precoCents?: number): Promise<ResultadoCupom> {
  const cfg = await getSiteConfig();
  if (!cfg.checkout.couponsEnabled) return { ok: false, erro: 'cupons_desligados' };

  const code = normalizarCodigo(codigoBruto);
  if (!code) return { ok: false, erro: 'nao_encontrado' };

  const cupom = await prisma.coupon.findUnique({ where: { code } });
  if (!cupom) return { ok: false, erro: 'nao_encontrado' };
  if (!cupom.active) return { ok: false, erro: 'inativo' };

  const agora = new Date();
  if (cupom.startsAt && agora < cupom.startsAt) return { ok: false, erro: 'ainda_nao_vale' };
  if (cupom.endsAt && agora > cupom.endsAt) return { ok: false, erro: 'expirado' };
  if (cupom.maxUses !== null && cupom.usedCount >= cupom.maxUses) return { ok: false, erro: 'esgotado' };

  const listAmountCents = precoCents ?? cfg.content.priceCents;

  return {
    ok: true,
    cupom: aplicarDesconto(
      { code: cupom.code, kind: cupom.kind, value: cupom.value },
      listAmountCents,
      cfg.checkout.pixMinCents,
    ),
  };
}

/**
 * Gasta um uso do cupom.
 *
 * O `UPDATE` condicional é o ponto inteiro desta função: ler o `usedCount`,
 * comparar em JavaScript e gravar depois deixaria uma janela entre a leitura
 * e a escrita — duas pessoas usando o último uso de um cupom ao mesmo tempo
 * passariam as duas. Aqui o banco decide, numa instrução só, e quem perder a
 * corrida recebe `false`.
 *
 * As condições de janela e de atividade são repetidas aqui, e não só em
 * `validarCupom`, porque entre conferir e criar o pedido passa tempo real —
 * o suficiente para o dono desativar o cupom no painel.
 *
 * Quem chama trata `false` como "sem desconto", não como erro fatal: o pedido
 * segue pelo preço cheio em vez de a venda falhar.
 */
export async function consumirCupom(codigoBruto: string): Promise<boolean> {
  const code = normalizarCodigo(codigoBruto);
  if (!code) return false;

  const linhas = await prisma.$executeRaw`
    UPDATE "Coupon"
       SET "usedCount" = "usedCount" + 1,
           "updatedAt" = NOW()
     WHERE "code" = ${code}
       AND "active" = true
       AND ("maxUses" IS NULL OR "usedCount" < "maxUses")
       AND ("startsAt" IS NULL OR "startsAt" <= NOW())
       AND ("endsAt" IS NULL OR "endsAt" >= NOW())
  `;

  return linhas > 0;
}

/**
 * Devolve um uso ao cupom.
 *
 * Usada quando o cupom foi gasto e aí o gateway recusou a cobrança: sem isto,
 * cada tentativa falha de pagamento queimaria um uso de um cupom limitado. O
 * `GREATEST` evita contagem negativa se a devolução acontecer duas vezes.
 */
export async function devolverCupom(codigoBruto: string): Promise<void> {
  const code = normalizarCodigo(codigoBruto);
  if (!code) return;

  await prisma.$executeRaw`
    UPDATE "Coupon"
       SET "usedCount" = GREATEST("usedCount" - 1, 0),
           "updatedAt" = NOW()
     WHERE "code" = ${code}
  `;
}

/** Mensagens prontas para o visitante. O erro cru fica nos logs e no dataLayer. */
export const MENSAGEM_DE_ERRO: Record<CupomErro, string> = {
  cupons_desligados: 'Cupons não estão disponíveis no momento.',
  nao_encontrado: 'Cupom inválido.',
  inativo: 'Este cupom não está mais ativo.',
  ainda_nao_vale: 'Este cupom ainda não começou a valer.',
  expirado: 'Este cupom expirou.',
  esgotado: 'Este cupom já atingiu o limite de usos.',
};
