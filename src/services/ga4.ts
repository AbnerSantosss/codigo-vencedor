/**
 * Cliente do Measurement Protocol do GA4.
 *
 * Escrito a partir da documentação oficial. As decisões que ela impõe e que
 * não são óbvias no código:
 *
 *  - **`client_id` é obrigatório** e é o que junta os eventos numa pessoa. Aqui
 *    ele é o `visitorId` (cookie `cv_vid`, 1 ano, `httpOnly`) — o mesmo
 *    identificador de primeira parte que o painel já usa para contar gente em
 *    vez de abas. Sem ele o GA4 aceita a chamada e cria um usuário novo a cada
 *    evento, o que é pior do que não enviar: infla "usuários" com fantasma.
 *  - **O endpoint não valida conteúdo.** Ele responde 204 sem corpo mesmo para
 *    payload que o GA4 vai descartar depois. Ou seja: 2xx aqui significa
 *    "recebido", nunca "aceito" — a conferência de verdade é o relatório de
 *    tempo real, e é isso que a tela deve dizer ao dono.
 *  - **`engagement_time_msec` precisa ir junto**, senão o evento não conta
 *    sessão e some dos relatórios padrão mesmo tendo sido recebido.
 *  - **`timestamp_micros` só vale por 72h.** Fora da janela o evento é
 *    descartado em silêncio, então preferimos omitir e deixar o GA4 carimbar
 *    a hora da chegada a mandar uma data que ele vai jogar fora.
 *  - **Limites de forma**: nome de evento e de parâmetro em
 *    `[a-z_][a-z0-9_]{0,39}`, valor de texto até 100 caracteres, 25 parâmetros
 *    por evento. Quem passar do limite derruba o evento inteiro, não só o
 *    parâmetro — por isso a limpeza acontece antes de sair daqui.
 *  - **Mesma resiliência da Meta**: timeout de 1500 ms, retry só em 5xx (4xx é
 *    payload inválido: repetir dá o mesmo erro) e nunca lança.
 */

const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const TIMEOUT_MS = 1500;
const MAX_ATTEMPTS = 3;
const MAX_PARAMS = 25;
const JANELA_TIMESTAMP_MS = 72 * 60 * 60 * 1000;

export interface Ga4Config {
  measurementId: string;
  apiSecret: string;
}

export interface Ga4EventInput {
  /** `visitorId` e, na falta dele, `sessionId`. Sem nenhum dos dois não envia. */
  clientId: string;
  eventName: string;
  params?: Record<string, unknown>;
  /** Costura a visita no GA4 com a sessão que o nosso funil já usa. */
  sessionId?: string | null;
  eventTimeMs?: number;
}

export interface Ga4Result {
  ok: boolean;
  status: number | null;
  error?: string;
  attempts: number;
}

/* ------------------------------------------------------------------ *
 * Nomes e parâmetros
 * ------------------------------------------------------------------ */

/**
 * Nossos eventos internos nos nomes que o GA4 reconhece.
 *
 * `view_content` é o único que troca de nome: no GA4 o evento recomendado de
 * comércio é `view_item`. `select_promotion` e `click` já são nomes válidos do
 * GA4 e vão como estão. O que não estiver aqui não é enviado — nome inventado
 * vira evento personalizado, que não alimenta relatório nenhum e ainda gasta
 * cota de eventos distintos.
 */
export const GA4_EVENT_MAP: Record<string, string> = {
  page_view: 'page_view',
  view_content: 'view_item',
  begin_checkout: 'begin_checkout',
  generate_lead: 'generate_lead',
  add_payment_info: 'add_payment_info',
  purchase: 'purchase',
  select_promotion: 'select_promotion',
  click: 'click',
};

export function toGa4EventName(event: string): string | null {
  return GA4_EVENT_MAP[event] ?? null;
}

const NOME_VALIDO = /^[a-z_][a-z0-9_]{0,39}$/i;

/**
 * Deixa passar só o que o GA4 aceita como parâmetro.
 *
 * Objeto e array não têm representação no Measurement Protocol (o `contents`
 * da Meta, por exemplo, não tem equivalente), então somem em vez de virar
 * `[object Object]` num relatório.
 */
