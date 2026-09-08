/* ------------------------------------------------------------------ *
 * Registro de navegação
 *
 * Módulo sem nenhum import, de propósito: é o que quebra os ciclos que a
 * divisão do app.js criaria.
 *
 *   1. `router.js` conhece as telas (RENDERERS) e as telas precisam
 *      repintar a casca — importar `paintShell` direto seria um ciclo.
 *   2. `api.js` manda para o login quando o refresh falha, e a tela de
 *      login usa `api()`.
 *   3. As telas de senha reiniciam a sessão com `boot()`, que mora no
 *      app.js, o módulo de entrada.
 *
 * `app.js` preenche os três campos antes de chamar `boot()`. Nada aqui é
 * lido durante a avaliação dos módulos — só de dentro de funções que
 * rodam depois do boot.
 * ------------------------------------------------------------------ */

export const nav = {
  /** router.js — repinta a casca na tela informada. */
  paintShell: null,
  /** auth-views.js — leva de volta para a tela de login. */
  renderLogin: null,
  /** app.js — recomeça a sessão do painel. */
  boot: null,
};

export function registerNav(fns) {
  Object.assign(nav, fns);
}
