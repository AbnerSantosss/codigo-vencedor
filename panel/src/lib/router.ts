import { useSyncExternalStore } from 'react';

/* ==========================================================================
   Roteamento por hash — 40 linhas em vez de uma biblioteca

   Por que não React Router: os links que chegam por e-mail são
   `/admin#reset=TOKEN` e `/admin#convite=TOKEN`, formato que já está em
   e-mails enviados e em `src/routes/admin/auth.ts` / `users.ts`. Um roteador
   de verdade leria isso como a rota "/reset=TOKEN" e precisaria de uma regra
   especial de qualquer jeito. O painel tem uma dimensão de navegação (qual
   tela) — hash simples cobre, e o link antigo continua funcionando.
   ========================================================================== */

export type Rota = { tipo: 'tela'; id: string } | { tipo: 'token'; kind: 'reset' | 'convite'; token: string };

const LINK_DE_EMAIL = /^#(reset|convite)=([A-Za-z0-9_-]{20,})$/;

export function lerRota(): Rota {
  const achou = LINK_DE_EMAIL.exec(location.hash);
  if (achou) {
    return { tipo: 'token', kind: achou[1] as 'reset' | 'convite', token: achou[2]! };
  }
  const id = location.hash.replace(/^#/, '').split('?')[0] ?? '';
  return { tipo: 'tela', id: id || 'dashboard' };
}

function inscrever(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/**
 * O snapshot é a string do hash, não o objeto `Rota`.
 *
 * `useSyncExternalStore` compara snapshots por identidade: devolver um objeto
 * novo a cada leitura faria o React entender "mudou" em todo render e
 * repetiria o ciclo sem parar.
 */
function hashAtual(): string {
  return location.hash;
}

export function useRota(): Rota {
  useSyncExternalStore(inscrever, hashAtual, () => '');
  return lerRota();
}

export function irPara(id: string): void {
  if (location.hash === `#${id}`) return;
  location.hash = id;
}

/** Limpa um token da barra de endereços sem recarregar nem empilhar histórico. */
export function limparHash(): void {
  history.replaceState(null, '', location.pathname + location.search);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}
