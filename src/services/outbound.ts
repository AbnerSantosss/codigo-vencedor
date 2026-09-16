import { createHmac, randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { montarPayload, type EventoSaida, type RefSaida } from './eventPayload.js';

/**
 * Webhooks de saída — avisar um sistema de fora quando algo acontece aqui.
 *
 * O caso de uso do dono é ligar a plataforma a um n8n/Make/Zapier para
 * liberar acesso, lançar nota ou avisar no WhatsApp sem precisar de código.
 *
 * Três coisas guiam o desenho:
 *
 * 1. **A entrega é registrada antes de ser tentada.** A linha em
 *    `OutboundDelivery` nasce com o `payload` já montado, e só depois o HTTP
 *    acontece. Se o processo cair no meio, a entrega continua existindo e o
 *    job de retentativa a encontra. O contrário — tentar e registrar depois —
 *    perderia exatamente as entregas que mais importam saber que falharam.
 * 2. **O destino tem como saber que a chamada veio daqui.** Cada requisição
 *    é assinada com HMAC-SHA256 sobre `<timestamp>.<corpo>`. Amarrar o
 *    horário ao corpo é o que impede alguém que capturou uma entrega de
 *    reenviá-la depois com o corpo trocado.
 * 3. **CPF não sai.** Vai só o mascarado. O CPF vive cifrado no banco de
 *    propósito, e mandá-lo em texto para uma URL digitada num formulário
 *    desfaria isso silenciosamente. Se algum dia for preciso para emitir
 *    nota, que seja uma decisão explícita do dono, não um efeito colateral.
 */

/* ------------------------------------------------------------------ *
 * Catálogo de eventos e montagem do corpo
 * ------------------------------------------------------------------ */

/**
 * O catálogo e o montador do payload moram em `eventPayload.ts`, e não aqui,
 * porque o backoffice precisa montar exatamente o mesmo corpo para mostrar ao
 * dono o que o destino recebeu. Enquanto eram duas montagens elas divergiam a
 * cada campo novo. Reexportados para não quebrar quem já importa daqui.
 */
export {
  EVENTOS_SAIDA,
  EVENTOS_SAIDA_LISTA,
  eventoSaidaValido,
  eventoSaidaDoSite,
} from './eventPayload.js';
export type { EventoSaida, RefSaida, CorpoSaida } from './eventPayload.js';

interface Log {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}

/* ------------------------------------------------------------------ *
 * Política de retentativa
 * ------------------------------------------------------------------ */

/**
 * Espera antes de cada nova tentativa, em segundos.
 *
 * Começa em 1 minuto e chega a 6 horas: cobre desde o reinício de um n8n até
 * uma queda de meio dia. Depois da última, a entrega para de ser tentada e
 * fica como carta morta — `deliveredAt` nulo e `nextRetryAt` nulo —, estado
 * que o painel lista para reprocessamento manual.
 */
const ESPERAS_S = [60, 300, 1800, 7200, 21_600];
export const MAX_TENTATIVAS = ESPERAS_S.length + 1;

const TIMEOUT_MS = 8000;
const TRECHO_RESPOSTA_MAX = 500;

/** Quantas entregas o job drena por rodada, para não virar tempestade. */
const LOTE_POR_RODADA = 20;

/* ------------------------------------------------------------------ *
 * URL de destino
 * ------------------------------------------------------------------ */

export type UrlInvalida = 'formato' | 'protocolo' | 'credencial' | 'metadados' | 'dns';

/**
 * Confere a URL que o dono digitou.
 *
 * **Isto não é bloqueio completo de SSRF, e a escolha é consciente.** O
 * servidor passa a fazer requisição para um endereço digitado no painel, o
 * que em teoria pede recusar toda rede privada. Só que o destino mais
 * provável aqui é um n8n auto-hospedado na mesma máquina ou na mesma rede
 * Docker — recusar rede privada quebraria justamente o caso de uso real.
 *
 * O que é recusado, então, é o que não tem uso legítimo nenhum: protocolo
 * fora de http/https, credencial embutida na URL (que iria para o log de
 * qualquer proxy no caminho) e a faixa link-local/metadados de nuvem, cuja
 * única razão de aparecer aqui seria roubar credencial da máquina.
 *
 * Esta função faz só a parte sincrona (formato, protocolo, credencial).
 * A faixa de metadados é conferida em `conferirDestinoResolvido`, que
 * precisa resolver o nome antes de decidir.
 *
 * A mitigação de verdade é outra: só o `owner` autenticado cadastra destino,
 * e o painel avisa quando a URL não é HTTPS.
 */
export function conferirUrlDestino(url: string): { ok: true; url: URL } | { ok: false; motivo: UrlInvalida } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, motivo: 'formato' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, motivo: 'protocolo' };
  if (u.username || u.password) return { ok: false, motivo: 'credencial' };
  return { ok: true, url: u };
}

