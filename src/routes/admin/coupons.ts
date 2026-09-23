import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../lib/auth.js';
import { getSiteConfig } from '../../services/config.js';
import { aplicarDesconto, normalizarCodigo } from '../../services/coupons.js';

/**
 * Cupons de desconto — cadastro do painel.
 *
 * O cupom é **digitado pelo comprador** na landing page, mas só existe se o
 * dono criou aqui. Não há cupom automático, não há cupom por link e não há
 * desconto que a página decida sozinha: o código é a única coisa que viaja do
 * navegador para cá, e o valor sai do banco.
 *
 * Duas travas moram nesta tela e valem repetir:
 *
 * 1. **Nenhum cupom zera o pedido.** O piso é o mínimo do Pix configurado na
 *    aba Checkout. Um cupom de 100% resulta nesse mínimo — a pré-visualização
 *    devolvida por estas rotas já mostra o valor real, para o dono não
 *    descobrir a regra só depois de anunciar "de graça".
 * 2. **Uso gasto é uso que virou pedido.** Conferir o cupom na página não
 *    consome nada; `usedCount` só sobe quando a cobrança é criada. Por isso o
 *    número desta tela é confiável como "quantas vendas este cupom fez".
 */

const KINDS = ['percent', 'fixed'] as const;

/**
 * `value` é validado duas vezes: o teto genérico aqui (nada negativo, nada
 * absurdo) e a regra por tipo logo abaixo, no `superRefine`. Separado porque
 * um percentual de 5000 e um valor fixo de 5000 centavos são coisas
 * diferentes, e um schema só não consegue dizer isso.
 */
const corpoBase = {
  code: z
    .string()
    .trim()
    .min(3)
    .max(40)
    /* Só letras, números, hífen e sublinhado: o código é digitado no celular,
       muitas vezes ditado por áudio, e acento vira erro de suporte. */
    .regex(/^[A-Za-z0-9_-]+$/, 'use apenas letras, números, hífen e sublinhado'),
  kind: z.enum(KINDS),
  value: z.number().int().min(1).max(10_000_000),
  active: z.boolean().default(true),
  /** Nulo = ilimitado. É o campo que o dono usa para o cupom de teste. */
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  startsAt: z.string().datetime().nullable().default(null),
  endsAt: z.string().datetime().nullable().default(null),
  note: z.string().trim().max(200).nullable().default(null),
};

function regraPorTipo(dados: { kind?: string; value?: number }, ctx: z.RefinementCtx) {
  if (dados.kind === 'percent' && dados.value !== undefined && dados.value > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'percentual vai de 1 a 100' });
  }
}

const criarBody = z.object(corpoBase).superRefine(regraPorTipo);
const atualizarBody = z.object(corpoBase).partial().superRefine(regraPorTipo);
const idParam = z.object({ id: z.string().uuid() });

const SELECT_CUPOM = {
  id: true,
  code: true,
  kind: true,
  value: true,
  active: true,
  maxUses: true,
  usedCount: true,
  startsAt: true,
  endsAt: true,
  note: true,
  createdBy: true,
  createdAt: true,
  updatedAt: true,
} as const;

function erroZod(reply: import('fastify').FastifyReply, err: z.ZodError) {
  return reply.code(400).send({
    error: 'dados_invalidos',
    issues: err.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
  });
}

/** Converte "2026-10-01T00:00:00.000Z" em `Date`, e nulo em nulo. */
function data(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  return v === null ? null : new Date(v);
}

