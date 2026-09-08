import { randomBytes } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { env } from '../../env.js';
import { audit } from '../../lib/audit.js';
import { hashPassword, requireAdmin, requireOwner } from '../../lib/auth.js';
import { clientIp } from '../../lib/security.js';
import { getSiteConfig } from '../../services/config.js';
import { sha256 } from '../../services/crypto.js';
import { renderTemplate } from '../../services/emailTemplates.js';
import { sendMail } from '../../services/mailer.js';

/**
 * Usuários do painel.
 *
 * Dois papéis: `owner` (admin — gerencia usuários, gateway e segredos) e
 * `editor` (usuário — mexe em conteúdo, aparência, escassez, links e vê as
 * métricas). Tudo aqui é só para `owner`; o editor cuida da própria conta
 * pelas rotas de `auth`.
 *
 * Convite: a conta nasce com uma senha aleatória que ninguém conhece e um
 * link de uso único (mesma tabela da recuperação de senha, prazo maior). A
 * pessoa cria a própria senha pelo link; até lá, a conta existe mas não
 * entra. Nunca mandamos senha por e-mail.
 */

const INVITE_TTL_H = 48;

const inviteBody = z.object({
  email: z.string().trim().email().max(200),
  name: z.string().trim().min(2).max(80),
  role: z.enum(['owner', 'editor']).default('editor'),
});

const idParams = z.object({ id: z.string().uuid() });

function inviteLink(token: string): string {
  return `${env.PUBLIC_URL}/admin#convite=${token}`;
}

/** Cria o token de convite e envia o e-mail. Invalida convites anteriores. */
async function issueInvite(user: { id: string; email: string; name: string | null }, invitedBy: string, ip: string) {
  const token = randomBytes(32).toString('base64url');

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + INVITE_TTL_H * 3_600_000),
        ip,
      },
    }),
  ]);

  const cfg = await getSiteConfig();
  const tpl = renderTemplate(cfg.email.templates.user_invite, {
    nome: user.name || user.email.split('@')[0],
    convidado_por: invitedBy,
    link_convite: inviteLink(token),
    horas: INVITE_TTL_H,
  });
  return sendMail({ to: user.email, subject: tpl.subject, text: tpl.body, template: 'user_invite' });
}

type Status = 'ativo' | 'convite_enviado' | 'convite_expirado' | 'bloqueado';

