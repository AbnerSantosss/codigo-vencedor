import { createHash, randomBytes } from 'node:crypto';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import QRCode from 'qrcode';
import { conferirSegredoDeWebhook } from '../lib/webhookSecret.js';
import { SECRET_KEYS, getSecret, getSecrets } from '../services/secrets.js';
import { getSiteConfig } from '../services/config.js';
import type { PaymentGateway, PaymentStatus, PixCharge, VerifyResult } from './types.js';

/**
 * FyHub — Pix pela API do padrão Banco Central.
 *
 * PRONTO PARA RECEBER CREDENCIAL. Diferente da Appmax e do Mercado Pago, que
 * têm API própria, a FyHub implementa a **especificação Pix do BCB**
 * (`bacen/pix-api`). Isso muda o desenho em quatro pontos:
 *
 *   1. **O `txid` é nosso, não deles.** `PUT /cob/{txid}` cria a cobrança no
 *      identificador que mandamos — daí `gerarTxid()`. O `reference` do
 *      pedido (`CV-7K3D9A`) não serve: a especificação exige de 26 a 35
 *      caracteres alfanuméricos.
 *   2. **Não há imagem de QR na resposta.** Vem só o `pixCopiaECola`; o PNG
 *      é gerado aqui, com a mesma lib que o Pix estático usa.
 *   3. **mTLS obrigatório.** A documentação deles é explícita: sem o
 *      certificado de cliente a API não responde, mesmo com o access_token
 *      válido. É a única integração do projeto que precisa disso.
 *   4. **O webhook não é assinado.** Ver o bloco do segredo, mais abaixo.
 *
 * ── Por que `node:https` e não `fetch` ─────────────────────────────────
 *
 * O `fetch` do Node só aceita certificado de cliente através de um
 * `dispatcher` do undici, e o undici **não é dependência deste projeto**
 * (não está no `package.json` nem é resolvível). `node:https` faz mTLS com
 * o que já vem no runtime, então a integração inteira entra sem um pacote
 * novo — que, num repositório público com `npm audit` no fluxo, é um custo
 * que vale evitar por causa de um cliente HTTP.
 */

/* ------------------------------------------------------------------ *
 * Bases
 * ------------------------------------------------------------------ */

/**
 * A documentação pública descreve **uma** base para a API QRCode.
 *
 * Os certificados de exemplo dela chamam-se `PIX-HMG-CLIENTE.*`, o que
 * sugere que existe um ambiente de homologação — mas a URL dele não está
 * publicada, e inventar um host seria pior do que admitir que não sabemos:
 * daria erro de DNS no meio de um teste, sem explicar por quê.
 *
 * Enquanto a FyHub não responder, "sandbox" fala com a mesma API, e o teste
 * de conexão do painel avisa isso em letras claras em vez de deixar o dono
 * supor que está em ambiente de brincadeira.
 */
const BASES = {
  sandbox: 'https://api.qrcode.fyhub.com.br',
  production: 'https://api.qrcode.fyhub.com.br',
} as const;

const TIMEOUT_MS = 12_000;

function base(modo: 'sandbox' | 'production'): string {
  return BASES[modo];
}

/** Verdade enquanto as duas bases forem a mesma; lido pelo teste de conexão. */
export const FYHUB_SEM_HOMOLOGACAO = BASES.sandbox === BASES.production;

/* ------------------------------------------------------------------ *
 * Cliente HTTPS com certificado
 * ------------------------------------------------------------------ */

interface Resposta {
  status: number;
  corpo: Record<string, unknown>;
  texto: string;
}

/**
 * Agente mTLS, guardado em memória e trocado sozinho.
 *
 * A chave do cache é a impressão digital do próprio material (certificado +
 * chave + senha). Trocar o certificado no painel muda a impressão, e a
 * próxima chamada monta um agente novo — sem depender de alguém lembrar de
 * invalidar. O `getSecret` já tem TTL de 60 s, então o atraso máximo entre
 * salvar e valer é esse, o mesmo de todas as outras credenciais.
 *
 * Guardar o agente importa: cada `new Agent` refaz o handshake TLS, e um
 * handshake por cobrança somaria centenas de milissegundos na tela em que o
 * comprador está esperando o QR aparecer.
 */
let agenteEmMemoria: { impressao: string; agent: HttpsAgent } | null = null;

export function invalidarFyhub(): void {
  agenteEmMemoria?.agent.destroy();
  agenteEmMemoria = null;
  tokenEmMemoria = null;
}

