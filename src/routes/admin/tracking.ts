import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../lib/auth.js';
import { getSiteConfig, saveSiteConfig, trackingSchema } from '../../services/config.js';
import { SECRET_KEYS, secretsStatus, setSecret, type SecretKey } from '../../services/secrets.js';
import { sendMetaTestEvent } from '../../services/conversions.js';

const TRACKING_SECRETS: SecretKey[] = [
  SECRET_KEYS.metaCapiToken,
  SECRET_KEYS.ga4ApiSecret,
  SECRET_KEYS.tiktokToken,
  SECRET_KEYS.kwaiToken,
];

const putBody = z.object({
  tracking: trackingSchema,
  secrets: z.record(z.string().max(500)).optional(),
});

export const trackingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  app.get('/tracking', async (_req, reply) => {
    const cfg = await getSiteConfig();
    return reply.send({
      tracking: cfg.tracking,
      secrets: await secretsStatus(TRACKING_SECRETS),
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
      if (!TRACKING_SECRETS.includes(key as SecretKey)) continue;
      await setSecret(key as SecretKey, value, req.admin!.email);
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
      secrets: await secretsStatus(TRACKING_SECRETS),
    });
  });

  /**
   * Envia um evento real para a Meta e devolve o que ela respondeu.
   *
   * Diferente do teste do gateway, este de fato chama a API — então o
   * resultado é uma afirmação verificável, não uma checagem de preenchimento.
   */
  app.post('/tracking/meta/test', { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const result = await sendMetaTestEvent();
    await audit(req, 'tracking.meta.test', 'SiteConfig', '1', { ok: result.ok });
    return reply.send(result);
  });
};
