import { prisma } from '../db.js';

/**
 * Origem do tráfego: o que se aceita, e o que se congela.
 */

/**
 * As únicas chaves de origem que entram no banco.
 *
 * O `lp.js` já captura exatamente estas oito da query string, mas o servidor
 * aceitava `z.record(z.string())` — qualquer chave, com qualquer nome. Como a
 * rota é pública e responde 204 sem reclamar, bastava um `POST` à mão para
 * encher a coluna `utm` de chaves inventadas, que depois apareceriam nas
 * agregações de origem do painel como se fossem campanhas.
 *
 * `gclid`, `fbclid` e `ttclid` não são "UTM" no sentido estrito — são ids de
 * clique —, mas viajam no mesmo lugar e são o que as APIs de conversão pedem
 * para casar o evento, então moram aqui.
 */
export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
  'ttclid',
] as const;

const PERMITIDAS = new Set<string>(UTM_KEYS);

/** Teto por valor. O Zod já corta em 300; aqui é a rede de segurança para
 *  quem chamar esta função de outro caminho. */
const MAX_VALOR = 300;

/**
 * Devolve só as chaves conhecidas, como texto, sem vazio.
 *
 * Chave fora da lista é descartada em silêncio, e não é erro: um parâmetro
 * estranho na URL (`?fbclid=…&ref=parceiro`) não deve fazer o visitante
 * perder o evento — só não deve entrar no banco.
 */
export function sanitizeUtm(cru: unknown): Record<string, string> {
  if (!cru || typeof cru !== 'object') return {};
  const saida: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(cru as Record<string, unknown>)) {
    if (!PERMITIDAS.has(chave)) continue;
    if (typeof valor !== 'string') continue;
    const limpo = valor.trim().slice(0, MAX_VALOR);
    if (limpo) saida[chave] = limpo;
  }
  return saida;
}

/** A primeira visita de um visitante, como fica gravada. */
export interface FirstTouch {
  /** Origem daquela primeira chegada. */
  utm: Record<string, string>;
  /** Site que encaminhou, quando havia. */
  referrer: string | null;
  /** Página de entrada. */
  landing: string | null;
  /** Quando foi, em ISO. */
  at: string;
}

/**
 * Reconstrói a primeira visita deste visitante a partir do evento mais antigo
 * que ele produziu.
 *
 * **Por que derivar em vez de guardar.** A primeira visita acontece antes de
 * existir qualquer `Lead` — não há onde escrever. A alternativa seria uma
 * tabela `Visitor` só para isso, ou empurrar a origem para dentro do próprio
 * cookie. Nenhuma das duas é necessária: o primeiro `page_view` daquela
 * primeira sessão **já** carrega `utm`, `referrer`, `page` e `createdAt`, e o
 * índice em `FunnelEvent.visitorId` torna a busca barata.
 *
 * **Por que congelar depois.** O resultado é copiado para `Lead.firstTouch` e,
 * na compra, para `Order.firstTouch`. Sem congelar, o relatório mudaria de
 * resposta com o tempo — os eventos antigos podem ser expurgados, e o `Lead`
 * continua acumulando visitas depois da venda.
 *
 * **Para que serve.** `utm` responde "de onde veio a última visita", que é a
 * pergunta errada para decidir onde investir: quem descobre o produto num
 * anúncio, sai, e volta dias depois pelo Google credita a venda ao Google, e
 * o anúncio que fez o trabalho aparece com zero.
 */
export async function firstTouchDoVisitante(visitorId: string | null): Promise<FirstTouch | null> {
  if (!visitorId) return null;

  const primeiro = await prisma.funnelEvent.findFirst({
    where: { visitorId },
    orderBy: { createdAt: 'asc' },
    select: { utm: true, referrer: true, page: true, createdAt: true },
  });
  if (!primeiro) return null;

  return {
    utm: sanitizeUtm(primeiro.utm),
    referrer: primeiro.referrer,
    landing: primeiro.page,
    at: primeiro.createdAt.toISOString(),
  };
}
