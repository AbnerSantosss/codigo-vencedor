import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import { env, isProd } from './env.js';
import { adminCsp, baseSecurityHeaders, clientIp, lpCsp, newNonce } from './lib/security.js';
import { renderHtml } from './lib/html.js';
import { ensureVisitorId } from './lib/visitor.js';
import { publicRoutes } from './routes/public.js';
import { trackRoutes } from './routes/track.js';
import { checkoutRoutes } from './routes/checkout.js';
import { webhookRoutes } from './routes/webhooks.js';
import { adminRoutes } from './routes/admin/index.js';
import { getSiteConfig } from './services/config.js';
import { startRecoveryJob } from './services/recovery.js';
import { startOutboundJob } from './services/outbound.js';

const here = dirname(fileURLToPath(import.meta.url));
/** Em dev roda de src/, em produção de dist/ — os dois estão um nível abaixo da raiz. */
const root = join(here, '..');
const PUBLIC_DIR = join(root, 'public');
/**
 * Painel administrativo em React, compilado por Vite (`npm run build:panel`).
 *
 * O painel vanilla continua em `admin/`, servido em `/admin-legacy`, como
 * rede de segurança durante a transição: se alguma tela nova sair
 * incompleta, o dono não fica sem painel. Some quando ele der o ok.
 */
const PANEL_DIR = join(root, 'panel', 'dist');
const ADMIN_LEGACY_DIR = join(root, 'admin');

const app = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    transport: isProd ? undefined : { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } },
    /** Nunca logar corpo de checkout, cookie ou Authorization. */
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'req.body.cpf', 'req.body.email'],
      remove: true,
    },
  },
  trustProxy: env.TRUST_CLOUDFLARE,
  bodyLimit: 16 * 1024,
  disableRequestLogging: false,
});

/* ------------------------------------------------------------------ *
 * Plugins
 * ------------------------------------------------------------------ */
await app.register(fastifyCookie);

await app.register(fastifyRateLimit, {
  global: false,
  keyGenerator: (req) => clientIp(req, env.TRUST_CLOUDFLARE),
  addHeadersOnExceeding: { 'x-ratelimit-remaining': true },
});

/* ------------------------------------------------------------------ *
 * Headers de segurança + nonce por request
 * ------------------------------------------------------------------ */
declare module 'fastify' {
  interface FastifyRequest {
    cspNonce: string;
  }
}

app.decorateRequest('cspNonce', '');

app.addHook('onRequest', async (req, reply) => {
  req.cspNonce = newNonce();
  baseSecurityHeaders(reply);
});

/* ------------------------------------------------------------------ *
 * Arquivos estáticos
 *
 * Os assets (imagens, vídeo, css, js) são imutáveis na prática: quando mudam,
 * mudam de conteúdo e o deploy é novo. Cache longo aqui é o que evita o vídeo
 * de 10 MB atravessar o túnel Cloudflare a cada visita.
 * ------------------------------------------------------------------ */
// `cacheControl: false` é necessário: com ele ligado o @fastify/static
// escreve o próprio Cache-Control DEPOIS do setHeaders, e o valor definido
// aqui era descartado silenciosamente.
await app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: '/',
  index: false,
  cacheControl: false,
  // O HTML é servido pelas rotas abaixo, com nonce; aqui só o resto.
  setHeaders(reply, path) {
    if (path.endsWith('.html')) {
      reply.header('Cache-Control', 'no-store');
      return;
    }
    reply.header('Cache-Control', isProd ? 'public, max-age=31536000, immutable' : 'no-cache');
  },
});

/**
 * Bundle do painel React.
 *
 * Os arquivos de `assets/` levam hash do conteúdo no nome, então podem ser
 * cacheados para sempre — o deploy novo tem nome novo. O `index.html`, que é
 * quem aponta para eles, é servido pela rota `/admin` com `no-store`: é essa
 * combinação que impede um painel velho de conversar com uma API nova.
 */
await app.register(fastifyStatic, {
  root: PANEL_DIR,
  prefix: '/admin/',
  index: false,
  decorateReply: false,
  cacheControl: false,
  setHeaders(reply, path) {
    if (path.endsWith('.html')) {
      reply.header('Cache-Control', 'no-store');
      return;
    }
    reply.header('Cache-Control', isProd ? 'public, max-age=31536000, immutable' : 'no-store');
  },
});

await app.register(fastifyStatic, {
  root: ADMIN_LEGACY_DIR,
  prefix: '/admin-legacy/',
  index: false,
  decorateReply: false,
  cacheControl: false,
  setHeaders(reply) {
    // O painel antigo nunca é cacheado: uma versão velha do app.js aqui
    // significa um painel que não bate com a API.
    reply.header('Cache-Control', 'no-store');
  },
});

/* ------------------------------------------------------------------ *
 * Páginas
 * ------------------------------------------------------------------ */
/**
 * O preço aparece no `<title>`, na meta description, no OG e no JSON-LD —
 * lugares que o `lp.js` não alcança, porque buscadores e o robô do WhatsApp
 * não executam JavaScript. Por isso ele é injetado aqui, junto com o nonce:
 * mudar o preço no painel muda também o que aparece no Google e no preview
 * de link, sem redeploy.
 */