/**
 * Monta (ou reaproveita) o agente com o certificado do cofre.
 *
 * Lança `fyhub_sem_certificado` quando falta material e `fyhub_certificado_invalido`
 * quando o PEM não é legível — os dois viram frase em português no teste de
 * conexão. Falhar aqui é o desenho: sem certificado, a FyHub recusa tudo, e
 * descobrir isso na primeira venda seria tarde.
 */
async function obterAgente(): Promise<HttpsAgent> {
  const s = await getSecrets([
    SECRET_KEYS.fyhubCertPem,
    SECRET_KEYS.fyhubKeyPem,
    SECRET_KEYS.fyhubCertPassphrase,
  ]);

  const cert = s[SECRET_KEYS.fyhubCertPem];
  const key = s[SECRET_KEYS.fyhubKeyPem];
  const passphrase = s[SECRET_KEYS.fyhubCertPassphrase] ?? undefined;

  if (!cert || !key) throw new Error('fyhub_sem_certificado');

  const impressao = createHash('sha256').update(`${cert}\u0000${key}\u0000${passphrase ?? ''}`).digest('hex');
  if (agenteEmMemoria && agenteEmMemoria.impressao === impressao) return agenteEmMemoria.agent;

  let agent: HttpsAgent;
  try {
    agent = new HttpsAgent({
      cert,
      key,
      ...(passphrase ? { passphrase } : {}),
      keepAlive: true,
      // Uma conexão por vez é suficiente: o volume aqui é o de uma LP, e
      // keepAlive já evita o handshake repetido.
      maxSockets: 8,
    });
  } catch (err) {
    throw new Error('fyhub_certificado_invalido: ' + (err instanceof Error ? err.message : 'ilegível'));
  }

  agenteEmMemoria?.agent.destroy();
  agenteEmMemoria = { impressao, agent };
  return agent;
}

/** `https.request` embrulhado em promessa, com timeout e JSON. */
async function pedir(
  url: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    agent: HttpsAgent;
  },
): Promise<Resposta> {
  return new Promise<Resposta>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: init.method ?? 'GET',
        agent: init.agent,
        headers: {
          Accept: 'application/json',
          ...(init.body === undefined
            ? {}
            : { 'Content-Length': String(Buffer.byteLength(init.body)) }),
          ...init.headers,
        },
      },
      (res) => {
        const pedacos: Buffer[] = [];
        res.on('data', (d: Buffer) => pedacos.push(d));
        res.on('end', () => {
          const texto = Buffer.concat(pedacos).toString('utf8');
          let corpo: Record<string, unknown> = {};
          try {
            corpo = texto ? (JSON.parse(texto) as Record<string, unknown>) : {};
          } catch {
            // Resposta que não é JSON (um HTML de erro do balanceador, por
            // exemplo). O texto cru segue para quem chamou montar a mensagem.
          }
          resolve({ status: res.statusCode ?? 0, corpo, texto });
        });
      },
    );

    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error('fyhub: tempo esgotado')));
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

/** Mensagem de erro no formato RFC 7807, que é o que a FyHub devolve. */
function mensagemDeErro(r: Resposta): string {
  const c = r.corpo;
  const violacoes = Array.isArray(c.violacoes)
    ? (c.violacoes as Record<string, unknown>[])
        .map((v) => `${String(v.propriedade ?? '?')}: ${String(v.razao ?? '')}`.trim())
        .join('; ')
    : '';
  const base = String(c.detail ?? c.title ?? c.message ?? c.error_description ?? c.error ?? '');
  const texto = [base, violacoes].filter(Boolean).join(' — ');
  return texto || `http_${r.status}` + (r.texto ? ` ${r.texto.slice(0, 160)}` : '');
}

/* ------------------------------------------------------------------ *
 * Token
 * ------------------------------------------------------------------ */

let tokenEmMemoria: { valor: string; expiraEm: number; modo: string } | null = null;

export function invalidarTokenFyhub(): void {
  tokenEmMemoria = null;
}

/**
 * OAuth 2.0 client_credentials em `POST /oauth/token`.
 *
 * A documentação diz o fluxo e o endpoint, mas não o formato exato do corpo.
 * Em vez de esperar a resposta deles para poder testar qualquer coisa, a
 * função tenta a forma do RFC 6749 (formulário + `Authorization: Basic`) e,
 * **só se o servidor reclamar do formato** (400 ou 415), repete em JSON, que
 * é a forma que a Appmax usa e que vários PSP brasileiros copiaram.
 *
 * A distinção importa: 401 e 403 são credencial recusada e **não** geram
 * segunda tentativa — insistir com outro formato transformaria "seu
 * client_secret está errado" num erro confuso sobre media type.
 */
