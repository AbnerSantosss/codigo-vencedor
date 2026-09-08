import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { clientIp } from '../lib/security.js';
import { readVisitorId } from '../lib/visitor.js';
import { sanitizeUtm } from '../lib/attribution.js';
import { forwardEvent } from '../services/conversions.js';

/**
 * Eventos de funil vindos da landing page.
 *
 * Esta rota é o registro do que acontece no site: é dela que sai a tela de
 * Eventos do painel e, mais adiante, o disparo server-side para Meta CAPI,
 * GA4 e afins.
 *
 * Três decisões que valem o comentário:
 *  - responde 204 sempre, mesmo em erro de validação. O `sendBeacon` do
 *    navegador ignora a resposta, e um 400 aqui só encheria o log de ruído
 *    sem melhorar nada para o visitante;
 *  - o `event` é validado contra uma lista fechada. Sem isso, qualquer um
 *    poderia inflar a tabela com nomes arbitrários;
 *  - nada de bloquear a resposta esperando a gravação: o visitante não deve
 *    pagar o custo do nosso rastreamento.
 */

const ALLOWED_EVENTS = new Set([
  'page_view',
  'view_content',
  'select_promotion',
  'click',
  'begin_checkout',
  'generate_lead',
  'add_payment_info',
  'purchase',
]);

/**
 * Teto separado para `click`.
 *
 * O limite da rota é por IP e vale para todos os eventos somados. `click` é
 * o único que o visitante dispara à vontade — e se ele consumir a cota, os
 * eventos que decidem a venda (`begin_checkout`, `generate_lead`,
 * `add_payment_info`) começam a ser descartados justamente na hora em que
 * mais importam. Com um teto próprio, clique demais só derruba clique.
 *
 * Janela fixa em memória, que é o suficiente: é um processo só, e o objetivo
 * não é precisão contábil — é impedir que a categoria barata coma a cota das
 * que decidem a venda. Se um dia o app rodar em vários processos, o pior caso
 * é cada um permitir o seu teto, o que continua limitando.
 */
const CLICK_MAX = 30;
const CLICK_JANELA_MS = 60 * 1000;
const cliquesPorIp = new Map<string, { n: number; ate: number }>();

function cliqueDentroDoTeto(ip: string): boolean {
  const agora = Date.now();
  const atual = cliquesPorIp.get(ip);

  if (!atual || atual.ate <= agora) {
    cliquesPorIp.set(ip, { n: 1, ate: agora + CLICK_JANELA_MS });

    /* Limpeza oportunista: sem isto o Map cresce para sempre com um IP por
       visitante. Roda só quando já vale a pena e custa uma varredura curta. */
    if (cliquesPorIp.size > 5000) {
      for (const [chave, v] of cliquesPorIp) if (v.ate <= agora) cliquesPorIp.delete(chave);
    }
    return true;
  }

  if (atual.n >= CLICK_MAX) return false;
  atual.n += 1;
  return true;
}

const trackBody = z.object({
  event: z.string().max(40),
  event_id: z.string().max(64),
  session_id: z.string().max(64).optional(),
  params: z.record(z.unknown()).optional(),
  /* A lista fechada de chaves é aplicada por `sanitizeUtm`; aqui só o
     formato e o teto de tamanho. */
  utm: z.record(z.string().max(300)).optional(),
  fbp: z.string().max(120).optional(),
  fbc: z.string().max(200).optional(),
  page: z.string().max(200).optional(),
  referrer: z.string().max(500).optional(),
});

export const trackRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api/track',
    {
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      // Content-Type do sendBeacon com Blob às vezes chega como text/plain;
      // aceitar os dois evita perder eventos silenciosamente.
      bodyLimit: 8 * 1024,
    },
    async (req, reply) => {
      const parsed = trackBody.safeParse(req.body);
      if (!parsed.success || !ALLOWED_EVENTS.has(parsed.data.event)) {
        return reply.code(204).send();
      }

      const body = parsed.data;
      const ip = clientIp(req, env.TRUST_CLOUDFLARE);
      const userAgent = req.headers['user-agent']?.slice(0, 300);

      if (body.event === 'click' && !cliqueDentroDoTeto(ip)) {
        return reply.code(204).send();
      }

      /**
       * O cookie de visitante não vem no corpo: ele é `httpOnly` e viaja
       * sozinho, inclusive no `sendBeacon`, porque a chamada é de mesma
       * origem. Assim o navegador não tem como forjar de quem é o evento.
       */
      const visitorId = readVisitorId(req);

      // Dispara e esquece: a resposta não espera o banco nem a Meta. Quem
      // está comprando não deve pagar o custo do nosso rastreamento.
      /**
       * `createMany` com uma linha só, por causa do `skipDuplicates`.
       *
       * `eventId` é único no banco, então um `create` levantaria P2002 no
       * reenvio — e reenvio acontece: o `sendBeacon` repete quando a rede
       * troca, a aba é restaurada ou o próprio navegador decide tentar de
       * novo. Antes, cada repetição virava uma linha nova e inflava a coluna
       * "Eventos" do painel com atividade que nunca houve na tela.
       *
       * O `count` é o que diz se a linha entrou. Ele decide o envio para as
       * APIs de conversão: contar a mesma conversão duas vezes na Meta é pior
       * do que perder uma, porque estraga a otimização da campanha.
       */
      prisma.funnelEvent
        .createMany({
          skipDuplicates: true,
          data: [
            {
              eventId: body.event_id,
              event: body.event,
              sessionId: body.session_id ?? null,
              visitorId,
              utm: sanitizeUtm(body.utm) as object,
              params: {
                ...(body.params ?? {}),
                ...(body.fbp ? { fbp: body.fbp } : {}),
                ...(body.fbc ? { fbc: body.fbc } : {}),
              } as object,
              page: body.page ?? null,
              referrer: body.referrer?.slice(0, 500) ?? null,
              ip,
              userAgent: userAgent ?? null,
            },
          ],
        })
        .then(({ count }) => {
          // Reenvio do mesmo evento: já está gravado e já foi encaminhado.
          if (count === 0) return undefined;

          /**
           * O `purchase` NÃO sai daqui: ele nasce no servidor quando o
           * pagamento é confirmado. Se saísse, bastaria alguém chamar esta
           * rota para registrar uma venda que não existe.
           */
          if (body.event === 'purchase') return undefined;

          return forwardEvent({
            eventId: body.event_id,
            event: body.event,
            eventSourceUrl: `${env.PUBLIC_URL}${body.page ?? '/'}`,
            referrerUrl: body.referrer,
            ip,
            userAgent,
            fbp: body.fbp,
            fbc: body.fbc,
            // Lead ainda não existe nestas etapas; a identificação vem
            // de fbp/fbc e do IP.
            lead: null,
          });
        })
        .catch((err) => req.log.warn({ err, event: body.event }, 'falha ao processar evento de funil'));

      return reply.code(204).send();
    },
  );
};
