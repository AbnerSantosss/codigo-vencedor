import { createHmac, timingSafeEqual } from 'node:crypto';
import { SECRET_KEYS, getSecret } from '../services/secrets.js';
import type { PaymentGateway, PaymentStatus, PixCharge, VerifyResult } from './types.js';

/**
 * Mercado Pago — Pix transparente pela API de pagamentos.
 *
 * PRONTO PARA RECEBER CREDENCIAL. Os nomes de campo abaixo foram conferidos
 * na referência oficial de `POST /v1/payments` (Checkout API › criar
 * pagamento) e na página de integração com Pix:
 *
 *   - corpo: `transaction_amount`, `description`, `payment_method_id: 'pix'`,
 *     `external_reference`, `date_of_expiration`, `payer.{email, first_name,
 *     last_name, identification.{type, number}}`;
 *   - header `X-Idempotency-Key`, que é o que permite repetir a requisição
 *     sem criar dois pagamentos;
 *   - resposta: `point_of_interaction.transaction_data.qr_code` (o
 *     copia-e-cola) e `.qr_code_base64` (o PNG);
 *   - consulta: `GET /v1/payments/{id}`.
 *
 * Sem access token cadastrado o `resolveGateway` nem chega aqui: cai no Pix
 * estático, e a página continua vendendo.
 */

const API = 'https://api.mercadopago.com';
const TIMEOUT_MS = 8000;

/**
 * `date_of_expiration` no formato que a API exige: `yyyy-MM-dd'T'HH:mm:ssz`,
 * com **deslocamento de fuso**, não em UTC com `Z`.
 *
 * A versão anterior mandava `expiresAt.toISOString()`, que produz
 * `2026-09-08T05:00:00.000Z`. A referência oficial marca isso como erro 23
 * ("date_of_expiration inválido") e a cobrança nem nasce — ou seja, o
 * primeiro Pix real teria falhado. Aqui o valor sai como
 * `2026-09-08T02:00:00.000-03:00`, no fuso do próprio servidor.
 */
export function formatarExpiracaoMp(data: Date): string {
  const p = (n: number, casas = 2) => String(Math.abs(n)).padStart(casas, '0');
  const offsetMin = -data.getTimezoneOffset();
  const sinal = offsetMin >= 0 ? '+' : '-';

  return (
    `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())}` +
    `T${p(data.getHours())}:${p(data.getMinutes())}:${p(data.getSeconds())}` +
    `.${p(data.getMilliseconds(), 3)}` +
    `${sinal}${p(Math.floor(Math.abs(offsetMin) / 60))}:${p(Math.abs(offsetMin) % 60)}`
  );
}

