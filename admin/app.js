/* ==========================================================================
   Painel administrativo — Código Vencedor

   Vanilla puro: sem build, sem framework, sem CDN. A CSP do /admin não
   libera terceiro nenhum, e o painel tem ~6 telas — framework aqui só
   adicionaria uma etapa de build para manter.
   ========================================================================== */

import { registerNav } from './js/nav.js';
import { api, state } from './js/api.js';
import { renderLogin, renderPasswordChange, renderSetPassword } from './js/auth-views.js';
import { navigate, paintShell } from './js/router.js';

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */

async function boot() {
  // Links que chegam por e-mail: #reset=TOKEN (esqueci a senha) e
  // #convite=TOKEN (pessoa nova criando a primeira senha).
  const link = /^#(reset|convite)=([A-Za-z0-9_-]{20,})$/.exec(location.hash);
  if (link) return renderSetPassword(link[2], link[1]);

  try {
    const me = await api('/auth/me');
    state.user = me;
    if (me.mustChangePassword) return renderPasswordChange(true);
    state.config = await api('/config');
    navigate(location.hash.slice(1) || 'dashboard');
  } catch (err) {
    if (err.message !== 'sessao_expirada') renderLogin();
  }
}

/* O nav.js existe só para quebrar os ciclos entre router/telas,
   api/login e auth-views/boot. Preencher os três campos aqui, antes do
   primeiro boot, é a única amarração dinâmica do painel. */
registerNav({ paintShell, renderLogin, boot });

boot();
