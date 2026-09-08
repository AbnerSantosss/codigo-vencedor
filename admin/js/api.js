/* ------------------------------------------------------------------ *
 * Estado compartilhado e camada de API
 * ------------------------------------------------------------------ */

import { nav } from './nav.js';

export const state = {
  user: null,
  config: null,
  gateway: null,
  eventsSummary: null,
  tracking: null,
  dashboard: null,
  recovery: null,
  emailCfg: null,
  users: null,
};

/* ------------------------------------------------------------------ *
 * Camada de API
 * ------------------------------------------------------------------ */

/**
 * O refresh em voo, compartilhado por todas as chamadas.
 *
 * Sem isto, as cinco chamadas paralelas do dashboard viravam cinco
 * `POST /auth/refresh` simultâneos com o mesmo cookie. A primeira
 * rotaciona o token e revoga o anterior; as outras quatro apresentam um
 * token já revogado, e a detecção de reuso do servidor — que existe para
 * conter token roubado — responde revogando a família inteira, inclusive o
 * token que ela mesma acabou de emitir. A sessão de 7 dias morria e o dono
 * caía no login toda vez que abria o dashboard.
 *
 * Guardar a promessa faz de todo 401 concorrente um único refresh: quem
 * chega no meio espera o mesmo resultado. Zerar no `finally` é o que
 * permite que um 401 futuro tente de novo — sem isso, um refresh que
 * falhasse deixaria o painel sem como se recuperar.
 */
let refreshEmVoo = null;

function refrescarUmaVezSo() {
  if (!refreshEmVoo) {
    refreshEmVoo = fetch('/api/admin/auth/refresh', { method: 'POST', credentials: 'same-origin' })
      .then((r) => r.ok)
      .catch(() => false)
      .then((deuCerto) => {
        /* A volta para o login mora aqui, e não em cada chamada que falhou,
           porque aqui acontece uma vez por refresh — independentemente de
           quantas chamadas estavam esperando por ele. Cinco chamadas em
           paralelo repintariam o login cinco vezes, apagando o que o dono
           tivesse digitado. */
        if (!deuCerto) {
          state.user = null;
          nav.renderLogin();
        }
        return deuCerto;
      })
      .finally(() => {
        refreshEmVoo = null;
      });
  }
  return refreshEmVoo;
}

/**
 * Um 401 no meio da sessão quase sempre é o access token de 15 minutos
 * vencendo. Tentamos o refresh uma vez e repetimos a chamada; só se isso
 * também falhar é que mandamos o usuário para o login. Sem isso ele seria
 * expulso do painel a cada 15 minutos.
 */
export async function api(path, options = {}, retry = true) {
  const res = await fetch(`/api/admin${path}`, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });

  if (res.status === 401 && retry) {
    if (await refrescarUmaVezSo()) return api(path, options, false);
    /* Quem falhou já foi levado para o login por `refrescarUmaVezSo`. Aqui
       só resta avisar quem chamou — e `sessao_expirada` é o nome que o
       `boot()` e o `renderShell()` conhecem para não desenhar nada em cima
       da tela de login. */
    throw new Error('sessao_expirada');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'erro'), { data, status: res.status });
  return data;
}

/** Erro de validação do servidor vem com a lista de campos — mostrar isso
 *  é bem mais útil do que um "dados inválidos" genérico. */
export function describeError(err) {
  const issues = err?.data?.issues;
  if (Array.isArray(issues) && issues.length) {
    return issues.map((i) => `${i.campo}: ${i.erro}`).join(' · ');
  }
  return err?.data?.message || err?.data?.error || err?.message || 'Erro inesperado';
}
