import { timingSafeEqual } from 'node:crypto';
import { SECRET_KEYS, getSecret } from '../services/secrets.js';
import { getSiteConfig } from '../services/config.js';
import type { PaymentGateway, PaymentStatus, PixCharge, VerifyResult } from './types.js';

/**
 * Appmax — Pix pela API v1.
 *
 * PRONTO PARA RECEBER CREDENCIAL. O fluxo é o documentado por eles, em três
 * chamadas, porque a Appmax não tem um endpoint único de cobrança:
 *
 *   1. `POST /v1/customers` — cria (ou reaproveita) o cliente. A chave de
 *      identificação deles é `first_name + last_name + email + phone + ip`,
 *      e é por isso que o IP é obrigatório aqui e viaja desde a rota de
 *      checkout (`ChargeCustomer.ip`).
 *   2. `POST /v1/orders` — cria o pedido com os produtos e os valores **em
 *      centavos**.
 *   3. `POST /v1/payments/pix` — gera o Pix e devolve `pix_emv` (o
 *      copia-e-cola), `pix_qrcode` (PNG em base64) e `pix_expiration_date`.
 *
 * A autenticação é OAuth2 `client_credentials` em `POST /oauth2/token`, com o
 * par client_id/client_secret que o dono cadastra no painel. O token vive em
 * memória até vencer.
 *
 * ── Sobre o webhook da Appmax, que é onde está o risco ──────────────────
 *
 * A documentação deles diz, literalmente, que **não** enviam header de
 * assinatura nem token de autenticação nas notificações. Isso significa que
 * o endereço do webhook, se soubesse confirmar pagamento pelo corpo, seria
 * uma URL pública capaz de liberar acesso — qualquer um que a descobrisse
 * mandaria um "aprovado".
 *
 * Duas defesas, as duas implementadas (ver `src/routes/webhooks.ts`):
 *
 *   • a URL cadastrada na Appmax carrega um segredo (`?t=…`) gerado pelo
 *     dono, conferido em tempo constante por `conferirTokenDeWebhook`;
 *   • o status **nunca** vem do corpo: a notificação só diz qual pedido
 *     mexeu, e o estado real é lido de volta em `GET /v1/orders/{id}`.
 *
 * A segunda é a que realmente protege: mesmo que o segredo da URL vaze, uma
 * notificação forjada só consegue provocar uma releitura na API da Appmax.
 */

const BASES = {
  sandbox: 'https://api.sandboxappmax.com.br',
  /**
   * A documentação pública detalha a base de sandbox; esta foi confirmada por
   * chamada direta: `POST https://api.appmax.com.br/oauth2/token` responde
   * 403 para credencial inválida, igual à de sandbox — ou seja, o host existe
   * e é o mesmo endpoint. Se um dia mudar, o teste de conexão do painel
   * acusa na hora, porque a chamada de token falha antes de qualquer venda.
   */
  production: 'https://api.appmax.com.br',
} as const;

const TIMEOUT_MS = 12_000;

function base(modo: 'sandbox' | 'production'): string {
  return BASES[modo];
}

/* ------------------------------------------------------------------ *
 * Token
 * ------------------------------------------------------------------ */

/**
 * Token em memória, com validade.
 *
 * Guardado por ambiente porque trocar de sandbox para produção no painel tem
 * de trocar o token junto — reusar o de sandbox contra a base de produção
 * daria um 401 difícil de entender.
 */
let tokenEmMemoria: { valor: string; expiraEm: number; modo: string } | null = null;

export function invalidarTokenAppmax(): void {
  tokenEmMemoria = null;
}

async function obterToken(modo: 'sandbox' | 'production'): Promise<string> {
  if (tokenEmMemoria && tokenEmMemoria.modo === modo && tokenEmMemoria.expiraEm > Date.now() + 30_000) {
    return tokenEmMemoria.valor;
  }

  const clientId = await getSecret(SECRET_KEYS.appmaxClientId);
  const clientSecret = await getSecret(SECRET_KEYS.appmaxClientSecret);
  if (!clientId || !clientSecret) throw new Error('appmax_sem_credencial');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base(modo)}/oauth2/token`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const texto = await res.text();
    const corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new Error(`appmax: token recusado (${res.status}) ${String(corpo.message ?? corpo.error ?? '')}`.trim());
    }

    const valor = (corpo.access_token as string | undefined) ?? ((corpo.data as Record<string, unknown> | undefined)?.access_token as string | undefined);
    if (!valor) throw new Error('appmax: resposta de token sem access_token');

    const segundos = Number(corpo.expires_in ?? 3600);
    tokenEmMemoria = {
      valor,
      modo,
      expiraEm: Date.now() + (Number.isFinite(segundos) ? segundos : 3600) * 1000,
    };
    return valor;
  } finally {
    clearTimeout(timer);
  }
}

async function appmaxFetch(
  caminho: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Record<string, unknown>> {
  const cfg = await getSiteConfig();
  const modo = cfg.gatewayMode;
  const token = await obterToken(modo);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base(modo)}${caminho}`, {
      method: init.method ?? 'GET',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

    const texto = await res.text();
    const corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};

    if (res.status === 401) {
      // Token vencido antes do previsto: descarta e deixa a próxima chamada
      // pegar outro, em vez de manter um token morto em memória.
      invalidarTokenAppmax();
    }
    if (!res.ok) {
      throw new Error(`appmax: ${String(corpo.message ?? corpo.error ?? `http_${res.status}`)}`);
    }
    return corpo;
  } finally {
    clearTimeout(timer);
  }
}

