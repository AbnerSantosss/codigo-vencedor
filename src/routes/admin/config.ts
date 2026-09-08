import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../lib/auth.js';
import {
  DEFAULT_CONFIG,
  DEFAULT_THEME,
  contentSchema,
  emailSchema,
  getSiteConfig,
  checkoutSchema,
  linksSchema,
  saveSiteConfig,
  scarcitySchema,
  themeSchema,
  trackingSchema,
} from '../../services/config.js';

/**
 * Cada seção do painel salva só o seu pedaço. Um PUT parcial evita que duas
 * abas abertas em telas diferentes sobrescrevam o trabalho uma da outra.
 */
const patchSchema = z
  .object({
    content: contentSchema,
    theme: themeSchema,
    scarcity: scarcitySchema,
    links: linksSchema,
    checkout: checkoutSchema,
    tracking: trackingSchema,
    email: emailSchema,
    pixExpiresMin: z.number().int().min(5).max(1440),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Envie ao menos uma seção');

export const configRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  app.get('/config', async (_req, reply) => {
    const cfg = await getSiteConfig();
    // A config de gateway tem tela própria (com credenciais); aqui só o resto.
    const { gatewayActive, gatewayMode, ...rest } = cfg;
    return reply.send({ ...rest, defaults: { theme: DEFAULT_THEME, content: DEFAULT_CONFIG.content } });
  });

  app.put('/config', async (req, reply) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'dados_invalidos',
        issues: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
      });
    }

    const before = await getSiteConfig();
    const next = await saveSiteConfig(parsed.data, req.admin!.email);

    // Guarda só as seções que mudaram, para a auditoria ficar legível.
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(parsed.data) as (keyof typeof parsed.data)[]) {
      changed[key] = { de: before[key as keyof typeof before], para: next[key as keyof typeof next] };
    }
    await audit(req, 'config.update', 'SiteConfig', '1', changed);

    return reply.send({ ok: true, config: next });
  });

  /** Volta a paleta para os valores originais do designer. */
  app.post('/config/theme/reset', async (req, reply) => {
    const next = await saveSiteConfig({ theme: DEFAULT_THEME }, req.admin!.email);
    await audit(req, 'config.theme.reset', 'SiteConfig', '1');
    return reply.send({ ok: true, theme: next.theme });
  });
};
