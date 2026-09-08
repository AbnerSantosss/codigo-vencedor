import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * Build do painel administrativo.
 *
 * Três decisões que não são estilo, são segurança:
 *
 * 1. `base: '/admin/'` — o Fastify serve o bundle sob esse prefixo, com o
 *    hash no nome do arquivo. É o que permite cache longo no asset e
 *    `no-store` no HTML sem servir um painel velho contra uma API nova.
 * 2. `sourcemap: false` — mapa de fonte publicado devolveria o código-fonte
 *    inteiro do painel a qualquer um que abrisse o DevTools na URL. Nenhum
 *    segredo vive no front, mas a superfície de estudo de um atacante
 *    também não precisa ser oferecida.
 * 3. Nada de CDN em lugar nenhum: React, Radix, Chart.js e a fonte entram no
 *    bundle. A CSP do `/admin` (`src/lib/security.ts`) continua sem liberar
 *    terceiro nenhum, e continua sem `unsafe-inline`.
 */
export default defineConfig({
  root: here,
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    // O painel é uma aplicação de uso interno atrás de login: um bundle só,
    // sem lazy-loading, é mais simples de servir e de auditar.
    chunkSizeWarningLimit: 1200,
  },
  server: {
    port: 5174,
    strictPort: true,
    // Em desenvolvimento o Vite serve o HTML e o Fastify continua dono da
    // API. Sem o proxy, todo fetch do painel bateria na origem do Vite.
    proxy: {
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: false },
    },
  },
});
