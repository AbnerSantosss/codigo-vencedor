import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin, requireOwner } from '../../lib/auth.js';
import { getSiteConfig, invalidateConfigCache } from '../../services/config.js';
import { env } from '../../env.js';
import { gatewayPorId } from '../../gateways/index.js';
import { invalidarFyhub, registrarWebhook, urlDoWebhook } from '../../gateways/fyhub.js';
import { SECRET_KEYS, getSecret, secretsStatus, setSecret, type SecretKey } from '../../services/secrets.js';

/** Chaves que esta tela administra. */
const GATEWAY_SECRETS: SecretKey[] = [
  SECRET_KEYS.mpAccessToken,
  SECRET_KEYS.mpWebhookSecret,
  SECRET_KEYS.appmaxClientId,
  SECRET_KEYS.appmaxClientSecret,
  SECRET_KEYS.appmaxWebhookToken,
  SECRET_KEYS.fyhubClientId,
  SECRET_KEYS.fyhubClientSecret,
  SECRET_KEYS.fyhubCertPem,
  SECRET_KEYS.fyhubKeyPem,
  SECRET_KEYS.fyhubCertPassphrase,
  SECRET_KEYS.fyhubPixKey,
  SECRET_KEYS.fyhubWebhookToken,
  SECRET_KEYS.staticPixKey,
  SECRET_KEYS.staticPixName,
  SECRET_KEYS.staticPixCity,
];

/**
 * Chaves que aceitam texto longo, porque guardam PEM.
 *
 * Um certificado de cliente costuma ter de 1 a 3 KB, e a chave privada
 * outro tanto; cadeias com intermediários passam de 5 KB. O teto de 500
 * caracteres que serve para um token cortaria o certificado no meio — e o
 * erro apareceria só no handshake TLS, como "conexão recusada", sem nada
 * apontando para o campo que foi truncado ao salvar.
 */
const CHAVES_LONGAS = new Set<string>([SECRET_KEYS.fyhubCertPem, SECRET_KEYS.fyhubKeyPem]);

const LIMITE_CURTO = 500;
const LIMITE_LONGO = 8000;

const putBody = z.object({
  gatewayActive: z.enum(['mercadopago', 'appmax', 'static_pix', 'fyhub']),
  gatewayMode: z.enum(['sandbox', 'production']),
  pixExpiresMin: z.number().int().min(5).max(1440),
  /**
   * Só as chaves que o usuário realmente digitou vêm aqui. Campo ausente
   * mantém o segredo atual; string vazia apaga. Isso é o que permite a tela
   * mostrar "configurado" sem nunca devolver o valor.
   */
  secrets: z
    .record(z.string().max(LIMITE_LONGO))
    .optional()
    .superRefine((mapa, ctx) => {
      for (const [chave, valor] of Object.entries(mapa ?? {})) {
        const longa = CHAVES_LONGAS.has(chave);
        const limite = longa ? LIMITE_LONGO : LIMITE_CURTO;

        if (valor.length > limite) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [chave],
            message: `Valor longo demais (máximo de ${limite} caracteres).`,
          });
          continue;
        }

        /**
         * PEM colado pela metade é o erro mais provável desta tela: o
         * material chega por e-mail em formato binário e vira PEM à mão,
         * e é fácil esquecer a linha BEGIN. Recusar aqui devolve uma frase
         * que aponta o campo; deixar passar produz, semanas depois, um
         * "conexão recusada" que não explica nada.
         *
         * Valor vazio escapa da checagem porque é assim que a tela apaga
         * um segredo.
         */
        if (longa && valor && !valor.includes('-----BEGIN')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [chave],
            message:
              'Isto não parece um PEM. Cole o conteúdo inteiro do arquivo, incluindo a linha que começa com -----BEGIN.',
          });
        }
      }
    }),
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

    /**
     * Derruba o agente mTLS e o token da FyHub quando qualquer credencial
     * dela muda.
     *
     * O agente se refaz sozinho, porque a chave do cache dele é a impressão
     * digital do próprio PEM. O token não: ele é guardado por ambiente, e
     * um client_secret novo continuaria usando o token antigo até ele
     * expirar — até uma hora acreditando numa credencial que já foi
     * trocada, justamente na janela em que o dono está testando a tela.
     */
    if (touched.some((k) => k.startsWith('fyhub.'))) invalidarFyhub();

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
      fyhub: [
        SECRET_KEYS.fyhubClientId,
        SECRET_KEYS.fyhubClientSecret,
        SECRET_KEYS.fyhubCertPem,
        SECRET_KEYS.fyhubKeyPem,
        SECRET_KEYS.fyhubPixKey,
      ],
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

  /**
   * Registra o webhook da FyHub — o passo que não existe nos outros dois.
   *
   * No Mercado Pago a URL de notificação é colada num formulário do site
   * deles, e a Appmax cadastra pelo painel. No padrão do Banco Central o
   * webhook é registrado **pela API**, com `PUT /webhook/{chave}`. Sem esta
   * chamada a cobrança é criada normalmente, o comprador paga, e ninguém
   * nunca avisa o sistema — a venda fica pendente até alguém reparar.
   *
   * Por isso é um botão, e não algo escondido no "salvar": o dono precisa
   * ver que fez, e o teste de conexão precisa poder dizer que falta fazer.
   *
   * Limite de 6 por minuto porque é uma escrita na conta do provedor, não
   * uma consulta: não há motivo para alguém chamar isto em sequência.
   */
  app.post(
    '/gateway/fyhub/webhook',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req, reply) => {
      /**
       * A FyHub só aceita registrar uma URL pública em HTTPS, e com razão:
       * é por ela que trafega a confirmação de pagamento. Barrar aqui troca
       * um erro remoto e opaco por uma frase que diz o que configurar.
       */
      if (!env.PUBLIC_URL.startsWith('https://')) {
        return reply.code(400).send({
          error: 'public_url_invalida',
          message:
            'O endereço público do site precisa ser HTTPS para receber o webhook da FyHub. ' +
            `Hoje ele está como ${env.PUBLIC_URL}. Ajuste PUBLIC_URL no ambiente e tente de novo.`,
        });
      }

      const url = await urlDoWebhook(env.PUBLIC_URL);
      if (!url) {
        return reply.code(400).send({
          error: 'sem_segredo',
          message:
            'Defina antes o segredo do webhook da FyHub e salve a tela. Ele vai no endereço que a ' +
            'FyHub chama, e é o que separa uma notificação de verdade de um POST de estranho.',
        });
      }

      try {
        await registrarWebhook(env.PUBLIC_URL);
      } catch (err) {
        const detalhe = err instanceof Error ? err.message : 'erro desconhecido';
        req.log.error({ err }, 'fyhub: falha ao registrar o webhook');

        await audit(req, 'gateway.fyhub.webhook', 'SiteConfig', '1', { ok: false, erro: detalhe.slice(0, 200) });

        return reply.code(502).send({
          error: 'registro_falhou',
          message: `A FyHub recusou o registro: ${detalhe}`,
        });
      }

      /**
       * A URL entra na auditoria porque não é segredo do mesmo tipo: quem
       * lê o log já é dono, e saber qual endereço está registrado é o que
       * permite conferir uma integração que parou de notificar.
       */
      await audit(req, 'gateway.fyhub.webhook', 'SiteConfig', '1', { ok: true, url });

      return reply.send({
        ok: true,
        url,
        detail: 'Webhook registrado na FyHub. A partir de agora ela avisa este site a cada Pix recebido.',
      });
    },
  );
};