async function obterToken(modo: 'sandbox' | 'production'): Promise<string> {
  if (tokenEmMemoria && tokenEmMemoria.modo === modo && tokenEmMemoria.expiraEm > Date.now() + 30_000) {
    return tokenEmMemoria.valor;
  }

  const clientId = await getSecret(SECRET_KEYS.fyhubClientId);
  const clientSecret = await getSecret(SECRET_KEYS.fyhubClientSecret);
  if (!clientId || !clientSecret) throw new Error('fyhub_sem_credencial');

  const agent = await obterAgente();
  const url = `${base(modo)}/oauth/token`;

  let res = await pedir(url, {
    method: 'POST',
    agent,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
  });

  if (res.status === 400 || res.status === 415) {
    res = await pedir(url, {
      method: 'POST',
      agent,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });
  }

  if (res.status < 200 || res.status >= 300) {
    throw new Error(`fyhub: token recusado (${res.status}) ${mensagemDeErro(res)}`.trim());
  }

  const valor =
    (res.corpo.access_token as string | undefined) ??
    ((res.corpo.data as Record<string, unknown> | undefined)?.access_token as string | undefined);
  if (!valor) throw new Error('fyhub: resposta de token sem access_token');

  const segundos = Number(res.corpo.expires_in ?? 3600);
  tokenEmMemoria = {
    valor,
    modo,
    expiraEm: Date.now() + (Number.isFinite(segundos) && segundos > 0 ? segundos : 3600) * 1000,
  };
  return valor;
}

/** Chamada autenticada à API QRCode. */
async function fyhubFetch(
  caminho: string,
  init: { method?: string; body?: unknown; aceitar404?: boolean } = {},
): Promise<Resposta> {
  const cfg = await getSiteConfig();
  const modo = cfg.gatewayMode;
  const agent = await obterAgente();
  const token = await obterToken(modo);

  const res = await pedir(`${base(modo)}${caminho}`, {
    method: init.method ?? 'GET',
    agent,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  if (res.status === 401) {
    // Token vencido antes da hora: descarta para a próxima chamada pegar
    // outro, em vez de manter um token morto em memória.
    invalidarTokenFyhub();
  }
  if (init.aceitar404 && res.status === 404) return res;
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`fyhub: ${mensagemDeErro(res)}`);
  }
  return res;
}

/* ------------------------------------------------------------------ *
 * txid
 * ------------------------------------------------------------------ */

const ALFABETO = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Identificador da cobrança, no formato que a especificação exige:
 * `[a-zA-Z0-9]{26,35}`.
 *
 * São 32 caracteres sorteados de fonte criptográfica — não porque o txid
 * seja segredo (ele aparece no QR), mas porque previsível ele permitiria a
 * um curioso consultar cobranças alheias na conta do dono. O `reference` do
 * pedido não entra: além de curto demais, casar o identificador público do
 * comprador com o da cobrança expõe um ao outro sem necessidade.
 */
export function gerarTxid(): string {
  const bytes = randomBytes(32);
  let saida = '';
  for (const b of bytes) saida += ALFABETO[b % ALFABETO.length];
  return saida;
}

/* ------------------------------------------------------------------ *
 * Status
 * ------------------------------------------------------------------ */

/**
 * Status da cobrança BCB → o nosso.
 *
 * A comparação é feita sobre o texto normalizado (minúsculo, sem acento,
 * separador único) pelo mesmo motivo da Appmax: a grafia varia entre a
 * resposta da consulta e o corpo do webhook, e comparar a string crua é como
 * um status novo passaria batido.
 *
 * `REMOVIDA_PELO_USUARIO_RECEBEDOR` e `REMOVIDA_PELO_PSP` viram `expired`:
 * para o comprador, os dois querem dizer "esse código não vale mais, gere
 * outro". Status desconhecido devolve `null` — "não sei" é diferente de
 * "não foi pago", e é o `null` que faz o webhook devolver 500 e o provedor
 * reenviar em vez de a venda ficar marcada como perdida.
 */
export function mapearStatusFyhub(bruto: unknown): PaymentStatus | null {
  const texto = String(bruto ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s_-]+/g, ' ')
    .trim();

  if (!texto) return null;
  if (texto === 'ativa') return 'pending';
  if (texto === 'concluida') return 'paid';
  if (texto.startsWith('removida')) return 'expired';
  return null;
}

