/* ==========================================================================
   Camada de API do painel

   Portada do `admin/js/api.js` com o comportamento preservado — inclusive a
   parte que consertou "o dashboard me expulsa": o refresh compartilhado.

   Nada de token em JavaScript. O access e o refresh vivem em cookies
   `httpOnly` + `SameSite=Strict` escritos pelo servidor (`src/lib/auth.ts`),
   então o front não tem como ler, guardar ou vazar credencial de sessão —
   e um XSS hipotético no painel não consegue exfiltrar a sessão, só agir
   dentro dela enquanto a aba estiver aberta.
   ========================================================================== */

const BASE = '/api/admin';

export class ApiError extends Error {
  readonly status: number;
  readonly data: ApiErrorBody;

  constructor(message: string, status: number, data: ApiErrorBody) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export interface ApiErrorBody {
  error?: string;
  message?: string;
  issues?: { campo: string; erro: string }[];
  [key: string]: unknown;
}

/** Sinaliza "a sessão acabou" — quem chamou não deve desenhar erro na tela. */
export const SESSAO_EXPIRADA = 'sessao_expirada';

type Ouvinte = () => void;
const ouvintesDeSessao = new Set<Ouvinte>();

/**
 * O `App` se inscreve aqui para voltar ao login quando o refresh falha.
 *
 * Um callback registrado é melhor do que um `window.location.reload()`: o
 * reload descartaria o que o dono tivesse digitado num formulário aberto.
 */
export function onSessaoPerdida(fn: Ouvinte): () => void {
  ouvintesDeSessao.add(fn);
  return () => ouvintesDeSessao.delete(fn);
}

/**
 * O refresh em voo, compartilhado por todas as chamadas.
 *
 * Sem isto, as cinco chamadas paralelas do dashboard viravam cinco
 * `POST /auth/refresh` simultâneos com o mesmo cookie. A primeira rotaciona
 * o token e revoga o anterior; as outras quatro apresentam um token já
 * revogado, e a detecção de reuso do servidor — que existe para conter token
 * roubado — respondia revogando a família inteira, inclusive o token que ela
 * mesma acabara de emitir. A sessão de 7 dias morria sozinha.
 *
 * Guardar a promessa faz de todo 401 concorrente um único refresh. Zerar no
 * `finally` é o que permite a um 401 futuro tentar de novo.
 */
let refreshEmVoo: Promise<boolean> | null = null;

function refrescarUmaVezSo(): Promise<boolean> {
  refreshEmVoo ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'same-origin' })
    .then((r) => r.ok)
    .catch(() => false)
    .then((deuCerto) => {
      /* A volta para o login mora aqui, e não em cada chamada que falhou,
         porque aqui acontece uma vez por refresh — independentemente de
         quantas chamadas estavam esperando por ele. */
      if (!deuCerto) for (const fn of ouvintesDeSessao) fn();
      return deuCerto;
    })
    .finally(() => {
      refreshEmVoo = null;
    });
  return refreshEmVoo;
}

interface Opcoes {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Um 401 no meio da sessão quase sempre é o access token de 15 minutos
 * vencendo. Tentamos o refresh uma vez e repetimos a chamada; só se isso
 * também falhar é que voltamos para o login.
 */
export async function api<T = unknown>(path: string, options: Opcoes = {}, retry = true): Promise<T> {
  const temCorpo = options.body !== undefined;

  const res = await fetch(`${BASE}${path}`, {
    method: options.method ?? (temCorpo ? 'POST' : 'GET'),
    credentials: 'same-origin',
    // `same-origin` explícito: o painel nunca fala com outra origem, e a CSP
    // (`connect-src 'self'`) também não deixaria.
    mode: 'same-origin',
    headers: temCorpo ? { 'Content-Type': 'application/json' } : undefined,
    body: temCorpo ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (res.status === 401 && retry) {
    if (await refrescarUmaVezSo()) return api<T>(path, options, false);
    throw new ApiError(SESSAO_EXPIRADA, 401, { error: SESSAO_EXPIRADA });
  }

  const data = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new ApiError(String(data.error ?? 'erro'), res.status, data);
  }
  return data as T;
}

/** Erro de validação do servidor vem com a lista de campos — mostrar isso é
 *  bem mais útil do que um "dados inválidos" genérico. */
export function descreverErro(err: unknown): string {
  if (err instanceof ApiError) {
    const issues = err.data.issues;
    if (Array.isArray(issues) && issues.length) {
      return issues.map((i) => `${i.campo}: ${i.erro}`).join(' · ');
    }
    return err.data.message ?? err.data.error ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Erro inesperado';
}

export function ehSessaoExpirada(err: unknown): boolean {
  return err instanceof ApiError && err.message === SESSAO_EXPIRADA;
}