/**
 * Faixas que só servem para roubar credencial da máquina: link-local (onde
 * mora o endpoint de metadados de AWS, GCP, Azure e Oracle), o equivalente
 * IPv6 da AWS e o da Alibaba. Rede privada comum (10/8, 172.16/12, 192.168/16,
 * loopback) segue liberada de propósito — o destino real do dono é um n8n
 * auto-hospedado na mesma rede Docker, e recusá-la quebraria o caso de uso.
 */
function ehFaixaDeMetadados(ip: string): boolean {
  const limpo = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  if (limpo.startsWith('169.254.')) return true; // link-local IPv4 (inclui 169.254.169.254)
  if (limpo === '100.100.100.200') return true; // Alibaba Cloud
  const v6 = limpo.toLowerCase();
  if (v6.startsWith('fe80:')) return true; // link-local IPv6
  if (v6.startsWith('fd00:ec2:')) return true; // AWS IMDS sobre IPv6
  return false;
}

/**
 * Resolve o host e recusa se **qualquer** endereço cair na faixa de
 * metadados. Resolver é o que fecha as formas que a checagem por texto não
 * pega: `http://2852039166/` (decimal), `0xA9FEA9FE` (hex), `::ffff:169.254.169.254`
 * e um nome de domínio que aponte para lá.
 *
 * É chamada de novo na hora de entregar, e não só ao salvar, porque o DNS
 * pode mudar entre as duas coisas (DNS rebinding). Resíduo conhecido: entre
 * esta checagem e a resolução que o `fetch` faz por conta própria ainda há
 * uma janela — fechá-la de vez exigiria fixar o IP no socket.
 */
export async function conferirDestinoResolvido(
  u: URL,
): Promise<{ ok: true } | { ok: false; motivo: UrlInvalida }> {
  let enderecos: { address: string }[];
  try {
    enderecos = await lookup(u.hostname, { all: true });
  } catch {
    return { ok: false, motivo: 'dns' };
  }
  if (enderecos.some((e) => ehFaixaDeMetadados(e.address))) {
    return { ok: false, motivo: 'metadados' };
  }
  return { ok: true };
}


/* ------------------------------------------------------------------ *
 * Enfileirar
 * ------------------------------------------------------------------ */

/**
 * Cria uma entrega para cada webhook ativo inscrito no evento e tenta
 * mandar na hora.
 *
 * Não lança: quem chama são caminhos de negócio (confirmação de pagamento,
 * geração de Pix) que não podem quebrar porque um webhook de terceiro está
 * fora do ar.
 */