async function mpFetch(path: string, init: RequestInit & { idempotencyKey?: string } = {}) {
  const token = await getSecret(SECRET_KEYS.mpAccessToken);
  if (!token) throw new Error('mercadopago_sem_token');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // Reenviar a mesma cobrança com a mesma chave não cria pedido duplo.
        ...(init.idempotencyKey ? { 'X-Idempotency-Key': init.idempotencyKey } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      const msg = (body.message as string | undefined) ?? `http_${res.status}`;
      throw new Error(`mercadopago: ${msg}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mapa do status do MP para o nosso.
 *
 * `in_process` e `authorized` ficam em `pending` de propósito: são estados de
 * análise, e tratá-los como recusa apagaria um pagamento que ainda pode ser
 * aprovado. O `default` também cai em `pending` — status novo do provedor não
 * pode virar "falhou" por omissão.
 */
function mapStatus(status: unknown): PaymentStatus {
  switch (status) {
    case 'approved':
      return 'paid';
    case 'pending':
    case 'in_process':
    case 'authorized':
      return 'pending';
    case 'cancelled':
    case 'expired':
      return 'expired';
    case 'refunded':
    case 'charged_back':
      return 'refunded';
    case 'rejected':
      return 'failed';
    default:
      return 'pending';
  }
}

export const mercadoPagoGateway: PaymentGateway = {
  id: 'mercadopago',
  label: 'Mercado Pago',

  async createPixCharge({ order, customer, expiresInMin }): Promise<PixCharge> {
    const [firstName, ...rest] = customer.nome.trim().split(/\s+/);
    const expiresAt = new Date(Date.now() + expiresInMin * 60_000);

    const body = {
      transaction_amount: Number((order.amountCents / 100).toFixed(2)),
      description: 'Curso Código Vencedor + App',
      payment_method_id: 'pix',
      external_reference: order.reference,
      date_of_expiration: formatarExpiracaoMp(expiresAt),
      payer: {
        email: customer.email,
        first_name: firstName,
        last_name: rest.join(' ') || firstName,
        identification: { type: 'CPF', number: customer.cpf },
      },
    };

    const res = await mpFetch('/v1/payments', {
      method: 'POST',
      body: JSON.stringify(body),
      idempotencyKey: order.publicId,
    });

    const tx = (res.point_of_interaction as { transaction_data?: Record<string, unknown> } | undefined)
      ?.transaction_data;
    const emv = tx?.qr_code as string | undefined;
    const qr = tx?.qr_code_base64 as string | undefined;

    if (!emv) throw new Error('mercadopago: resposta sem qr_code');

    return {
      providerOrderId: order.reference,
      providerPaymentId: String(res.id),
      emv,
      qrCodeBase64: qr ?? null,
      expiresAt: res.date_of_expiration ? new Date(String(res.date_of_expiration)) : expiresAt,
      simulated: false,
      raw: res,
    };
  },

  async getStatus({ providerPaymentId }): Promise<PaymentStatus | null> {
    if (!providerPaymentId) return null;
    const res = await mpFetch(`/v1/payments/${encodeURIComponent(providerPaymentId)}`);
    return mapStatus(res.status);
  },

  /**
   * Teste de conexão: `GET /users/me` com o access token gravado.
   *
   * Escolhido porque é leitura pura — não cria pagamento nem deixa rastro na
   * conta do dono — e ainda devolve a identificação da conta, que é o que
   * permite ao painel dizer "conectado na conta X" em vez de um "ok" cego.
   *
   * O ambiente é deduzido do prefixo do token (`TEST-` = credencial de
   * teste); é assim que o painel avisa quando a loja está em produção com
   * credencial de sandbox — combinação que gera Pix que ninguém paga.
   */
  async verifyCredentials(): Promise<VerifyResult> {
    const token = await getSecret(SECRET_KEYS.mpAccessToken);
    if (!token) {
      return { ok: false, detail: 'Nenhum access token do Mercado Pago está gravado.' };
    }

    const ambiente = token.startsWith('TEST-') ? 'sandbox' : 'production';

    try {
      const eu = await mpFetch('/users/me');
      const apelido = (eu.nickname as string | undefined) ?? (eu.email as string | undefined) ?? null;
      return {
        ok: true,
        detail: 'O Mercado Pago respondeu e a credencial é válida.',
        account: apelido ? `${apelido} (${String(eu.id ?? '?')})` : String(eu.id ?? '?'),
        ambiente,
      };
    } catch (err) {
      return {
        ok: false,
        detail:
          err instanceof Error && /401|unauthorized|invalid/i.test(err.message)
            ? 'O Mercado Pago recusou a credencial. Confira se copiou o access token inteiro.'
            : `O Mercado Pago não respondeu como esperado: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
        ambiente,
      };
    }
  },
};

/* ------------------------------------------------------------------ *
 * Webhook — assinatura
 * ------------------------------------------------------------------ */

/**
 * O Mercado Pago assina cada notificação com o segredo que fica no painel
 * dele (Suas integrações › Webhooks › "Chave secreta"), guardado aqui
 * cifrado em `SECRET_KEYS.mpWebhookSecret`.
 *
 * Formato:
 *   x-signature:  ts=1704908010,v1=618c8534...   (hex de HMAC-SHA256)
 *   x-request-id: f0a8b9c1-...
 *
 * O manifesto assinado é montado com o `data.id` da **query string**, não do
 * corpo — é por isso que esta função recebe `dataId` separado em vez de ler
 * o JSON: assinar o corpo daria um HMAC que nunca confere.
 *
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Segmento cujo valor não veio sai inteiro do manifesto, com chave e tudo —
 * `ts:<ts>;` sozinho é um manifesto válido quando não há `data.id` nem
 * `request-id`.
 */

/** Idade do `ts` a partir da qual a notificação é registrada como suspeita. */
const MANIFEST_IDADE_SUSPEITA_S = 5 * 60;

export type MpSignatureFailure =
  | 'sem_segredo'
  | 'sem_assinatura'
  | 'assinatura_malformada'
  | 'nao_confere';