function limparParams(entrada: Record<string, unknown> | undefined): Record<string, string | number> {
  const saida: Record<string, string | number> = {};
  if (!entrada) return saida;

  for (const [chave, valor] of Object.entries(entrada)) {
    if (Object.keys(saida).length >= MAX_PARAMS) break;
    if (!NOME_VALIDO.test(chave)) continue;

    if (typeof valor === 'number' && Number.isFinite(valor)) {
      saida[chave] = valor;
    } else if (typeof valor === 'boolean') {
      saida[chave] = valor ? 1 : 0;
    } else if (typeof valor === 'string' && valor) {
      saida[chave] = valor.slice(0, 100);
    }
  }

  return saida;
}

/**
 * Parâmetros de comércio a partir do `custom_data` que já montamos para a Meta.
 *
 * `purchase` sem `transaction_id` é o erro clássico: o GA4 aceita e depois
 * conta a mesma venda de novo a cada reenvio, porque a deduplicação dele é por
 * esse campo.
 */
export function paramsDeComercio(event: string, customData: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!customData) return {};

  const params: Record<string, unknown> = {};
  if (typeof customData.value === 'number') params.value = customData.value;
  if (typeof customData.currency === 'string') params.currency = customData.currency;
  if (event === 'purchase' && typeof customData.order_id === 'string') {
    params.transaction_id = customData.order_id;
  }
  return params;
}

/* ------------------------------------------------------------------ *
 * Montagem e envio
 * ------------------------------------------------------------------ */

export function buildGa4Payload(input: Ga4EventInput): Record<string, unknown> {
  const params: Record<string, string | number> = limparParams(input.params);

  // Sem isto o evento chega mas não conta sessão — some do relatório padrão.
  params.engagement_time_msec = 1;
  if (input.sessionId) params.session_id = input.sessionId.slice(0, 100);

  const body: Record<string, unknown> = {
    client_id: input.clientId,
    events: [{ name: input.eventName, params }],
  };

  const idade = input.eventTimeMs ? Date.now() - input.eventTimeMs : 0;
  if (input.eventTimeMs && idade >= 0 && idade < JANELA_TIMESTAMP_MS) {
    body.timestamp_micros = input.eventTimeMs * 1000;
  }

  return body;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendGa4Event(input: Ga4EventInput, config: Ga4Config): Promise<Ga4Result> {
  if (!config.measurementId || !config.apiSecret) {
    return { ok: false, status: null, error: 'ga4_nao_configurado', attempts: 0 };
  }
  if (!input.clientId) {
    return { ok: false, status: null, error: 'sem_client_id', attempts: 0 };
  }

  /* Aqui o segredo vai na query, e é a própria API que exige: o Measurement
     Protocol não aceita `api_secret` no corpo. Como a chamada sai do servidor
     e a URL não passa por proxy nosso, ela não acaba em log de acesso. */
  const url = `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(config.measurementId)}&api_secret=${encodeURIComponent(
    config.apiSecret,
  )}`;
  const body = JSON.stringify(buildGa4Payload(input));

  let lastError = 'desconhecido';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;

      // 204 sem corpo é a resposta normal. Ler o corpo mesmo assim evita
      // deixar o socket pendurado quando o Google responde com texto de erro.
      const texto = await res.text().catch(() => '');

      if (res.ok) return { ok: true, status: res.status, attempts: attempt };

      lastError = texto ? `http_${res.status}: ${texto.slice(0, 160)}` : `http_${res.status}`;
      if (res.status >= 400 && res.status < 500) {
        return { ok: false, status: res.status, error: lastError, attempts: attempt };
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error && err.name === 'AbortError' ? 'timeout' : String(err);
    }

    // Backoff curto: isto roda no caminho de uma venda, não numa fila.
    if (attempt < MAX_ATTEMPTS) await sleep(attempt * 300);
  }

  return { ok: false, status: lastStatus, error: lastError, attempts: MAX_ATTEMPTS };
}
