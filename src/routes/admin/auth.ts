import type { FastifyPluginAsync } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { clientIp } from '../../lib/security.js';
import { audit } from '../../lib/audit.js';
import { getSiteConfig } from '../../services/config.js';
import { sha256 } from '../../services/crypto.js';
import { renderTemplate } from '../../services/emailTemplates.js';
import { sendMail } from '../../services/mailer.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  hashPassword,
  issueRefreshToken,
  requireAdmin,
  revokeRefreshToken,
  rotateRefreshToken,
  setAuthCookies,
  signAccessToken,
  verifyPassword,
} from '../../lib/auth.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

const loginBody = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
});

const passwordBody = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z
    .string()
    .min(12, 'A senha precisa de pelo menos 12 caracteres')
    .max(200)
    .regex(/[a-z]/, 'Inclua ao menos uma letra minúscula')
    .regex(/[A-Z]/, 'Inclua ao menos uma letra maiúscula')
    .regex(/[0-9]/, 'Inclua ao menos um número'),
});

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Login.
   *
   * Rate limit apertado + lockout por usuário. A resposta é sempre a mesma
   * mensagem genérica: dizer "e-mail não existe" entregaria de graça quais
   * contas são válidas.
   */
  app.post(
    '/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const parsed = loginBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'dados_invalidos' });

      const { email, password } = parsed.data;
      const user = await prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });

      const genericFailure = { error: 'credenciais_invalidas' as const };

      if (!user || user.disabledAt) {
        // Gasta tempo parecido com o de uma verificação real, para o tempo de
        // resposta não revelar se o e-mail existe.
        await verifyPassword(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin');
        return reply.code(401).send(genericFailure);
      }

      if (user.lockedUntil && user.lockedUntil > new Date()) {
        const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
        return reply.code(423).send({ error: 'conta_bloqueada', minutes });
      }

      const ok = await verifyPassword(password, user.passwordHash);

      if (!ok) {
        const attempts = user.failedAttempts + 1;
        const lock = attempts >= MAX_ATTEMPTS;
        await prisma.adminUser.update({
          where: { id: user.id },
          data: {
            failedAttempts: lock ? 0 : attempts,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
          },
        });
        if (lock) return reply.code(423).send({ error: 'conta_bloqueada', minutes: LOCK_MINUTES });
        return reply.code(401).send(genericFailure);
      }

      await prisma.adminUser.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      });

      const ip = clientIp(req, env.TRUST_CLOUDFLARE);
      const accessToken = await signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      });
      const refreshToken = await issueRefreshToken(user.id, ip, req.headers['user-agent']);
      setAuthCookies(reply, accessToken, refreshToken);

      return reply.send({
        user: { email: user.email, name: user.name, role: user.role },
        mustChangePassword: user.mustChangePassword,
      });
    },
  );

  /** Renova o access token a partir do refresh, com rotação. */
  app.post('/auth/refresh', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const current = req.cookies[REFRESH_COOKIE];
    if (!current) return reply.code(401).send({ error: 'nao_autenticado' });

    const rotated = await rotateRefreshToken(current, clientIp(req, env.TRUST_CLOUDFLARE), req.headers['user-agent']);
    if (!rotated) {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: 'sessao_expirada' });
    }

    const user = await prisma.adminUser.findUnique({ where: { id: rotated.userId } });
    if (!user || user.disabledAt) {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: 'sessao_expirada' });
    }

    const accessToken = await signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    });
    setAuthCookies(reply, accessToken, rotated.token);
    return reply.send({ ok: true, mustChangePassword: user.mustChangePassword });
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[REFRESH_COOKIE];
    if (token) await revokeRefreshToken(token);
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  app.get('/auth/me', { preHandler: requireAdmin({ allowPasswordChange: true }) }, async (req, reply) => {
    const user = await prisma.adminUser.findUnique({
      where: { id: req.admin!.sub },
      select: { email: true, name: true, role: true, mustChangePassword: true, lastLoginAt: true },
    });
    if (!user) {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: 'nao_autenticado' });
    }
    return reply.send(user);
  });

  /**
   * Troca de senha. Acessível mesmo com `mustChangePassword`, senão o usuário
   * do primeiro login ficaria travado sem saída.
   *
   * Revoga todos os refresh tokens: trocar a senha derruba as outras sessões,
   * que é o comportamento esperado se a troca foi motivada por suspeita.
   */
  app.put(
    '/auth/password',
    { preHandler: requireAdmin({ allowPasswordChange: true }), config: { rateLimit: { max: 5, timeWindow: '5 minutes' } } },
    async (req, reply) => {
      const parsed = passwordBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'senha_fraca', message: parsed.error.issues[0]?.message });
      }

      const user = await prisma.adminUser.findUnique({ where: { id: req.admin!.sub } });
      if (!user) return reply.code(401).send({ error: 'nao_autenticado' });

      if (!(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
        return reply.code(401).send({ error: 'senha_atual_incorreta' });
      }
      if (parsed.data.currentPassword === parsed.data.newPassword) {
        return reply.code(400).send({ error: 'senha_repetida', message: 'A nova senha precisa ser diferente da atual' });
      }

      await prisma.adminUser.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(parsed.data.newPassword), mustChangePassword: false },
      });
      await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });

      await audit(req, 'password.change', 'AdminUser', user.id);

      const accessToken = await signAccessToken({
        sub: user.id,
        email: user.email,
        role: user.role,
        mustChangePassword: false,
      });
      const refreshToken = await issueRefreshToken(user.id, clientIp(req, env.TRUST_CLOUDFLARE), req.headers['user-agent']);
      setAuthCookies(reply, accessToken, refreshToken);

      return reply.send({ ok: true });
    },
  );

  /** Usado pelo painel para saber se já existe sessão sem precisar de 401 no console. */
  app.get('/auth/status', async (req, reply) => {
    return reply.send({ authenticated: Boolean(req.cookies[ACCESS_COOKIE] || req.cookies[REFRESH_COOKIE]) });
  });

  /* ------------------------------------------------------------------ *
   * Esqueci a senha
   *
   * Responde sempre a mesma coisa, exista o e-mail ou não: dizer "não
   * encontramos essa conta" entregaria de graça quais e-mails são admins.
   * O token vive 30 minutos, é de uso único e só o hash fica no banco.
   * ------------------------------------------------------------------ */
  const RESET_TTL_MIN = 30;

  app.post(
    '/auth/forgot',
    { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const parsed = z.object({ email: z.string().email().max(200) }).safeParse(req.body);
      const generic = { ok: true, message: 'Se este e-mail tiver acesso ao painel, o link de redefinição chega em instantes.' };
      if (!parsed.success) return reply.send(generic);

      const user = await prisma.adminUser.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
      if (!user || user.disabledAt) return reply.send(generic);

      const token = randomBytes(32).toString('base64url');
      await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000),
          ip: clientIp(req, env.TRUST_CLOUDFLARE),
        },
      });

      const cfg = await getSiteConfig();
      const tpl = renderTemplate(cfg.email.templates.password_reset, {
        nome: user.name || user.email.split('@')[0],
        link_reset: `${env.PUBLIC_URL}/admin#reset=${token}`,
        minutos: RESET_TTL_MIN,
      });
      // Não esperamos o e-mail: o tempo de resposta não pode revelar se a
      // conta existe.
      sendMail({ to: user.email, subject: tpl.subject, text: tpl.body, template: 'password_reset' }).catch(() => undefined);

      await audit(req, 'password.forgot', 'AdminUser', user.id);
      return reply.send(generic);
    },
  );

  app.post(
    '/auth/reset',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const parsed = z
        .object({ token: z.string().min(20).max(200), newPassword: passwordBody.shape.newPassword })
        .safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'senha_fraca', message: parsed.error.issues[0]?.message });
      }

      const record = await prisma.passwordResetToken.findUnique({
        where: { tokenHash: sha256(parsed.data.token) },
        include: { user: true },
      });
      if (!record || record.usedAt || record.expiresAt < new Date() || record.user.disabledAt) {
        return reply.code(400).send({ error: 'link_invalido', message: 'Este link já foi usado ou expirou. Peça outro.' });
      }

      await prisma.$transaction([
        prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
        prisma.adminUser.update({
          where: { id: record.userId },
          data: {
            passwordHash: await hashPassword(parsed.data.newPassword),
            mustChangePassword: false,
            failedAttempts: 0,
            lockedUntil: null,
          },
        }),
        // Redefinir a senha derruba toda sessão aberta — inclusive a de quem
        // eventualmente roubou a antiga.
        prisma.refreshToken.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);

      await audit(req, 'password.reset', 'AdminUser', record.userId);
      return reply.send({ ok: true });
    },
  );
};
