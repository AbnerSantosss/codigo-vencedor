import { createHash } from 'node:crypto';

/**
 * Cliente da API de Conversões da Meta.
 *
 * Escrito a partir da documentação oficial. As decisões que ela impõe e que
 * não são óbvias no código:
 *
 *  - **`action_source`, `event_source_url` e `client_user_agent` são
 *    obrigatórios** em evento de site. Faltando qualquer um, o evento é
 *    aceito mas vale menos para otimização.
 *  - **Deduplicação** acontece por `event_name` + `event_id` iguais entre o
 *    Pixel do navegador e o servidor. Se os dois chegarem em até 5 minutos,
 *    a Meta prefere o do navegador; em até 48h, considera só o primeiro.
 *  - **`event_time`** é Unix em segundos, em GMT, e não pode ter mais de 7
 *    dias. Um único evento fora do prazo derruba a requisição inteira.
 *  - **Timeout de 1500 ms** é a recomendação da própria doc (a maioria das
 *    respostas vem em menos de 600 ms).
 *  - **Retry só em erro não-cliente.** 4xx significa payload inválido:
 *    repetir só gera o mesmo erro. 5xx e timeout, sim.
 *  - Tudo que identifica pessoa vai em **SHA-256 sobre o valor normalizado**.
 *    O dado em claro nunca sai daqui.
 */

const GRAPH_VERSION = 'v25.0';
const TIMEOUT_MS = 1500;
const MAX_ATTEMPTS = 3;

/* ------------------------------------------------------------------ *
 * Normalização e hash
 *
 * A Meta compara hashes, então a normalização precisa ser idêntica à que
 * ela aplica do lado dela. Espaço a mais ou uma maiúscula já quebram o
 * casamento — o evento é aceito e simplesmente não casa com ninguém.
 * ------------------------------------------------------------------ */

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Minúsculas, sem espaço nas pontas. Serve para e-mail, nome, cidade, estado. */
function hashText(value: string | null | undefined): string | undefined {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized ? sha256(normalized) : undefined;
}

/**
 * Telefone: só dígitos, com código do país, sem `+` e sem zeros à esquerda.
 * Para o Brasil isso quer dizer 55 + DDD + número.
 */
export function hashPhoneBR(phone: string | null | undefined): string | undefined {
  let digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return undefined;
  digits = digits.replace(/^0+/, '');
  if (!digits.startsWith('55')) digits = `55${digits}`;
  return sha256(digits);
}

/** CPF vira `external_id` — a doc recomenda hash também nele. */
function hashDigits(value: string | null | undefined): string | undefined {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits ? sha256(digits) : undefined;
}

/* ------------------------------------------------------------------ *
 * Tipos
 * ------------------------------------------------------------------ */

export interface MetaUserInput {
  email?: string | null;
  phone?: string | null;
  /** Nome completo; é quebrado em primeiro e último aqui. */
  fullName?: string | null;
  /** CPF só com dígitos, usado como external_id. */
  cpf?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  /** Não hasheados, por exigência da doc. */
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
}

export interface MetaEventInput {
  eventName: string;
  /** Precisa ser idêntico ao `eventID` do Pixel para deduplicar. */
  eventId: string;
  /** Padrão: agora. Em segundos. */
  eventTimeMs?: number;
  eventSourceUrl: string;
  user: MetaUserInput;
  customData?: Record<string, unknown>;
  referrerUrl?: string | null;
}

export interface MetaConfig {
  pixelId: string;
  accessToken: string;
  testEventCode?: string | null;
}

export interface MetaResult {
  ok: boolean;
  status: number | null;
  /** `events_received` quando a Meta aceita. */
  received?: number;
  fbTraceId?: string;
  error?: string;
  attempts: number;
}

/* ------------------------------------------------------------------ *
 * Montagem do payload
 * ------------------------------------------------------------------ */