/* ------------------------------------------------------------------ *
 * Webhook — o segredo do caminho
 * ------------------------------------------------------------------ */

/**
 * Confere o segredo que viaja no caminho da URL do webhook.
 *
 * **Falha fechada**: sem segredo cadastrado, nada é aceito.
 *
 * Por que no caminho e não na query, como na Appmax: o padrão BCB manda o
 * PSP chamar `{webhookUrl}/pix`, concatenando. Uma URL cadastrada como
 * `…/webhooks/fyhub?t=SEGREDO` viraria `…/webhooks/fyhub?t=SEGREDO/pix` — o
 * segredo com um `/pix` grudado no fim, e a rota recusando tudo. No caminho,
 * a concatenação é inofensiva.
 */
export async function conferirTokenFyhub(recebido: string | undefined): Promise<boolean> {
  return conferirSegredoDeWebhook(SECRET_KEYS.fyhubWebhookToken, recebido);
}

/** A URL que o dono cadastra na FyHub, montada com o segredo gravado. */
export async function urlDoWebhook(publicUrl: string): Promise<string | null> {
  const token = await getSecret(SECRET_KEYS.fyhubWebhookToken);
  if (!token) return null;
  return `${publicUrl.replace(/\/+$/, '')}/webhooks/fyhub/${encodeURIComponent(token)}`;
}

/**
 * Registra o webhook na FyHub — `PUT /webhook/{chave}`.
 *
 * Existe porque, no padrão BCB, o webhook é cadastrado **pela API** e não
 * num formulário do site do provedor, como no Mercado Pago. Sem esta
 * chamada, a cobrança é criada e ninguém nunca avisa que foi paga.
 */
export async function registrarWebhook(publicUrl: string): Promise<{ url: string }> {
  const chave = await getSecret(SECRET_KEYS.fyhubPixKey);
  if (!chave) throw new Error('fyhub: falta a chave Pix do recebedor');

  const url = await urlDoWebhook(publicUrl);
  if (!url) throw new Error('fyhub: falta o segredo do webhook');

  await fyhubFetch(`/webhook/${encodeURIComponent(chave)}`, {
    method: 'PUT',
    body: { webhookUrl: url },
  });

  return { url };
}

/* ------------------------------------------------------------------ *
 * Adaptador
 * ------------------------------------------------------------------ */

