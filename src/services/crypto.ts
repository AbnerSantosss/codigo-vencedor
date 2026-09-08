import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

const KEY = Buffer.from(env.ENCRYPTION_KEY, 'base64');
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // tamanho recomendado para GCM
const VERSION = 'v1';

/**
 * Cifra um texto com AES-256-GCM.
 *
 * O formato de saída é `v1.<iv>.<tag>.<dados>`, tudo em base64url. O prefixo
 * de versão existe para permitir trocar de algoritmo ou rotacionar a chave no
 * futuro sem precisar adivinhar como cada registro antigo foi gravado.
 *
 * GCM é autenticado: se alguém alterar um byte no banco, o decifrar falha em
 * vez de devolver lixo silenciosamente.
 */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload: string): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Formato de dado cifrado desconhecido');
  }
  const [, ivB64, tagB64, dataB64] = parts as [string, string, string, string];
  const decipher = createDecipheriv(ALGO, KEY, Buffer.from(ivB64, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8');
}

/** Decifra sem lançar — para telas onde um registro corrompido não deve derrubar a listagem. */
export function tryDecrypt(payload: string | null | undefined): string | null {
  if (!payload) return null;
  try {
    return decrypt(payload);
  } catch {
    return null;
  }
}

/**
 * SHA-256 em minúsculas e sem espaços — o formato que Meta, TikTok e Kwai
 * exigem no Advanced Matching. É aqui que o dado do comprador deixa de ser
 * legível antes de sair do servidor.
 */
export function hashForMatching(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Telefone precisa virar só dígitos com DDI antes do hash. */
export function hashPhone(phone: string | null | undefined, ddi = '55'): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, '');
  if (!digits) return undefined;
  if (!digits.startsWith(ddi)) digits = ddi + digits;
  return createHash('sha256').update(digits, 'utf8').digest('hex');
}

/** Hash opaco usado para guardar refresh tokens e segredos de webhook. */
export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Comparação em tempo constante, para não vazar informação pelo tempo de resposta. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Máscara de CPF para exibição no painel: 123.***.**9-00 → só os 3 últimos. */
export function maskCpf(last3: string): string {
  return `***.***.**${last3.slice(0, 1)}-${last3.slice(1)}`;
}

export function maskEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  if (!domain) return '***';
  const visible = user.slice(0, Math.min(2, user.length));
  return `${visible}${'*'.repeat(Math.max(1, user.length - visible.length))}@${domain}`;
}