export async function dispatchOutbound(event: EventoSaida, ref: RefSaida, log: Log): Promise<number> {
  try {
    const alvos = await prisma.outboundWebhook.findMany({
      where: { active: true, events: { has: event } },
      select: { id: true },
    });
    if (alvos.length === 0) return 0;

    const corpo = await montarPayload(event, ref);
    if (!corpo) {
      log.warn({ event, ref }, 'webhook de saída: referência não encontrada');
      return 0;
    }

    const orderId = ref.orderId ?? null;

    const criadas = await prisma.$transaction(
      alvos.map((a) =>
        prisma.outboundDelivery.create({
          data: {
            webhookId: a.id,
            orderId,
            event,
            payload: corpo as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        }),
      ),
    );

    // Sem `await`: o caminho de negócio segue. As que falharem agora ficam
    // com `nextRetryAt` e o job cuida.
    for (const d of criadas) {
      entregar(d.id, log).catch((err) => log.warn({ err, deliveryId: d.id }, 'webhook de saída: falha na entrega'));
    }

    return criadas.length;
  } catch (err) {
    log.warn({ err, event }, 'webhook de saída: falha ao enfileirar');
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * Entregar
 * ------------------------------------------------------------------ */

/** Assinatura que o destino confere: `t=<unix>,v1=<hex de HMAC(t.corpo)>`. */
export function assinarSaida(segredo: string, corpoCru: string, agoraS = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', segredo).update(agoraS + '.' + corpoCru).digest('hex');
  return 't=' + agoraS + ',v1=' + v1;
}

/** Headers extras do webhook, se o dono cadastrou algum. */
function headersDoDono(cru: unknown): Record<string, string> {
  if (!cru || typeof cru !== 'object' || Array.isArray(cru)) return {};
  const saida: Record<string, string> = {};
  for (const [k, v] of Object.entries(cru as Record<string, unknown>)) {
    if (typeof v !== 'string') continue;
    const nome = k.trim().toLowerCase();
    // Deixar o dono sobrescrever estes quebraria a assinatura ou o roteamento.
    if (!nome || nome.startsWith('x-cv-') || nome === 'content-type' || nome === 'host' || nome === 'content-length') {
      continue;
    }
    saida[k.trim()] = v;
  }
  return saida;
}

export async function entregar(deliveryId: string, log: Log, ignorarDesativado = false): Promise<boolean> {
  const d = await prisma.outboundDelivery.findUnique({
    where: { id: deliveryId },
    select: {
      id: true,
      event: true,
      attempt: true,
      payload: true,
      deliveredAt: true,
      webhook: { select: { url: true, secret: true, method: true, headers: true, active: true } },
    },
  });
  if (!d || d.deliveredAt) return true;

  const tentativa = d.attempt + 1;

  /** Falha definitiva: nada a tentar de novo, então nem agenda. */
  const desistir = async (motivo: string) => {
    await prisma.outboundDelivery.update({
      where: { id: d.id },
      data: { attempt: tentativa, nextRetryAt: null, responseSnippet: motivo.slice(0, TRECHO_RESPOSTA_MAX) },
    });
    log.warn({ deliveryId: d.id, motivo }, 'webhook de saída: desistindo');
    return false;
  };

  // O teste do painel passa por aqui mesmo com o webhook desligado: quem
  // acabou de cadastrar um destino precisa poder conferir antes de ativar.
  if (!d.webhook.active && !ignorarDesativado) return desistir('webhook desativado');

  const alvo = conferirUrlDestino(d.webhook.url);
  if (!alvo.ok) return desistir('url recusada: ' + alvo.motivo);

  // Só `metadados` faz desistir: é decisão de política, não vai melhorar com
  // o tempo. Falha de DNS segue para o `fetch`, que erra e cai na retentativa
  // normal — `desistir` zera o `nextRetryAt`, e um DNS instável não pode
  // descartar de vez o aviso de uma venda.
  const resolvido = await conferirDestinoResolvido(alvo.url);
  if (!resolvido.ok && resolvido.motivo === 'metadados') return desistir('url recusada: metadados');

  const corpoCru = JSON.stringify(d.payload ?? {});
  const metodo = (d.webhook.method || 'POST').toUpperCase();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let statusCode: number | null = null;
  let trecho = '';

  try {
    const res = await fetch(alvo.url, {
      method: metodo,
      signal: controller.signal,
      redirect: 'manual', // Seguir redirecionamento levaria o corpo assinado a outro host.
      headers: {
        ...headersDoDono(d.webhook.headers),
        'Content-Type': 'application/json',
        'User-Agent': 'CodigoVencedor-Webhook/1',
        'X-CV-Event': d.event,
        'X-CV-Delivery': d.id,
        'X-CV-Attempt': String(tentativa),
        'X-CV-Signature': assinarSaida(d.webhook.secret, corpoCru),
      },
      body: metodo === 'GET' || metodo === 'HEAD' ? undefined : corpoCru,
    });
    statusCode = res.status;
    trecho = (await res.text().catch(() => '')).slice(0, TRECHO_RESPOSTA_MAX);
  } catch (err) {
    trecho = err instanceof Error ? (err.name === 'AbortError' ? 'timeout após 8s' : err.message) : 'erro desconhecido';
  } finally {
    clearTimeout(timer);
  }

  const entregue = statusCode !== null && statusCode >= 200 && statusCode < 300;

  if (entregue) {
    await prisma.outboundDelivery.update({
      where: { id: d.id },
      data: { attempt: tentativa, statusCode, responseSnippet: trecho, deliveredAt: new Date(), nextRetryAt: null },
    });
    return true;
  }

  /**
   * 4xx não é retentado, com uma exceção.
   *
   * Reenviar um corpo que o destino recusou por ser inválido dá o mesmo
   * resultado cinco vezes. Mas 408 (timeout), 425 (cedo demais) e 429
   * (excesso) são temporários — e 429 em particular é o destino pedindo
   * calma, não recusando o conteúdo.
   */
  const temporario =
    statusCode === null ||
    statusCode >= 500 ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429;

  const espera = ESPERAS_S[tentativa - 1];
  const vaiTentarDeNovo = temporario && espera !== undefined;

  await prisma.outboundDelivery.update({
    where: { id: d.id },
    data: {
      attempt: tentativa,
      statusCode,
      responseSnippet: trecho,
      nextRetryAt: vaiTentarDeNovo ? new Date(Date.now() + espera * 1000) : null,
    },
  });

  if (!vaiTentarDeNovo) {
    log.warn(
      { deliveryId: d.id, statusCode, tentativa, temporario },
      temporario ? 'webhook de saída: esgotou as tentativas' : 'webhook de saída: recusado sem retentativa',
    );
  }

  return false;
}

/* ------------------------------------------------------------------ *
 * Teste e reprocessamento (painel)
 * ------------------------------------------------------------------ */

/**
 * Manda uma entrega de teste para o destino, do jeito exato que uma de
 * verdade sairia — mesma assinatura, mesmos headers, mesmo caminho de
 * registro.
 *
 * O corpo é reconhecível (`event: 'test'`, `test: true`) para o destino não
 * confundir com uma venda. Simular a chamada por outro caminho testaria o
 * simulador, não a integração.
 */
export async function dispatchTeste(webhookId: string, log: Log): Promise<{ deliveryId: string; entregue: boolean }> {
  const corpo = {
    event: 'test',
    id: randomUUID(),
    sentAt: new Date().toISOString(),
    test: true,
    message: 'Entrega de teste enviada pelo painel do Código Vencedor.',
  };

  const d = await prisma.outboundDelivery.create({
    data: { webhookId, event: 'test', payload: corpo as unknown as Prisma.InputJsonValue },
    select: { id: true },
  });

  const entregue = await entregar(d.id, log, true).catch(() => false);
  return { deliveryId: d.id, entregue };
}

/**
 * Reprocessa uma entrega manualmente.
 *
 * O contador de tentativas volta a zero de propósito: reprocessar uma carta
 * morta é dizer "o destino foi arrumado, tenta de verdade agora". Sem zerar,
 * a escada de espera já estaria esgotada e uma falha momentânea mataria a
 * entrega na primeira tentativa, sem nova chance.
 */
export async function reprocessar(deliveryId: string, log: Log): Promise<boolean> {
  const d = await prisma.outboundDelivery.findUnique({
    where: { id: deliveryId },
    select: { id: true, deliveredAt: true },
  });
  if (!d || d.deliveredAt) return false;

  await prisma.outboundDelivery.update({
    where: { id: d.id },
    data: { attempt: 0, nextRetryAt: null, statusCode: null, responseSnippet: null },
  });

  return entregar(d.id, log).catch(() => false);
}

/* ------------------------------------------------------------------ *
 * Job de retentativa
 * ------------------------------------------------------------------ */

export async function runOutboundRetries(log: Log): Promise<{ tentadas: number; entregues: number }> {
  const vencidas = await prisma.outboundDelivery.findMany({
    where: { deliveredAt: null, nextRetryAt: { not: null, lte: new Date() } },
    orderBy: { nextRetryAt: 'asc' },
    take: LOTE_POR_RODADA,
    select: { id: true },
  });

  let entregues = 0;
  for (const d of vencidas) {
    // Em série, de propósito: vinte requisições simultâneas para o mesmo
    // n8n que acabou de voltar do ar o derrubariam de novo.
    if (await entregar(d.id, log).catch(() => false)) entregues += 1;
  }
  return { tentadas: vencidas.length, entregues };
}

export function startOutboundJob(log: Log): void {
  const tick = async () => {
    try {
      const r = await runOutboundRetries(log);
      if (r.tentadas) log.info(r, 'webhooks de saída: rodada concluída');
    } catch (err) {
      log.warn({ err }, 'webhooks de saída: falha na rodada');
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 60_000);
}
