import { randomBytes } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { isProd } from '../env.js';

/**
 * Identificador de visitante, em cookie de primeira parte.
 *
 * **Por que existe.** Até aqui o único identificador do site era o
 * `sessionId`, que vive no `sessionStorage` e morre ao fechar a aba. Com ele
 * o painel não conseguia responder nenhuma pergunta sobre *pessoas*: quem
 * chega pelo anúncio, sai e volta amanhã conta como dois; e a etapa do funil
 * que diz "visitantes" na verdade dizia "abas". O `visitorId` sobrevive ao
 * fechamento do navegador por um ano, então dá para separar "quantos eventos"
 * de "quantas pessoas" — que era a confusão da seção 12 do plano.
 *
 * **Por que `httpOnly`.** O servidor escreve e o servidor lê: nem o `lp.js`
 * nem o `sendBeacon` precisam mandar esse valor de volta, porque o cookie
 * viaja sozinho em toda requisição de mesma origem. Assim o `visitorId` fica
 * fora do alcance de JavaScript — um XSS não o lê e nada no navegador o
 * forja para se passar por outra pessoa. Foi por isso que não virou campo do
 * corpo do `POST /api/track`.
 *
 * **`sameSite: 'lax'`, e não `'strict'`.** Praticamente todo visitante chega
 * por um link de fora (anúncio, story, WhatsApp). Com `'strict'` o cookie
 * não é enviado nessa primeira navegação vinda de outro site, e o servidor
 * emitiria um `visitorId` novo a cada chegada — exatamente o problema que
 * este cookie existe para resolver. Os cookies de sessão do `/admin` seguem
 * em `'strict'`: lá não existe chegada legítima de fora.
 *
 * Não é dado pessoal: é um número aleatório sem relação com nome, e-mail ou
 * dispositivo. Só passa a apontar para uma pessoa quando ela mesma preenche
 * o formulário, e nesse momento o vínculo é gravado no `Lead`.
 */
export const VISITOR_COOKIE = 'cv_vid';

/** Um ano. Prazo comum para cookie de análise de primeira parte. */
const VISITOR_TTL_S = 365 * 24 * 60 * 60;

/** 16 bytes aleatórios em base64url: 22 caracteres, sem `+`, `/` nem `=`. */
function novoVisitorId(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Formato aceito na leitura.
 *
 * O cookie chega do cliente, então é entrada não confiável: sem esta
 * validação, um valor forjado à mão iria direto para a coluna `visitorId` e
 * para as agregações do painel. O teto de 64 protege o índice.
 */
const FORMATO = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Devolve o `visitorId` desta requisição, criando e enviando o cookie quando
 * ainda não há um válido. Chamar só onde se serve HTML: é a navegação que
 * marca a chegada de uma pessoa, não uma chamada de API.
 */
export function ensureVisitorId(req: FastifyRequest, reply: FastifyReply): string {
  const atual = readVisitorId(req);
  if (atual) return atual;

  const novo = novoVisitorId();
  reply.setCookie(VISITOR_COOKIE, novo, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: VISITOR_TTL_S,
  });
  return novo;
}

/**
 * Lê o `visitorId` sem criar nenhum. É o que as rotas de API usam: se o
 * cookie não veio (primeira requisição, navegador que bloqueia cookie,
 * `curl`), o evento é gravado sem visitante em vez de ganhar um id que nunca
 * mais vai se repetir e inflaria a contagem de pessoas.
 */
export function readVisitorId(req: FastifyRequest): string | null {
  const cru = req.cookies?.[VISITOR_COOKIE];
  return typeof cru === 'string' && FORMATO.test(cru) ? cru : null;
}