export type MpSignatureResult =
  | { ok: true; idadeS: number | null }
  | { ok: false; motivo: MpSignatureFailure };

export interface MpSignatureInput {
  /** Header `x-signature` cru. */
  signature: string | undefined;
  /** Header `x-request-id`. */
  requestId: string | undefined;
  /** `data.id` da query string — o que o Mercado Pago assinou. */
  dataId: string | undefined;
}

/** `ts=...,v1=...` em partes. Devolve null se faltar qualquer uma das duas. */
function parseXSignature(cru: string): { ts: string; v1: string } | null {
  let ts = '';
  let v1 = '';
  for (const parte of cru.split(',')) {
    const corte = parte.indexOf('=');
    if (corte < 0) continue;
    const chave = parte.slice(0, corte).trim();
    const valor = parte.slice(corte + 1).trim();
    if (chave === 'ts') ts = valor;
    else if (chave === 'v1') v1 = valor;
  }
  return ts && v1 ? { ts, v1 } : null;
}

/**
 * Comparação em tempo constante.
 *
 * `timingSafeEqual` estoura se os buffers tiverem tamanhos diferentes, então
 * o tamanho é conferido antes — e tamanho diferente já é assinatura errada.
 */
function hmacConfere(esperado: string, recebido: string): boolean {
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(recebido, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Valida a assinatura de uma notificação do Mercado Pago.
 *
 * **Falha fechada:** sem segredo cadastrado o resultado é `sem_segredo`, e a
 * rota recusa. É o comportamento certo — aceitar notificação não assinada
 * deixaria qualquer um liberar acesso mandando um POST "approved".
 *
 * O `motivo` existe para o log, não para a resposta HTTP: dizer ao cliente
 * *qual* parte da assinatura falhou ajuda quem está tentando forjar uma.
 *
 * **Sobre repetição (replay):** o `ts` velho é registrado, não recusado.
 * Recusar por idade arriscaria descartar uma retentativa legítima do Mercado
 * Pago e o prejuízo seria o pior possível — cliente que pagou e não recebe
 * acesso. A proteção real contra repetição é outra, e mais forte: a
 * notificação repetida é barrada pelo índice único de `WebhookEvent`, e o
 * status **nunca** vem do corpo — é consultado na API a cada notificação.
 * Reenviar um "approved" antigo de um pedido já reembolsado, portanto, não
 * consegue marcá-lo como pago.
 */
export async function verifyMercadoPagoSignature(input: MpSignatureInput): Promise<MpSignatureResult> {
  const segredo = await getSecret(SECRET_KEYS.mpWebhookSecret);
  if (!segredo) return { ok: false, motivo: 'sem_segredo' };

  if (!input.signature) return { ok: false, motivo: 'sem_assinatura' };

  const partes = parseXSignature(input.signature);
  if (!partes) return { ok: false, motivo: 'assinatura_malformada' };

  const segmentos: string[] = [];
  // Alfanumérico entra em minúscula, conforme a doc; em id numérico não muda nada.
  if (input.dataId) segmentos.push('id:' + input.dataId.toLowerCase() + ';');
  if (input.requestId) segmentos.push('request-id:' + input.requestId + ';');
  segmentos.push('ts:' + partes.ts + ';');

  const esperado = createHmac('sha256', segredo).update(segmentos.join('')).digest('hex');
  if (!hmacConfere(esperado, partes.v1.toLowerCase())) return { ok: false, motivo: 'nao_confere' };

  return { ok: true, idadeS: idadeDoTs(partes.ts) };
}

/**
 * Idade do `ts`, em segundos.
 *
 * A doc exemplifica `ts` em **segundos** (10 dígitos), mas há integrações que
 * recebem **milissegundos** (13). Tratar um como o outro daria idade na casa
 * dos milhares de anos, então a unidade é deduzida da magnitude em vez de
 * fixada. Só afeta o log: o manifesto usa a string crua, do jeito que veio.
 */
function idadeDoTs(ts: string): number | null {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return null;
  const segundos = n > 1e11 ? n / 1000 : n;
  return Math.round(Date.now() / 1000 - segundos);
}

/** Verdadeiro quando o `ts` da notificação já é velho demais para ser normal. */
export function assinaturaVelha(idadeS: number | null): boolean {
  return idadeS !== null && Math.abs(idadeS) > MANIFEST_IDADE_SUSPEITA_S;
}
