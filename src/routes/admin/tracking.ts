import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../lib/auth.js';
import { getSiteConfig, saveSiteConfig, trackingSchema } from '../../services/config.js';
import {
  SECRET_KEYS,
  ga4ApiSecretKey,
  isChaveDinamicaDeRastreamento,
  metaCapiTokenKey,
  secretsStatus,
  setSecret,
  type SecretKey,
  type SecretKeyValida,
} from '../../services/secrets.js';
import { sendMetaTestEvent } from '../../services/conversions.js';

const TRACKING_SECRETS: SecretKey[] = [
  SECRET_KEYS.metaCapiToken,
  SECRET_KEYS.ga4ApiSecret,
  SECRET_KEYS.tiktokToken,
  SECRET_KEYS.kwaiToken,
];

/**
 * Só chave de rastreamento passa por esta rota.
 *
 * A lista fixa mais as duas famílias por instância (`meta.capiToken:<id>`,
 * `ga4.apiSecret:<id>`). Sem este filtro, um PUT de rastreamento poderia
 * sobrescrever o token do gateway — que é a razão de o filtro existir desde o
 * começo, e ela não mudou por causa dos múltiplos pixels.
 */
function ehSegredoDeRastreamento(key: string): key is SecretKeyValida {
  return TRACKING_SECRETS.includes(key as SecretKey) || isChaveDinamicaDeRastreamento(key);
}

const putBody = z.object({
  tracking: trackingSchema,
  secrets: z.record(z.string().max(500)).optional(),
});

const testeBody = z
  .object({
    /** Qual pixel testar. Sem ele, o primeiro ativo com token. */
    pixelId: z.string().regex(/^\d{5,25}$/).optional(),
  })
  .optional();

export const trackingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  app.get('/tracking', async (_req, reply) => {
    const cfg = await getSiteConfig();

    /* Além das chaves fixas, uma por pixel e uma por stream — a tela precisa
       saber que o pixel #2 ainda está sem token. Continua sendo só booleano:
       segredo salvo nunca volta ao navegador, nem truncado. */
    const chaves: SecretKeyValida[] = [
      ...TRACKING_SECRETS,
      ...cfg.tracking.meta.pixels.map((p) => metaCapiTokenKey(p.id)),
      ...cfg.tracking.ga4.streams.map((s) => ga4ApiSecretKey(s.measurementId)),
    ];
    const secrets = await secretsStatus(chaves);

    /**
     * "Mostrar que existe" — o que está instalado, pronto para a tela.
     *
     * `temToken`/`temApiSecret` são booleanos derivados do mesmo par de chaves
     * que o envio usa: a chave por instância e, faltando ela, a antiga. Assim
     * a tela mostra "configurado" exatamente quando o envio de fato acontece,
     * em vez de dizer que falta token para um pixel que está funcionando pelo
     * legado.
     */
    const instalado = {
      gtm: cfg.tracking.gtm.containers.map((c) => ({
        id: c.id,
        label: c.label,
        active: c.active,
        /** De onde a linha veio: hoje sempre da configuração salva. Fica
         *  explícito para a tela poder marcar, depois, o que foi detectado no
         *  HTML publicado em vez de cadastrado aqui. */
        origem: 'config' as const,
      })),
      meta: cfg.tracking.meta.pixels.map((p) => ({
        id: p.id,
        label: p.label,
        active: p.active,
        temToken: Boolean(secrets[metaCapiTokenKey(p.id)] || secrets[SECRET_KEYS.metaCapiToken]),
        testEventCode: p.testEventCode,
        eventos: p.events.length,
      })),
      ga4: cfg.tracking.ga4.streams.map((s) => ({
        measurementId: s.measurementId,
        label: s.label,
        active: s.active,
        temApiSecret: Boolean(secrets[ga4ApiSecretKey(s.measurementId)] || secrets[SECRET_KEYS.ga4ApiSecret]),
      })),
      /* Google Ads aparece para conferência e não tem envio: a conversão entra
         por importação a partir do GA4. Ver o comentário no `trackingSchema`. */
      googleAds: cfg.tracking.googleAds.conversions.map((c) => ({
        conversionId: c.conversionId,
        conversionLabel: c.conversionLabel,
        label: c.label,
        active: c.active,
      })),
    };

    return reply.send({
      tracking: cfg.tracking,
      secrets,
      instalado,
      /** Os eventos que o servidor sabe traduzir, para a tela montar as caixas. */
      availableEvents: [
        { id: 'page_view', label: 'Visita', meta: 'PageView' },
        { id: 'view_content', label: 'Viu o conteúdo', meta: 'ViewContent' },
        { id: 'begin_checkout', label: 'Começou o checkout', meta: 'InitiateCheckout' },
        { id: 'generate_lead', label: 'Enviou o formulário', meta: 'Lead' },
        { id: 'add_payment_info', label: 'Pix gerado', meta: 'AddPaymentInfo' },
        { id: 'purchase', label: 'Pagou', meta: 'Purchase' },
      ],
    });
  });

  app.put('/tracking', async (req, reply) => {
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'dados_invalidos',
        issues: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
      });
    }

    const before = await getSiteConfig();
    await saveSiteConfig({ tracking: parsed.data.tracking }, req.admin!.email);

    const touched: string[] = [];
    for (const [key, value] of Object.entries(parsed.data.secrets ?? {})) {
      if (!ehSegredoDeRastreamento(key)) continue;
      await setSecret(key, value, req.admin!.email);
      touched.push(key);
    }

    await audit(req, 'tracking.update', 'SiteConfig', '1', {
      de: before.tracking,
      para: parsed.data.tracking,
      credenciaisAlteradas: touched,
    });

    return reply.send({
      ok: true,
      tracking: parsed.data.tracking,
      secrets: await secretsStatus([
        ...TRACKING_SECRETS,
        ...parsed.data.tracking.meta.pixels.map((p) => metaCapiTokenKey(p.id)),
        ...parsed.data.tracking.ga4.streams.map((s) => ga4ApiSecretKey(s.measurementId)),
      ]),
    });
  });

  /**
   * Envia um evento real para a Meta e devolve o que ela respondeu.
   *
   * Diferente do teste do gateway, este de fato chama a API — então o
   * resultado é uma afirmação verificável, não uma checagem de preenchimento.
   */
  app.post('/tracking/meta/test', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const parsed = testeBody.safeParse(req.body ?? undefined);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'dados_invalidos', issues: parsed.error.issues.map((i) => i.message) });
    }

    const pixelId = parsed.data?.pixelId;
    const result = await sendMetaTestEvent(pixelId);
    await audit(req, 'tracking.meta.test', 'SiteConfig', '1', { ok: result.ok, pixelId: pixelId ?? null });
    return reply.send(result);
  });
};