function buildUserData(user: MetaUserInput): Record<string, unknown> {
  const name = (user.fullName ?? '').trim();
  const parts = name ? name.split(/\s+/) : [];
  const firstName = parts[0];
  // Último "sobrenome" é a última palavra; nomes compostos brasileiros
  // ("Maria da Silva Souza") casam melhor assim do que pegando a segunda.
  const lastName = parts.length > 1 ? parts[parts.length - 1] : undefined;

  const data: Record<string, unknown> = {
    em: hashText(user.email),
    ph: hashPhoneBR(user.phone),
    fn: hashText(firstName),
    ln: hashText(lastName),
    ct: hashText(user.city),
    st: hashText(user.state),
    zp: hashDigits(user.zip),
    country: hashText(user.country),
    external_id: hashDigits(user.cpf),
    // Estes três a doc manda enviar em claro.
    client_ip_address: user.clientIpAddress ?? undefined,
    client_user_agent: user.clientUserAgent ?? undefined,
    fbp: user.fbp || undefined,
    fbc: user.fbc || undefined,
  };

  for (const key of Object.keys(data)) {
    if (data[key] === undefined) delete data[key];
  }
  return data;
}

/**
 * A doc rejeita eventos cuja identificação é ampla demais para casar com
 * alguém. Checar aqui evita gastar uma chamada — e, principalmente, evita
 * inflar o Events Manager com eventos que nunca vão atribuir.
 */
function hasUsableIdentity(userData: Record<string, unknown>): boolean {
  return Boolean(userData.em || userData.ph || userData.external_id || userData.fbp || userData.fbc);
}

export function buildMetaPayload(input: MetaEventInput, config: MetaConfig) {
  const userData = buildUserData(input.user);

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    // Segundos, não milissegundos. Enviar ms faz a Meta ler a data como
    // milhares de anos no futuro e recusar a requisição inteira.
    event_time: Math.floor((input.eventTimeMs ?? Date.now()) / 1000),
    event_id: input.eventId,
    action_source: 'website',
    event_source_url: input.eventSourceUrl,
    user_data: userData,
  };

  if (input.referrerUrl) event.referrer_url = input.referrerUrl;
  if (input.customData && Object.keys(input.customData).length) event.custom_data = input.customData;

  const body: Record<string, unknown> = { data: [event] };
  if (config.testEventCode) body.test_event_code = config.testEventCode;
  return body;
}

/* ------------------------------------------------------------------ *
 * Envio
 * ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendMetaEvent(input: MetaEventInput, config: MetaConfig): Promise<MetaResult> {
  if (!config.pixelId || !config.accessToken) {
    return { ok: false, status: null, error: 'meta_nao_configurada', attempts: 0 };
  }

  const body = buildMetaPayload(input, config);
  const userData = (body.data as Record<string, unknown>[])[0]?.user_data as Record<string, unknown>;

  if (!hasUsableIdentity(userData)) {
    return { ok: false, status: null, error: 'identificacao_insuficiente', attempts: 0 };
  }

  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(config.pixelId)}/events`;
  let lastError = 'desconhecido';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // O token vai no corpo, não na query: query string acaba em log de
        // proxy e de servidor.
        body: JSON.stringify({ ...body, access_token: config.accessToken }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      lastStatus = res.status;

      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* a Meta responde pouco; corpo não-JSON não é fatal */
      }

      if (res.ok) {
        return {
          ok: true,
          status: res.status,
          received: typeof parsed.events_received === 'number' ? parsed.events_received : undefined,
          fbTraceId: typeof parsed.fbtrace_id === 'string' ? parsed.fbtrace_id : undefined,
          attempts: attempt,
        };
      }

      const err = parsed.error as { message?: string; code?: number } | undefined;
      lastError = err?.message ?? `http_${res.status}`;

      // 4xx é payload inválido: repetir produz exatamente o mesmo erro.
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

/* ------------------------------------------------------------------ *
 * Mapa dos nossos eventos para os padrão da Meta
 * ------------------------------------------------------------------ */

export const META_EVENT_MAP: Record<string, string> = {
  page_view: 'PageView',
  view_content: 'ViewContent',
  begin_checkout: 'InitiateCheckout',
  generate_lead: 'Lead',
  add_payment_info: 'AddPaymentInfo',
  purchase: 'Purchase',
};

export function toMetaEventName(event: string): string | null {
  return META_EVENT_MAP[event] ?? null;
}