function objeto(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

export const fyhubGateway: PaymentGateway = {
  id: 'fyhub',
  label: 'FyHub',

  async createPixCharge({ order, customer, expiresInMin }): Promise<PixCharge> {
    const chave = await getSecret(SECRET_KEYS.fyhubPixKey);
    if (!chave) throw new Error('fyhub: falta a chave Pix do recebedor');

    const txid = gerarTxid();

    /**
     * `valor.original` é decimal com duas casas, em reais — a especificação
     * não aceita centavos. A conversão é a única do adaptador, e parte de
     * `order.amountCents`, que já vem do servidor com o cupom abatido.
     */
    const resposta = await fyhubFetch(`/cob/${txid}`, {
      method: 'PUT',
      body: {
        calendario: { expiracao: Math.round(expiresInMin * 60) },
        devedor: {
          cpf: customer.cpf.replace(/\D/g, ''),
          nome: customer.nome.trim().slice(0, 200),
        },
        valor: { original: (order.amountCents / 100).toFixed(2) },
        chave,
        // A especificação limita a 140 caracteres; o texto cabe com folga.
        solicitacaoPagador: `Codigo Vencedor - pedido ${order.reference}`.slice(0, 140),
      },
    });

    const cob = resposta.corpo;
    const emv = cob.pixCopiaECola as string | undefined;
    if (!emv) throw new Error('fyhub: resposta da cobrança sem pixCopiaECola');

    /**
     * O PNG é gerado aqui: a API do padrão BCB devolve só o copia-e-cola.
     * Mesmos parâmetros do Pix estático, para o QR sair idêntico ao que a
     * página já sabe exibir.
     */
    const qrCodeBase64 = (
      await QRCode.toDataURL(emv, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 512,
        color: { dark: '#000000', light: '#ffffff' },
      })
    ).replace(/^data:image\/png;base64,/, '');

    /**
     * A validade sai do calendário devolvido pela FyHub, não do nosso
     * relógio: se ela arredondar o prazo, o contador da página precisa
     * seguir o dela — cliente vendo "expirado" num código que ainda funciona
     * (ou o contrário) é reclamação garantida.
     */
    const calendario = objeto(cob.calendario);
    const criacao = calendario?.criacao ? new Date(String(calendario.criacao)) : null;
    const segundos = Number(calendario?.expiracao ?? expiresInMin * 60);
    const expiraEm =
      criacao && !Number.isNaN(criacao.getTime()) && Number.isFinite(segundos)
        ? new Date(criacao.getTime() + segundos * 1000)
        : new Date(Date.now() + expiresInMin * 60_000);

    return {
      providerOrderId: String(cob.txid ?? txid),
      // O `endToEndId` só existe depois que alguém paga; quem o grava é o
      // webhook, ao confirmar.
      providerPaymentId: null,
      emv,
      qrCodeBase64,
      expiresAt: expiraEm,
      simulated: false,
      raw: cob,
    };
  },

  async getStatus({ providerOrderId }): Promise<PaymentStatus | null> {
    if (!providerOrderId) return null;

    const res = await fyhubFetch(`/cob/${encodeURIComponent(providerOrderId)}`, { aceitar404: true });
    // Cobrança que a FyHub não conhece: "não sei", não "não foi paga".
    if (res.status === 404) return null;

    return mapearStatusFyhub(res.corpo.status);
  },

  /**
   * Teste de conexão em três degraus, cada um dizendo uma coisa diferente:
   *
   *   1. **Certificado** — monta o agente mTLS. PEM trocado ou colado pela
   *      metade morre aqui, com frase própria. É o erro mais provável desta
   *      integração, porque é o único material que chega por e-mail em
   *      formato binário e precisa ser convertido à mão.
   *   2. **Credencial** — pede o token. 401/403 é client_id/secret errado.
   *   3. **Chave Pix e webhook** — `GET /webhook/{chave}` prova que a chave
   *      pertence à conta e conta se o webhook já está registrado, que é
   *      exatamente a pergunta que o dono tem depois de salvar a tela.
   *
   * Nenhum degrau cria cobrança: testar integração não pode sujar a conta.
   */
  async verifyCredentials(): Promise<VerifyResult> {
    const cfg = await getSiteConfig();

    const avisoAmbiente =
      FYHUB_SEM_HOMOLOGACAO && cfg.gatewayMode === 'sandbox'
        ? ' Atenção: a FyHub não publica uma base de homologação, então a loja em sandbox está falando com a API de produção — qualquer cobrança criada aqui é real.'
        : '';

    try {
      await obterAgente();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      return {
        ok: false,
        detail: msg.includes('sem_certificado')
          ? 'Faltam o certificado e a chave privada da FyHub (os dois em PEM).'
          : 'O certificado da FyHub não pôde ser lido. Confira se você colou o PEM inteiro, incluindo as linhas BEGIN e END, e se a senha está certa.',
        ambiente: 'desconhecido',
      };
    }

    try {
      invalidarTokenFyhub();
      await obterToken(cfg.gatewayMode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      return {
        ok: false,
        detail: /\(401\)|\(403\)|recusado|invalid/i.test(msg)
          ? 'A FyHub recusou o par client_id/client_secret da API QRCode.'
          : `Não foi possível autenticar na FyHub: ${msg}.`,
        ambiente: 'desconhecido',
      };
    }

    const chave = await getSecret(SECRET_KEYS.fyhubPixKey);
    if (!chave) {
      return {
        ok: false,
        detail: 'A credencial foi aceita, mas falta a chave Pix do recebedor — sem ela não há como criar cobrança.' + avisoAmbiente,
        account: 'autenticado',
        ambiente: 'desconhecido',
      };
    }

    try {
      const res = await fyhubFetch(`/webhook/${encodeURIComponent(chave)}`, { aceitar404: true });
      const registrado = res.status !== 404 && Boolean(res.corpo.webhookUrl);

      return {
        ok: true,
        detail:
          (registrado
            ? `A FyHub autenticou e o webhook já está registrado para esta chave Pix.`
            : `A FyHub autenticou e reconheceu a chave Pix, mas o webhook ainda não está registrado — use o botão "Registrar webhook", ou nenhum pagamento será confirmado sozinho.`) + avisoAmbiente,
        account: `chave Pix …${chave.slice(-4)}`,
        ambiente: 'desconhecido',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      return {
        ok: false,
        detail: `A credencial vale, mas a FyHub não aceitou consultar o webhook desta chave Pix: ${msg}. Confira se a chave está cadastrada nesta conta.` + avisoAmbiente,
        account: `chave Pix …${chave.slice(-4)}`,
        ambiente: 'desconhecido',
      };
    }
  },
};
