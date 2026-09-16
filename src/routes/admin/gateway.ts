import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin, requireOwner } from '../../lib/auth.js';
import { getSiteConfig, invalidateConfigCache } from '../../services/config.js';
import { gatewayPorId } from '../../gateways/index.js';
import { SECRET_KEYS, getSecret, secretsStatus, setSecret, type SecretKey } from '../../services/secrets.js';

/** Chaves que esta tela administra. */
const GATEWAY_SECRETS: SecretKey[] = [
  SECRET_KEYS.mpAccessToken,
  SECRET_KEYS.mpWebhookSecret,
  SECRET_KEYS.appmaxClientId,
  SECRET_KEYS.appmaxClientSecret,
  SECRET_KEYS.appmaxWebhookToken,
  SECRET_KEYS.staticPixKey,
  SECRET_KEYS.staticPixName,
  SECRET_KEYS.staticPixCity,
];

const putBody = z.object({
  gatewayActive: z.enum(['mercadopago', 'appmax', 'static_pix']),
  gatewayMode: z.enum(['sandbox', 'production']),
  pixExpiresMin: z.number().int().min(5).max(1440),
  /**
   * Só as chaves que o usuário realmente digitou vêm aqui. Campo ausente
   * mantém o segredo atual; string vazia apaga. Isso é o que permite a tela
   * mostrar "configurado" sem nunca devolver o valor.
   */
  secrets: z.record(z.string().max(500)).optional(),
});

export const gatewayRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());
  // Guarda o token do gateway e a chave Pix: `editor` não entra.
  app.addHook('preHandler', requireOwner());

  app.get('/gateway', async (_req, reply) => {
    const cfg = await getSiteConfig();
    return reply.send({
      gatewayActive: cfg.gatewayActive,
      gatewayMode: cfg.gatewayMode,
      pixExpiresMin: cfg.pixExpiresMin,
      // Booleanos, não valores.
      secrets: await secretsStatus(GATEWAY_SECRETS),
    });
  });

  app.put('/gateway', async (req, reply) => {
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'dados_invalidos',
        issues: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
      });
    }

    const { gatewayActive, gatewayMode, pixExpiresMin, secrets } = parsed.data;
    const before = await getSiteConfig();

    await prisma.siteConfig.update({
      where: { id: 1 },
      data: { gatewayActive, gatewayMode, pixExpiresMin, updatedBy: req.admin!.email },
    });
    invalidateConfigCache();

    const touched: string[] = [];
    for (const [key, value] of Object.entries(secrets ?? {})) {
      if (!GATEWAY_SECRETS.includes(key as SecretKey)) continue;
      await setSecret(key as SecretKey, value, req.admin!.email);
      touched.push(key);
    }

    await audit(req, 'gateway.update', 'SiteConfig', '1', {
      de: { ativo: before.gatewayActive, ambiente: before.gatewayMode, expiraEm: before.pixExpiresMin },
      para: { ativo: gatewayActive, ambiente: gatewayMode, expiraEm: pixExpiresMin },
      credenciaisAlteradas: touched,
    });

    return reply.send({
      ok: true,
      gatewayActive,
      gatewayMode,
      pixExpiresMin,
      secrets: await secretsStatus(GATEWAY_SECRETS),
    });
  });

  /**
   * Teste de conexão — de verdade.
   *
   * Duas etapas, e as duas informam algo diferente:
   *
   *   1. `credenciais` — o que está gravado. Se falta chave obrigatória, para
   *      aqui: chamar o provedor sem credencial só produziria um 401 confuso.
   *   2. `provedor` — a chamada real. O Mercado Pago responde `GET /users/me`
   *      e a Appmax entrega (ou nega) um token OAuth2. Nenhuma das duas cria
   *      pagamento, cliente ou pedido: testar integração não pode sujar a
   *      base do dono.
   *
   * A versão anterior parava na etapa 1 e devolvia "credenciais presentes" —
   * o que soava como aprovação e deixava um token errado ser descoberto só
   * na primeira venda perdida.
   *
   * O `mismatch` é o aviso que fecha o buraco mais caro: credencial de teste
   * com a loja em produção gera Pix que ninguém consegue pagar.
   */
  app.post('/gateway/test', { config: { rateLimit: { max: 12, timeWindow: '1 minute' } } }, async (req, reply) => {
    const cfg = await getSiteConfig();

    const required: Record<string, SecretKey[]> = {
      mercadopago: [SECRET_KEYS.mpAccessToken, SECRET_KEYS.mpWebhookSecret],
      appmax: [SECRET_KEYS.appmaxClientId, SECRET_KEYS.appmaxClientSecret],
      static_pix: [SECRET_KEYS.staticPixKey, SECRET_KEYS.staticPixName, SECRET_KEYS.staticPixCity],
    };

    const missing: string[] = [];
    for (const key of required[cfg.gatewayActive] ?? []) {
      if (!(await getSecret(key))) missing.push(key);
    }

    if (missing.length) {
      return reply.send({
        ok: false,
        stage: 'credenciais',
        detail: `Faltam credenciais: ${missing.join(', ')}.`,
        provider: { id: cfg.gatewayActive, label: gatewayPorId(cfg.gatewayActive).label },
      });
    }

    const gateway = gatewayPorId(cfg.gatewayActive);

    /**
     * O Pix estático não tem provedor para chamar: a baixa dele é manual, e
     * o que existe para conferir é se o BR Code sai válido — o que o próprio
     * checkout já faz com o CRC16 verificado contra o vetor da especificação.
     */
    if (!gateway.verifyCredentials) {
      return reply.send({
        ok: true,
        stage: 'credenciais',
        detail:
          'Pix estático configurado. Não há provedor para consultar: o código é gerado aqui e a ' +
          'baixa do pagamento é manual, na tela de pedidos do seu banco.',
        provider: { id: gateway.id, label: gateway.label },
      });
    }

    const resultado = await gateway.verifyCredentials();
    const mismatch =
      resultado.ambiente !== undefined &&
      resultado.ambiente !== 'desconhecido' &&
      resultado.ambiente !== cfg.gatewayMode;

    await audit(req, 'gateway.test', 'SiteConfig', '1', {
      provedor: gateway.id,
      ok: resultado.ok,
      ambienteDaCredencial: resultado.ambiente,
      ambienteDaLoja: cfg.gatewayMode,
    });

    return reply.send({
      ok: resultado.ok,
      stage: 'provedor',
      detail: mismatch
        ? `${resultado.detail} Atenção: a credencial é de ${resultado.ambiente === 'sandbox' ? 'teste' : 'produção'} e a loja está em ${cfg.gatewayMode === 'sandbox' ? 'sandbox' : 'produção'}.`
        : resultado.detail,
      provider: {
        id: gateway.id,
        label: gateway.label,
        account: resultado.account ?? null,
        environment: resultado.ambiente ?? 'desconhecido',
        mismatch,
      },
    });
  });
};
