import { randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { env, isProd } from '../env.js';
import { prisma } from '../db.js';
import { sha256 } from '../services/crypto.js';

const SECRET = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'codigo-vencedor';

export const ACCESS_COOKIE = 'cv_at';
export const REFRESH_COOKIE = 'cv_rt';

const ACCESS_TTL_S = 15 * 60; // 15 minutos
const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/**
 * Janela de tolerância na rotação do refresh token.
 *
 * Reuso de token revogado é o sinal clássico de token roubado, e a resposta
 * certa é revogar a família toda. O problema é que concorrência legítima
 * produz o mesmo sinal: duas abas do painel abertas, ou um retry de rede,
 * apresentam o mesmo token quase ao mesmo tempo; a primeira rotaciona, a
 * segunda chega com um token que acabou de ser revogado — e a sessão de 7
 * dias morria por causa de uma aba a mais.
 *
 * Dentro desta janela, um token revogado há instantes recebe um token novo
 * em vez de derrubar a família. Fora dela, a detecção continua igual.
 *
 * O que isto NÃO afrouxa: um token roubado e usado *antes* do cliente
 * legítimo rotacionar continua sendo pego, porque é a rotação do cliente
 * legítimo que vai encontrar o token revogado — e ela acontece bem depois
 * de dez segundos. A janela só perdoa uso simultâneo, que é exatamente o
 * caso legítimo.
 *
 * Recomendação do RFC 9700 (Best Current Practice for OAuth 2.0 Security),
 * seção 4.14.2.
 */
const ROTATION_GRACE_MS = 10 * 1000;

/** Custo 12: ~0,5s por verificação. Lento de propósito — é o que torna
 *  força bruta cara. Combinado com o lockout, cobre o caso comum. */
const BCRYPT_ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface AccessClaims {
  sub: string;
  email: string;
  role: 'owner' | 'editor';
  mustChangePassword: boolean;
}

export async function signAccessToken(claims: AccessClaims): Promise<string> {
  return new SignJWT({ email: claims.email, role: claims.role, mcp: claims.mustChangePassword })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_S}s`)
    .sign(SECRET);
}

export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { issuer: ISSUER });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role === 'owner' ? 'owner' : 'editor',
      mustChangePassword: payload.mcp === true,
    };
  } catch {
    return null;
  }
}

/**
 * Cria um refresh token novo. O valor em claro só existe nesta função e no
 * cookie do navegador; o banco guarda apenas o hash.
 */
export async function issueRefreshToken(userId: string, ip?: string, userAgent?: string): Promise<string> {
  const token = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      ip: ip ?? null,
      userAgent: userAgent?.slice(0, 300) ?? null,
    },
  });
  return token;
}

/**
 * Troca um refresh token por outro (rotação). Se o token apresentado já
 * estiver revogado, revogamos toda a família do usuário: é o sinal clássico
 * de token roubado sendo reusado — a menos que a revogação tenha acabado de
 * acontecer, o que é concorrência legítima e não roubo (ver
 * `ROTATION_GRACE_MS`).
 */
export async function rotateRefreshToken(
  token: string,
  ip?: string,
  userAgent?: string,
): Promise<{ userId: string; token: string } | null> {
  const record = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!record) return null;

  /* Expirado é diferente de reusado: quem passou dos 7 dias só precisa
     entrar de novo, e derrubar a família aqui não protegeria nada. */
  if (record.expiresAt < new Date()) return null;

  if (record.revokedAt) {
    const revogadoHa = Date.now() - record.revokedAt.getTime();

    /* Revogado há mais que a janela é reuso de verdade: cai a família toda,
       inclusive o token que estiver em uso neste instante. */
    if (revogadoHa > ROTATION_GRACE_MS) {
      await prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return null;
    }

    /* Dentro da janela: é a segunda aba (ou o retry) chegando com o token
       que a primeira acabou de trocar. Emite um token próprio para ela em
       vez de encerrar a sessão das duas. */
    const next = await issueRefreshToken(record.userId, ip, userAgent);
    return { userId: record.userId, token: next };
  }

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const next = await issueRefreshToken(record.userId, ip, userAgent);
  return { userId: record.userId, token: next };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken
    .updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

const cookieBase = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'strict' as const,
  path: '/',
};

export function setAuthCookies(reply: FastifyReply, accessToken: string, refreshToken: string): void {
  reply.setCookie(ACCESS_COOKIE, accessToken, { ...cookieBase, maxAge: ACCESS_TTL_S });
  reply.setCookie(REFRESH_COOKIE, refreshToken, { ...cookieBase, maxAge: REFRESH_TTL_MS / 1000 });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, cookieBase);
  reply.clearCookie(REFRESH_COOKIE, cookieBase);
}

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AccessClaims;
  }
}

/**
 * Guarda das rotas do painel.
 *
 * `allowPasswordChange` libera as duas rotas que um usuário com senha
 * expirada ainda precisa acessar — sem isso ele ficaria preso: não pode usar
 * o painel sem trocar a senha, e não poderia trocar a senha sem usar o painel.
 */
export function requireAdmin(opts: { allowPasswordChange?: boolean } = {}) {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const token = req.cookies[ACCESS_COOKIE];
    const claims = token ? await verifyAccessToken(token) : null;

    if (!claims) {
      await reply.code(401).send({ error: 'nao_autenticado' });
      return;
    }
    if (claims.mustChangePassword && !opts.allowPasswordChange) {
      await reply.code(403).send({ error: 'troca_de_senha_obrigatoria' });
      return;
    }
    req.admin = claims;
  };
}

export function requireOwner() {
  return async function (req: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (req.admin?.role !== 'owner') {
      await reply.code(403).send({ error: 'permissao_insuficiente' });
    }
  };
}
