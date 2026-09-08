import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProd } from '../env.js';

/**
 * Content-Security-Policy da landing page.
 *
 * A LP não tem script inline nosso — o nonce existe só para o carregador do
 * GTM, que o `lp.js` injeta. Tags de HTML customizado criadas dentro do GTM
 * herdam o nonce automaticamente porque o próprio gtm.js o propaga.
 *
 * Os domínios da Meta continuam liberados mesmo com a Conversions API sendo
 * server-side: se o usuário criar uma tag de Pixel dentro do GTM, ela precisa
 * carregar. Sem isso a tag falharia silenciosamente e o problema seria
 * difícil de achar.
 */
export function lpCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.googletagmanager.com https://connect.facebook.net`,
    "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://www.googletagmanager.com https://www.facebook.com https://stats.g.doubleclick.net",
    "img-src 'self' data: https://www.googletagmanager.com https://www.google-analytics.com https://www.facebook.com",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    'frame-src https://www.googletagmanager.com',
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // 'self' e não 'none': continua bloqueando clickjacking de outra origem,
    // mas deixa o próprio painel embutir a página na prévia de Aparência.
    "frame-ancestors 'self'",
  ].join('; ');
}

/**
 * CSP do painel admin. Mais fechada que a da LP: nenhum domínio de
 * rastreamento, nada de terceiros. O Chart.js é servido localmente
 * justamente para não precisar liberar CDN aqui.
 */
export function adminCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    /**
     * O nonce também no `style-src`, e a razão é concreta.
     *
     * O painel em React usa o Dialog do Radix, e ele trava a rolagem do
     * fundo inserindo um `<style>` no documento (via `react-remove-scroll`).
     * Com o nonce apenas em `script-src`, essa folha era **bloqueada** — o
     * modal abria com o fundo rolando atrás, sem erro visível para o
     * usuário. O teste no Chrome mostrou a violação:
     *
     *   style-src-elem · "Applying inline style violates … 'style-src 'self''"
     *
     * A alternativa seria `unsafe-inline`, que liberaria QUALQUER estilo
     * inline — inclusive um injetado por XSS para redesenhar a tela ou
     * exfiltrar dado por seletor de atributo. O nonce libera só o que carrega
     * o valor aleatório desta requisição, que o atacante não tem.
     *
     * `style-src-attr` continua caindo em `style-src` e, como nonce não se
     * aplica a atributo, `style=""` permanece proibido no painel. Estilo
     * dinâmico continua sendo escrito por CSSOM (a prop `style` do React),
     * que a CSP permite.
     */
    `style-src 'self' 'nonce-${nonce}'`,
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
}

export function newNonce(): string {
  return randomBytes(16).toString('base64');
}

/** Headers aplicados a toda resposta. */
export function baseSecurityHeaders(reply: FastifyReply): void {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()');
  reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  // SAMEORIGIN, não DENY: navegadores antigos ignoram frame-ancestors e
  // usariam este header, que bloquearia a prévia do painel.
  reply.header('X-Frame-Options', 'SAMEORIGIN');
  if (isProd) {
    reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }
}

/**
 * IP real do visitante.
 *
 * Atrás do Cloudflare Tunnel o `request.ip` é sempre o do cloudflared, então
 * todo mundo cairia no mesmo balde de rate limit. `CF-Connecting-IP` só é
 * considerado quando TRUST_CLOUDFLARE está ligado — do contrário qualquer um
 * forjaria o header e escaparia do limite.
 */
export function clientIp(req: FastifyRequest, trustCloudflare: boolean): string {
  if (trustCloudflare) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.length > 0) return cf;
  }
  return req.ip;
}