/** `{ data: { pedido: {...} } }` → o objeto de dentro, sem estourar se faltar. */
function dados(corpo: Record<string, unknown>, chave: string): Record<string, unknown> | undefined {
  const d = corpo.data as Record<string, unknown> | undefined;
  return (d?.[chave] ?? corpo[chave]) as Record<string, unknown> | undefined;
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/**
 * Status da Appmax → o nosso.
 *
 * Os valores vêm em português e com variação de grafia entre a listagem do
 * painel e o corpo do webhook ("aguardando pagamento" × `aguardando_pagamento`
 * × "Aguardando Pagamento"), então a comparação é feita sobre o texto
 * normalizado: minúsculo, sem acento e com separador único. Comparar a
 * string crua é como um status novo passaria batido.
 */
export function mapearStatusAppmax(bruto: unknown): PaymentStatus {
  const texto = String(bruto ?? '')
    .toLowerCase()
    .normalize('NFD')
    // Faixa dos acentos combinantes, escrita por código para o arquivo não
    // depender de como o editor salva caractere invisível.
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim();

  if (!texto) return 'pending';

  // Pago: aprovado no antifraude, integrado, ou pago por Pix.
  if (/(aprovado|approved|integrado|pago|paid|autorizado)/.test(texto)) return 'paid';
  // Estorno e chargeback tratam do mesmo desfecho para nós: dinheiro devolvido.
  if (/(estornado|refunded|refund|chargeback|contestado)/.test(texto)) return 'refunded';
  if (/(cancelado|canceled|cancelled|expirado|expired)/.test(texto)) return 'expired';
  if (/(recusado|reprovado|rejected|failed|falhou)/.test(texto)) return 'failed';
  // "pendente", "aguardando pagamento", "analise antifraude" e qualquer
  // status novo continuam pendentes — nunca falha por omissão.
  return 'pending';
}

/* ------------------------------------------------------------------ *
 * Webhook — o segredo da URL
 * ------------------------------------------------------------------ */

/**
 * Confere o segredo que viaja na URL do webhook.
 *
 * **Falha fechada**: sem segredo cadastrado, nada é aceito. É o mesmo
 * critério do Mercado Pago — só que lá o provedor assina e aqui o segredo é
 * nosso, justamente porque a Appmax não assina nada.
 */
export async function conferirTokenDeWebhook(recebido: string | undefined): Promise<boolean> {
  const esperado = await getSecret(SECRET_KEYS.appmaxWebhookToken);
  if (!esperado || !recebido) return false;

  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(recebido, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * Adaptador
 * ------------------------------------------------------------------ */

export const appmaxGateway: PaymentGateway = {
  id: 'appmax',
  label: 'Appmax',

  async createPixCharge({ order, customer, expiresInMin }): Promise<PixCharge> {
    const cfg = await getSiteConfig();
    const [primeiro, ...resto] = customer.nome.trim().split(/\s+/);

    /* 1. Cliente ------------------------------------------------------- */
    const cliente = await appmaxFetch('/v1/customers', {
      method: 'POST',
      body: {
        first_name: primeiro,
        last_name: resto.join(' ') || primeiro,
        email: customer.email,
        phone: customer.fone,
        /**
         * `ip` é campo obrigatório da Appmax. Quando não há IP (um teste por
         * linha de comando, por exemplo), manda-se o de loopback em vez de
         * omitir: omitir devolve 422 e derrubaria a venda, e um IP falso não
         * distorce nada além do próprio antifraude deles.
         */
        ip: customer.ip ?? '127.0.0.1',
        document_number: customer.cpf,
      },
    });

    const customerId = dados(cliente, 'customer')?.id;
    if (customerId === undefined) throw new Error('appmax: resposta de cliente sem id');

    /* 2. Pedido -------------------------------------------------------- */
    const pedido = await appmaxFetch('/v1/orders', {
      method: 'POST',
      body: {
        customer_id: customerId,
        /**
         * Valores em centavos, como a doc especifica.
         *
         * Com cupom, o pedido sobe separado: preço cheio em `products_value`
         * e o abatimento em `discount_value`. A conta que a Appmax vai cobrar
         * é a subtração dos dois, que dá exatamente `order.amountCents` — o
         * mesmo valor do QR. Mandar só o líquido funcionaria para cobrar, mas
         * o relatório deles mostraria o produto valendo menos do que vale, e
         * o desconto sumiria da conciliação.
         *
         * `listAmountCents` é opcional no banco por causa dos pedidos criados
         * antes de o cupom existir; nesses, cheio e líquido são o mesmo.
         */
        products_value: order.listAmountCents ?? order.amountCents,
        discount_value: order.discountCents,
        shipping_value: 0,
        products: [
          {
            sku: order.reference,
            name: cfg.content.productName,
            quantity: 1,
            unit_value: order.listAmountCents ?? order.amountCents,
            // Produto digital: sem frete e sem endereço de entrega.
            type: 'digital',
          },
        ],
      },
    });

    const orderId = dados(pedido, 'order')?.id;
    if (orderId === undefined) throw new Error('appmax: resposta de pedido sem id');

    /* 3. Pix ----------------------------------------------------------- */
    const pagamento = await appmaxFetch('/v1/payments/pix', {
      method: 'POST',
      body: {
        order_id: orderId,
        payment_data: { pix: { document_number: customer.cpf } },
      },
    });

    const pix = dados(pagamento, 'payment');
    const emv = pix?.pix_emv as string | undefined;
    const qr = pix?.pix_qrcode as string | undefined;
    if (!emv) throw new Error('appmax: resposta de pagamento sem pix_emv');

    /**
     * A validade vem da Appmax (`Y-m-d H:i:s`, no fuso deles) e não do nosso
     * `pixExpiresMin`. A doc avisa que esse prazo pode variar, então usar o
     * nosso número faria o contador da página divergir do Pix de verdade —
     * e cliente vendo "expirado" num código que ainda funciona (ou o
     * contrário) é reclamação garantida.
     */
    const expiraEm = pix?.pix_expiration_date
      ? new Date(String(pix.pix_expiration_date).replace(' ', 'T'))
      : new Date(Date.now() + expiresInMin * 60_000);

    return {
      providerOrderId: String(orderId),
      providerPaymentId: pix?.id === undefined ? String(orderId) : String(pix.id),
      emv,
      qrCodeBase64: qr ?? null,
      expiresAt: Number.isNaN(expiraEm.getTime()) ? new Date(Date.now() + expiresInMin * 60_000) : expiraEm,
      simulated: false,
      raw: pagamento,
    };
  },

  async getStatus({ providerOrderId }): Promise<PaymentStatus | null> {
    if (!providerOrderId) return null;
    const corpo = await appmaxFetch(`/v1/orders/${encodeURIComponent(providerOrderId)}`);
    const pedido = dados(corpo, 'order');
    if (!pedido) return null;
    return mapearStatusAppmax(pedido.status);
  },

  /**
   * Teste de conexão: pede um token.
   *
   * É a única chamada da Appmax que não cria nada — pedido e cliente são
   * criação, e não se testa integração sujando a base do dono. Se o par
   * client_id/client_secret estiver errado, ou a base de produção não for a
   * esperada, falha aqui e com mensagem.
   */
  async verifyCredentials(): Promise<VerifyResult> {
    const cfg = await getSiteConfig();
    const clientId = await getSecret(SECRET_KEYS.appmaxClientId);
    const clientSecret = await getSecret(SECRET_KEYS.appmaxClientSecret);

    if (!clientId || !clientSecret) {
      return { ok: false, detail: 'Faltam o client_id e o client_secret da Appmax.', ambiente: cfg.gatewayMode };
    }

    try {
      invalidarTokenAppmax();
      await obterToken(cfg.gatewayMode);
      return {
        ok: true,
        detail: `A Appmax autenticou o aplicativo no ambiente de ${cfg.gatewayMode === 'sandbox' ? 'testes' : 'produção'}.`,
        account: `client_id …${clientId.slice(-6)}`,
        ambiente: cfg.gatewayMode,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      return {
        ok: false,
        detail: /401|403|recusado|invalid/i.test(msg)
          ? 'A Appmax recusou o par client_id/client_secret.'
          : `Não foi possível falar com a Appmax: ${msg}.`,
        ambiente: cfg.gatewayMode,
      };
    }
  },
};