async function sendLpPage(file: string, req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) {
  const nonce = req.cspNonce;

  /**
   * O cookie de visitante nasce aqui porque é a navegação que marca a
   * chegada de uma pessoa. Emitir numa rota de API seria pior: o
   * `sendBeacon` de um evento poderia criar visitante antes de haver
   * página, e um `curl` de teste ganharia um id que nunca se repete.
   *
   * Sem `await`: só escreve um cabeçalho `Set-Cookie` na resposta.
   */
  ensureVisitorId(req, reply);

  const cfg = await getSiteConfig();
  const cents = cfg.content.priceCents;

  const html = await renderHtml(join(PUBLIC_DIR, file), {
    nonce,
    price: (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
    priceDecimal: (cents / 100).toFixed(2),
  });
  return reply
    .header('Content-Security-Policy', lpCsp(nonce))
    .header('Cache-Control', 'no-store')
    .type('text/html; charset=utf-8')
    .send(html);
}

app.get('/', (req, reply) => sendLpPage('index.html', req, reply));
app.get('/obrigado', (req, reply) => sendLpPage('obrigado.html', req, reply));
app.get('/termos', (req, reply) => sendLpPage('termos.html', req, reply));
app.get('/privacidade', (req, reply) => sendLpPage('privacidade.html', req, reply));

/**
 * Painel — a casca do React.
 *
 * O bundle é carregado por `<script src>` da própria origem, coberto pelo
 * `script-src 'self'`; o nonce continua sendo emitido porque a CSP o exige
 * para qualquer script inline, e é o que garante que um `<script>` injetado
 * por outro caminho não execute.
 */
async function sendPanel(dir: string, req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) {
  const nonce = req.cspNonce;

  let html: string;
  try {
    html = await renderHtml(join(dir, 'index.html'), { nonce });
  } catch {
    /**
     * O bundle não existe: alguém subiu o servidor sem compilar o painel.
     * Uma pilha de erro aqui não diz o que fazer — esta mensagem diz, e
     * aponta o painel antigo, que não depende de build.
     */
    req.log.error({ dir }, 'painel não compilado');
    return reply
      .code(503)
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(
        '<!doctype html><meta charset="utf-8"><title>Painel não compilado</title>' +
          '<body><h1>O painel ainda não foi compilado</h1>' +
          '<p>Rode <code>npm run build:panel</code> na pasta do projeto e recarregue.</p>' +
          '<p>Enquanto isso, o painel anterior continua disponível em <a href="/admin-legacy">/admin-legacy</a>.</p>',
      );
  }
  return reply
    .header('Content-Security-Policy', adminCsp(nonce))
    .header('Cache-Control', 'no-store')
    // O painel nunca deve ser indexado nem pré-carregado por buscador.
    .header('X-Robots-Tag', 'noindex, nofollow, noarchive')
    .type('text/html; charset=utf-8')
    .send(html);
}

app.get('/admin', (req, reply) => sendPanel(PANEL_DIR, req, reply));

/**
 * Painel antigo (vanilla), mantido durante a transição para o React.
 * Mesma API, mesma sessão, mesma CSP.
 */
app.get('/admin-legacy', (req, reply) => sendPanel(ADMIN_LEGACY_DIR, req, reply));

/* ------------------------------------------------------------------ *
 * Saúde — o Portainer usa isto no healthcheck do container
 * ------------------------------------------------------------------ */
app.get('/healthz', async () => ({ ok: true, ts: new Date().toISOString() }));

/* ------------------------------------------------------------------ *
 * Rotas de negócio
 * ------------------------------------------------------------------ */
await app.register(publicRoutes);
await app.register(trackRoutes);
await app.register(checkoutRoutes);
await app.register(adminRoutes, { prefix: '/api/admin' });
await app.register(webhookRoutes, { prefix: '/webhooks' });

/* ------------------------------------------------------------------ *
 * Erros
 * ------------------------------------------------------------------ */
app.setNotFoundHandler(async (req, reply) => {
  if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not_found' });
  return reply.code(404).type('text/html; charset=utf-8').send(
    '<!doctype html><meta charset="utf-8"><title>Página não encontrada</title>' +
      '<body style="background:#070a08;color:#fff;font:16px system-ui;display:grid;place-items:center;min-height:100vh;margin:0">' +
      '<div style="text-align:center"><h1>404</h1><p>Esta página não existe.</p><p><a href="/" style="color:#f5c518">Voltar ao início</a></p></div>',
  );
});

app.setErrorHandler((err: import('fastify').FastifyError, req, reply) => {
  const status = err.statusCode ?? 500;
  if (status >= 500) req.log.error({ err }, 'erro não tratado');
  // Nunca vazar stack ou detalhe interno para o cliente.
  const body = status >= 500 ? { error: 'internal_error' } : { error: err.code ?? 'bad_request', message: err.message };
  return reply.code(status).send(body);
});

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
try {
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`Código Vencedor no ar em ${env.PUBLIC_URL}`);
  // Expira Pix vencido e dispara os e-mails de recuperação, a cada minuto.
  startRecoveryJob(app.log);
  // Drena as entregas de webhook que falharam e já venceram a espera.
  startOutboundJob(app.log);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`${signal} recebido, encerrando`);
    await app.close();
    process.exit(0);
  });
}