export const couponsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  /* -------------------------------------------------------------- *
   * Listagem
   * -------------------------------------------------------------- */
  app.get('/coupons', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');

    const cfg = await getSiteConfig();
    const cupons = await prisma.coupon.findMany({ orderBy: { createdAt: 'desc' }, select: SELECT_CUPOM });

    /**
     * Cada linha vai com a conta já feita sobre o preço de hoje.
     *
     * A tela precisa mostrar "de R$ 97,00 por R$ 87,00", e quem sabe fazer
     * essa conta é o servidor: é a mesma `aplicarDesconto` que a LP e o
     * checkout usam. Repetir a fórmula em TypeScript no painel garantiria
     * que um dia os dois divergem, e a divergência apareceria como um preço
     * na tela do dono diferente do preço que o cliente paga.
     */
    const preview = (c: { code: string; kind: (typeof KINDS)[number]; value: number }) =>
      aplicarDesconto(c, cfg.content.priceCents, cfg.checkout.pixMinCents);

    return reply.send({
      /* O painel precisa dos três para explicar a regra na própria tela, sem
         mandar o dono procurar na aba Checkout. */
      couponsEnabled: cfg.checkout.couponsEnabled,
      priceCents: cfg.content.priceCents,
      pixMinCents: cfg.checkout.pixMinCents,
      coupons: cupons.map((c) => ({ ...c, preview: preview(c) })),
    });
  });

  /* -------------------------------------------------------------- *
   * Criar
   * -------------------------------------------------------------- */
  app.post('/coupons', async (req, reply) => {
    const parsed = criarBody.safeParse(req.body);
    if (!parsed.success) return erroZod(reply, parsed.error);

    const d = parsed.data;
    const code = normalizarCodigo(d.code);

    /* Conferido antes de tentar gravar para o dono receber "este código já
       existe" em vez do P2002 cru da chave única. A corrida entre os dois
       ainda é possível e cai no `catch` lá embaixo. */
    const existe = await prisma.coupon.findUnique({ where: { code }, select: { id: true } });
    if (existe) return reply.code(409).send({ error: 'codigo_em_uso', message: 'Já existe um cupom com este código.' });

    if (d.startsAt && d.endsAt && new Date(d.startsAt) >= new Date(d.endsAt)) {
      return reply.code(400).send({ error: 'janela_invalida', message: 'A data de início tem que ser antes da de fim.' });
    }

    try {
      const cupom = await prisma.coupon.create({
        data: {
          code,
          kind: d.kind,
          value: d.value,
          active: d.active,
          maxUses: d.maxUses,
          startsAt: data(d.startsAt) ?? null,
          endsAt: data(d.endsAt) ?? null,
          note: d.note,
          /* Só para a tela dizer quem criou. Não é chave de nada. */
          createdBy: req.admin?.email ?? null,
        },
        select: SELECT_CUPOM,
      });

      await audit(req, 'create', 'coupon', cupom.id, null, cupom);
      return reply.code(201).send(cupom);
    } catch {
      return reply.code(409).send({ error: 'codigo_em_uso', message: 'Já existe um cupom com este código.' });
    }
  });

  /* -------------------------------------------------------------- *
   * Alterar
   * -------------------------------------------------------------- */
  app.patch('/coupons/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'nao_encontrado' });

    const parsed = atualizarBody.safeParse(req.body);
    if (!parsed.success) return erroZod(reply, parsed.error);

    const antes = await prisma.coupon.findUnique({ where: { id: params.data.id }, select: SELECT_CUPOM });
    if (!antes) return reply.code(404).send({ error: 'nao_encontrado' });

    const d = parsed.data;

    /**
     * O código só pode mudar enquanto o cupom nunca foi usado.
     *
     * Renomear um cupom já usado quebraria o vínculo com os pedidos: eles
     * guardam `couponCode` como texto, e o relatório passaria a mostrar
     * vendas de um código que não existe mais. Desativar e criar outro é o
     * caminho certo, e é o que a mensagem diz.
     */
    let code: string | undefined;
    if (d.code !== undefined) {
      const novo = normalizarCodigo(d.code);
      if (novo !== antes.code) {
        if (antes.usedCount > 0) {
          return reply.code(409).send({
            error: 'codigo_travado',
            message: 'Este cupom já foi usado. Desative e crie outro em vez de mudar o código.',
          });
        }
        const conflito = await prisma.coupon.findUnique({ where: { code: novo }, select: { id: true } });
        if (conflito) return reply.code(409).send({ error: 'codigo_em_uso', message: 'Já existe um cupom com este código.' });
        code = novo;
      }
    }

    /* O tipo pode mudar sem o valor (ou vice-versa); a regra "percentual vai
       até 100" tem que valer sobre a combinação final, não sobre o que veio
       no corpo. */
    const kindFinal = d.kind ?? antes.kind;
    const valueFinal = d.value ?? antes.value;
    if (kindFinal === 'percent' && valueFinal > 100) {
      return reply.code(400).send({ error: 'dados_invalidos', issues: [{ campo: 'value', erro: 'percentual vai de 1 a 100' }] });
    }

    const inicio = d.startsAt !== undefined ? data(d.startsAt) : antes.startsAt;
    const fim = d.endsAt !== undefined ? data(d.endsAt) : antes.endsAt;
    if (inicio && fim && inicio >= fim) {
      return reply.code(400).send({ error: 'janela_invalida', message: 'A data de início tem que ser antes da de fim.' });
    }

    const cupom = await prisma.coupon.update({
      where: { id: params.data.id },
      data: {
        ...(code !== undefined ? { code } : {}),
        ...(d.kind !== undefined ? { kind: d.kind } : {}),
        ...(d.value !== undefined ? { value: d.value } : {}),
        ...(d.active !== undefined ? { active: d.active } : {}),
        ...(d.maxUses !== undefined ? { maxUses: d.maxUses } : {}),
        ...(d.startsAt !== undefined ? { startsAt: data(d.startsAt) ?? null } : {}),
        ...(d.endsAt !== undefined ? { endsAt: data(d.endsAt) ?? null } : {}),
        ...(d.note !== undefined ? { note: d.note } : {}),
      },
      select: SELECT_CUPOM,
    });

    await audit(req, 'update', 'coupon', cupom.id, antes, cupom);
    return reply.send(cupom);
  });

  /* -------------------------------------------------------------- *
   * Apagar
   * -------------------------------------------------------------- */
  app.delete('/coupons/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'nao_encontrado' });

    const antes = await prisma.coupon.findUnique({ where: { id: params.data.id }, select: SELECT_CUPOM });
    if (!antes) return reply.code(404).send({ error: 'nao_encontrado' });

    /**
     * Cupom com uso não some — desativa.
     *
     * Apagar faria as vendas feitas com ele apontarem para um código
     * inexistente, e a pergunta "quanto este cupom vendeu" deixaria de ter
     * resposta. Desativado, ele para de funcionar na hora e o histórico
     * continua de pé.
     */
    if (antes.usedCount > 0) {
      const cupom = await prisma.coupon.update({
        where: { id: params.data.id },
        data: { active: false },
        select: SELECT_CUPOM,
      });
      await audit(req, 'deactivate', 'coupon', cupom.id, antes, cupom);
      return reply.send({ ok: true, desativado: true, coupon: cupom });
    }

    await prisma.coupon.delete({ where: { id: params.data.id } });
    await audit(req, 'delete', 'coupon', params.data.id, antes, null);
    return reply.send({ ok: true, desativado: false });
  });

  /* -------------------------------------------------------------- *
   * Uso: quanto cada cupom vendeu
   * -------------------------------------------------------------- */
  /**
   * Os pedidos feitos com cada cupom.
   *
   * `usedCount` conta usos; esta rota conta dinheiro — e os dois números são
   * diferentes de propósito. Um cupom pode ter dez usos e duas vendas pagas:
   * o uso é gasto quando o Pix é gerado, e nem todo Pix é pago. Sem os dois
   * lado a lado, um cupom que gera muito e converte pouco parece um sucesso.
   */
  app.get('/coupons/usage', async (req, reply) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }).parse(req.query);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    reply.header('Cache-Control', 'no-store');

    const linhas = await prisma.order.groupBy({
      by: ['couponCode', 'status'],
      where: { couponCode: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { amountCents: true, discountCents: true },
    });

    const porCupom = new Map<
      string,
      { code: string; pedidos: number; pagos: number; receitaCents: number; descontoCents: number }
    >();

    for (const l of linhas) {
      const code = l.couponCode;
      if (!code) continue;
      const atual =
        porCupom.get(code) ?? { code, pedidos: 0, pagos: 0, receitaCents: 0, descontoCents: 0 };

      atual.pedidos += l._count._all;
      if (l.status === 'paid') {
        atual.pagos += l._count._all;
        /* Receita e desconto só do que foi pago: somar pedido pendente seria
           contar dinheiro que ninguém recebeu. */
        atual.receitaCents += l._sum.amountCents ?? 0;
        atual.descontoCents += l._sum.discountCents ?? 0;
      }

      porCupom.set(code, atual);
    }

    return reply.send({
      days,
      items: [...porCupom.values()].sort((a, b) => b.pagos - a.pagos || b.pedidos - a.pedidos),
    });
  });
};