export const usersRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireAdmin());
  app.addHook('preHandler', requireOwner());

  app.get('/users', async (req, reply) => {
    const users = await prisma.adminUser.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      include: {
        passwordResets: { orderBy: { createdAt: 'desc' }, take: 1, select: { expiresAt: true, usedAt: true, createdAt: true } },
      },
    });

    const now = Date.now();
    return reply.send({
      me: req.admin!.sub,
      users: users.map((u) => {
        const last = u.passwordResets[0];
        let status: Status = 'ativo';
        if (!u.lastLoginAt) {
          // Token usado = a pessoa já criou a senha pelo link; só falta entrar.
          if (last?.usedAt) status = 'ativo';
          else status = last && last.expiresAt.getTime() > now ? 'convite_enviado' : 'convite_expirado';
        } else if (u.lockedUntil && u.lockedUntil.getTime() > now) {
          status = 'bloqueado';
        }
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          role: u.role,
          status,
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
          inviteSentAt: !u.lastLoginAt ? last?.createdAt ?? null : null,
          inviteExpiresAt: !u.lastLoginAt ? last?.expiresAt ?? null : null,
        };
      }),
    });
  });

  app.post('/users/invite', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const parsed = inviteBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'dados_invalidos', message: parsed.error.issues[0]?.message });

    const email = parsed.data.email.toLowerCase();
    if (await prisma.adminUser.findUnique({ where: { email } })) {
      return reply.code(409).send({ error: 'email_em_uso', message: 'Já existe um usuário com este e-mail.' });
    }

    const user = await prisma.adminUser.create({
      data: {
        email,
        name: parsed.data.name,
        role: parsed.data.role,
        // Senha que ninguém conhece: a pessoa define a dela pelo link.
        passwordHash: await hashPassword(randomBytes(32).toString('base64url')),
        mustChangePassword: false,
      },
    });

    const inviter = await prisma.adminUser.findUnique({ where: { id: req.admin!.sub }, select: { name: true, email: true } });
    const mail = await issueInvite(user, inviter?.name || inviter?.email || 'Um administrador', clientIp(req, env.TRUST_CLOUDFLARE));

    await audit(req, 'user.invite', 'AdminUser', user.id, { email, role: parsed.data.role, emailOk: mail.ok });
    return reply.code(201).send({ ok: true, id: user.id, email: { ok: mail.ok, error: mail.error ?? null } });
  });

  app.post('/users/:id/resend-invite', { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });

    const user = await prisma.adminUser.findUnique({ where: { id: params.data.id } });
    if (!user) return reply.code(404).send({ error: 'not_found' });
    if (user.lastLoginAt) {
      return reply.code(409).send({ error: 'usuario_ativo', message: 'Esta pessoa já entrou no painel; use "esqueci minha senha" se precisar.' });
    }

    const inviter = await prisma.adminUser.findUnique({ where: { id: req.admin!.sub }, select: { name: true, email: true } });
    const mail = await issueInvite(user, inviter?.name || inviter?.email || 'Um administrador', clientIp(req, env.TRUST_CLOUDFLARE));

    await audit(req, 'user.resend_invite', 'AdminUser', user.id, { emailOk: mail.ok });
    return reply.send({ ok: true, email: { ok: mail.ok, error: mail.error ?? null } });
  });

  app.put('/users/:id/role', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    const body = z.object({ role: z.enum(['owner', 'editor']) }).safeParse(req.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'dados_invalidos' });

    const user = await prisma.adminUser.findUnique({ where: { id: params.data.id } });
    if (!user) return reply.code(404).send({ error: 'not_found' });

    // Rebaixar o último admin deixaria o painel sem ninguém para gerenciar.
    if (user.role === 'owner' && body.data.role === 'editor') {
      const owners = await prisma.adminUser.count({ where: { role: 'owner', disabledAt: null } });
      if (owners <= 1) {
        return reply.code(409).send({ error: 'ultimo_admin', message: 'Precisa haver ao menos um administrador.' });
      }
    }

    await prisma.adminUser.update({ where: { id: user.id }, data: { role: body.data.role } });
    // O papel vive no access token; derrubar as sessões força um token novo.
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });

    await audit(req, 'user.role', 'AdminUser', user.id, { from: user.role, to: body.data.role });
    return reply.send({ ok: true });
  });

  app.delete('/users/:id', async (req, reply) => {
    const params = idParams.safeParse(req.params);
    if (!params.success) return reply.code(404).send({ error: 'not_found' });

    if (params.data.id === req.admin!.sub) {
      return reply.code(409).send({ error: 'proprio_usuario', message: 'Você não pode excluir a própria conta.' });
    }

    const user = await prisma.adminUser.findUnique({ where: { id: params.data.id } });
    if (!user) return reply.code(404).send({ error: 'not_found' });

    if (user.role === 'owner') {
      const owners = await prisma.adminUser.count({ where: { role: 'owner', disabledAt: null } });
      if (owners <= 1) {
        return reply.code(409).send({ error: 'ultimo_admin', message: 'Precisa haver ao menos um administrador.' });
      }
    }

    await prisma.$transaction([
      prisma.refreshToken.deleteMany({ where: { userId: user.id } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: user.id } }),
      prisma.adminUser.delete({ where: { id: user.id } }),
    ]);

    await audit(req, 'user.delete', 'AdminUser', user.id, { email: user.email, role: user.role });
    return reply.send({ ok: true });
  });
};
