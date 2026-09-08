import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { requireAdmin } from '../../lib/auth.js';
import { emailSchema, getSiteConfig, saveSiteConfig } from '../../services/config.js';
import { DEFAULT_TEMPLATES, TEMPLATE_META, renderTemplate, type TemplateId } from '../../services/emailTemplates.js';
import { invalidateMailerCache, sendMail, verifyMailer } from '../../services/mailer.js';
import { SECRET_KEYS, secretsStatus, setSecret } from '../../services/secrets.js';

/**
 * E-mail: provedor, remetente, templates e regras de recuperação.
 *
 * A senha do SMTP (no Gmail, a "senha de app") é um segredo como os do
 * gateway: entra cifrada, nunca volta ao navegador. Vazio no PUT preserva
 * a atual; string vazia explícita apaga.
 */

const putBody = z.object({
  email: emailSchema.partial().optional(),
  secrets: z.record(z.string().max(500)).optional(),
});

const EMAIL_SECRETS = [SECRET_KEYS.emailApiKey];

export const emailRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());

  app.get('/email', async (_req, reply) => {
    const cfg = await getSiteConfig();
    const recent = await prisma.emailLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, to: true, template: true, provider: true, status: true, error: true, sentAt: true, createdAt: true },
    });
    return reply.send({
      email: cfg.email,
      secrets: await secretsStatus(EMAIL_SECRETS),
      meta: TEMPLATE_META,
      defaults: DEFAULT_TEMPLATES,
      recent,
    });
  });

  app.put('/email', async (req, reply) => {
    const parsed = putBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'dados_invalidos',
        issues: parsed.error.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
      });
    }

    const before = await getSiteConfig();
    let next = before;

    if (parsed.data.email) {
      // O schema é parcial só na borda: por dentro a config é sempre inteira.
      const merged = {
        ...before.email,
        ...parsed.data.email,
        smtp: { ...before.email.smtp, ...(parsed.data.email.smtp ?? {}) },
        templates: { ...before.email.templates, ...(parsed.data.email.templates ?? {}) },
        recovery: { ...before.email.recovery, ...(parsed.data.email.recovery ?? {}) },
      };
      next = await saveSiteConfig({ email: merged }, req.admin!.email);
    }

    const touched: string[] = [];
    for (const [key, value] of Object.entries(parsed.data.secrets ?? {})) {
      if (!(EMAIL_SECRETS as string[]).includes(key)) continue;
      await setSecret(key as (typeof EMAIL_SECRETS)[number], value, req.admin!.email);
      touched.push(key);
    }

    invalidateMailerCache();
    await audit(req, 'email.update', 'SiteConfig', '1', {
      provider: next.email.provider,
      smtp: { ...next.email.smtp },
      secrets: touched,
    });

    return reply.send({ ok: true, email: next.email, secrets: await secretsStatus(EMAIL_SECRETS) });
  });

  /** Autentica no servidor sem enviar nada. */
  app.post('/email/test-connection', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (_req, reply) => {
    invalidateMailerCache();
    return reply.send(await verifyMailer());
  });

  /** Envia um template de verdade para um endereço de teste, com dados fictícios. */
  app.post('/email/send-test', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const body = z
      .object({
        to: z.string().email().max(200),
        template: z.enum(['purchase_approved', 'checkout_abandoned', 'pix_abandoned', 'password_reset', 'user_invite']),
      })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'dados_invalidos' });

    const cfg = await getSiteConfig();
    const id = body.data.template as TemplateId;
    const tpl = renderTemplate(cfg.email.templates[id], {
      nome: 'Maria',
      email: body.data.to,
      pedido: 'CV-TESTE1',
      valor: (cfg.content.priceCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
      link_acesso: cfg.email.accessUrl || '(link de acesso)',
      link_checkout: '(link do checkout)',
      link_reset: '(link de redefinição)',
      link_convite: '(link do convite)',
      convidado_por: req.admin!.email,
      minutos: 30,
      horas: 48,
      suporte: cfg.links.whatsapp.number || '(WhatsApp de suporte)',
    });

    const result = await sendMail({
      to: body.data.to,
      subject: `[TESTE] ${tpl.subject}`,
      text: tpl.body,
      template: `${id}:teste`,
    });
    await audit(req, 'email.test', 'SiteConfig', '1', { to: body.data.to, template: id, ok: result.ok });
    return reply.send(result);
  });
};
