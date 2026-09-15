import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { clientIp } from '../lib/security.js';
import { readVisitorId } from '../lib/visitor.js';
import { sanitizeUtm } from '../lib/attribution.js';
import { forwardEvent } from '../services/conversions.js';
import { dispatchOutbound } from '../services/outbound.js';

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
  'checkout_abandoned',
  'purchase',
  /* Cupom: `coupon_applied` quando o servidor aceitou o código,
     `coupon_rejected` quando recusou. Os dois saem da LP depois da resposta
     de `/api/checkout/coupon`, então o que chega aqui é o veredito do
     servidor, não a opinião da página. Servem para o dono ver quais cupons
     circulam e quantas pessoas erram o código antes de desistir. */
  'coupon_applied',
  'coupon_rejected',
]);

/**
 * `pix_abandoned` NÃO entra nesta lista, e é de propósito.
 *
 * Ele nasce no servidor, quando o job de recuperação vê a cobrança vencer.
 * Uma rota pública capaz de registrar "Pix abandonado" só serviria para
 * qualquer um encher o dashboard do dono com abandono que nunca existiu.
 */

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

interface Log {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
}

/**
 * Tira CPF completo do `params` antes de qualquer gravação.
 *
 * O CPF vive cifrado em `Lead.cpfEnc` e só sai mascarado ou nos três últimos
 * dígitos — é a regra do projeto inteiro. `params` é um objeto livre vindo do
 * navegador, ou seja, exatamente o caminho por onde essa regra fura sem
 * ninguém perceber: bastaria a página passar a mandar `cpf` para o número
 * inteiro ficar em claro na tabela de eventos e, pior, no corpo do webhook de
 * saída, que vai para uma URL digitada num formulário.
 *
 * Vale para todos os eventos, não só o `checkout_abandoned`: a garantia tem
 * que ser da rota, senão volta a depender de quem escrever o próximo evento
 * lembrar dela. `cpf_last3` continua passando — três dígitos não identificam
 * ninguém e é o que o dono usa para conferir o pedido.
 */
function semCpfCompleto(params: Record<string, unknown>): Record<string, unknown> {
  const limpo: Record<string, unknown> = {};

  for (const [chave, valor] of Object.entries(params)) {
    if (!/cpf/i.test(chave)) {
      limpo[chave] = valor;
      continue;
    }
    // Campo de CPF: `cpf` cru nunca passa, e qualquer outro só passa se o que
    // vier dentro não for um documento inteiro.
    if (chave.toLowerCase() === 'cpf') continue;
    if (typeof valor === 'string' && valor.replace(/\D/g, '').length >= 11) continue;
    limpo[chave] = valor;
  }

  return limpo;
}

/**
 * Puxa para colunas próprias o que o painel precisa perguntar por clique.
 *
 * Os três valores já vinham dentro de `params`, que é JSON. Responder "quais
 * botões foram mais clicados esta semana" a partir de JSON exige varrer a
 * tabela inteira a cada abertura da tela — e a tabela de eventos é a que mais
 * cresce no projeto. Com colunas indexadas, a mesma pergunta vira um
 * `GROUP BY`.
 *
 * `params` continua guardando tudo: as colunas são cópia para consulta, não
 * substituição. Um evento antigo, gravado antes destas colunas existirem,
 * simplesmente tem os três nulos — nada a migrar.
 */
function colunasDeClique(
  event: string,
  params: Record<string, unknown>,
): {
  cta: string | null;
  clickLabel: string | null;
  clickSection: string | null;
} {
  const texto = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const limpo = v.trim().replace(/\s+/g, ' ');
    return limpo ? limpo.slice(0, max) : null;
  };

  const rotulo = texto(params.label ?? params.click_label, 120);

  /**
   * Chave de agrupamento a partir do texto do botão.
   *
   * Só os CTAs de compra têm `data-cv-cta` no HTML, e isso é de propósito: o
   * `select_promotion` alimenta a etapa "Clicaram no CTA" do funil, e marcar
   * botões que não levam à compra ali inflaria a taxa de conversão. Mas a
   * pergunta do dono é "onde foi que o lead clicou", e ela vale para todo
   * botão. A saída é derivar a chave do próprio rótulo: o relatório de
   * cliques fica completo sem tocar no funil.
   *
   * Sem acento porque "Começar" e "Comecar" têm que cair no mesmo grupo se
   * alguém reescrever a página.
   */
  const chaveDoRotulo = rotulo
    ? rotulo
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 60) || null
    : null;

  return {
    /* `cta` é o identificador estável do botão (`hero`, `oferta`, `faq`) e
       vem do atributo `data-cv-cta` do HTML; nos cliques genéricos cai na
       chave derivada do rótulo. */
    cta: texto(params.cta, 60) ?? (event === 'click' ? chaveDoRotulo : null),
    /* O texto que a pessoa leu no botão. Muda quando o dono reescreve a
       página, por isso não serve de chave — serve para o dono reconhecer o
       botão sem abrir o HTML. */
    clickLabel: rotulo,
    /* Em que trecho da página o clique aconteceu. Responde "onde foi que o
       lead clicou", que é a pergunta que originou esta tela. */
    clickSection: texto(params.section ?? params.click_section, 60),
  };
}

/**
 * Acha o lead por trás de um evento anônimo.
 *
 * Quem clica não se identificou ainda, então o evento nasce sem `leadId`. Mas
 * a mesma pessoa preenche o formulário minutos depois, e a partir daí o
 * `visitorId` (cookie httpOnly, de primeira parte) e o `sessionId` ligam os
 * dois. Procurar aqui é o que permite abrir um cliente no painel e ver o
 * caminho que ele fez até comprar, em vez de uma lista de cliques órfãos.
 *
 * A busca é em duas etapas, da mais barata para a mais cara:
 *
 * 1. `Lead.visitorId` — coluna indexada, e o cookie atravessa sessões: é o
 *    mesmo da visita de ontem. Resolve o caso comum numa consulta só.
 * 2. Um evento anterior da mesma sessão que já esteja ligado a um lead. Serve
 *    para quem chegou sem o cookie (primeira visita, navegação privada) e
 *    ainda assim preencheu o formulário nesta sessão.
 *
 * Nunca derruba a gravação: se a busca falhar, o evento entra sem lead, e a
 * ligação pode ser refeita depois pelo `visitorId`.
 */
async function leadDoVisitante(visitorId: string | null, sessionId: string | null): Promise<string | null> {
  if (!visitorId && !sessionId) return null;

  if (visitorId) {
    const lead = await prisma.lead
      .findFirst({ where: { visitorId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
      .catch(() => null);
    if (lead) return lead.id;
  }

  if (sessionId) {
    const evento = await prisma.funnelEvent
      .findFirst({
        where: { sessionId, leadId: { not: null } },
        orderBy: { createdAt: 'desc' },
        select: { leadId: true },
      })
      .catch(() => null);
    if (evento?.leadId) return evento.leadId;
  }

  return null;
}

/**
 * Monta o `custom_data` que acompanha o evento nas APIs de conversão.
 *
 * Antes, nenhum evento vindo do navegador levava `custom_data` — ou seja, a
 * Meta recebia "houve um InitiateCheckout" sem valor nenhum, e campanha
 * otimizada por valor não tinha por onde otimizar. Aqui vai só o que a Meta
 * entende e o que a página realmente tem: valor, moeda, produto e cupom.
 *
 * Lista fechada de propósito. `params` é objeto livre vindo do navegador, e
 * repassá-lo inteiro mandaria para um terceiro qualquer campo que alguém
 * resolvesse acrescentar na página um dia.
 */
function customDataDoEvento(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const saida: Record<string, unknown> = {};

  const numero = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  const value = numero(params.value);
  if (value !== null) saida.value = value;

  if (typeof params.currency === 'string') saida.currency = params.currency.slice(0, 8);
  if (typeof params.content_name === 'string') saida.content_name = params.content_name.slice(0, 120);
  if (typeof params.coupon === 'string' && params.coupon) saida.coupon = params.coupon.slice(0, 40);

  return Object.keys(saida).length > 0 ? saida : undefined;
}

interface AbandonoDoNavegador {
  eventId: string;
  sessionId: string | null;
  visitorId: string | null;
  utm: object;
  params: Record<string, unknown>;
  page: string | null;
  referrer: string | null;
  ip: string;
  userAgent: string | null;
  log: Log;
}

/**
 * Grava o `checkout_abandoned` que veio do navegador.
 *
 * Tem caminho próprio por três motivos que o fluxo genérico não resolve:
 *
 * 1. **Deduplicação de negócio.** O `@unique` do `eventId` só barra o mesmo
 *    disparo repetido, e aqui cada disparo traz um UUID novo: `pagehide` e
 *    `visibilitychange` acontecem várias vezes na mesma visita — trocar de
 *    aba, minimizar, voltar. Sem esta trava uma pessoa só viraria quatro
 *    abandonos, e o número do dashboard deixaria de significar gente. A chave
 *    é a sessão; sem sessão, o visitante. Sem nenhum dos dois não há como
 *    agrupar, e aí grava: perder o abandono é pior do que contar um a mais.
 * 2. **Vínculo com o lead.** O e-mail que a pessoa já tinha digitado chega no
 *    `params`; achando o `Lead`, o payload do backoffice ganha o bloco
 *    `lead` em vez de um evento anônimo.
 * 3. **Nada vai para as APIs de conversão.** `checkout_abandoned` não tem
 *    equivalente na Meta, então `forwardEvent` só devolveria
 *    `sem_evento_equivalente`. Quem consome este evento é o webhook de saída.
 */
async function registrarCheckoutAbandonado(entrada: AbandonoDoNavegador): Promise<void> {
  const { eventId, sessionId, visitorId, params, log } = entrada;

  const chave = sessionId ? { sessionId } : visitorId ? { visitorId } : null;
  if (chave) {
    const jaRegistrado = await prisma.funnelEvent.findFirst({
      where: { event: 'checkout_abandoned', ...chave },
      select: { id: true },
    });
    if (jaRegistrado) return;
  }

  const email = typeof params.email === 'string' ? params.email.toLowerCase().trim() : '';
  const lead = email
    ? await prisma.lead.findFirst({ where: { email }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    : null;

  const { count } = await prisma.funnelEvent.createMany({
    skipDuplicates: true,
    data: [
      {
        eventId,
        event: 'checkout_abandoned',
        sessionId,
        visitorId,
        leadId: lead?.id ?? null,
        utm: entrada.utm,
        params: params as object,
        page: entrada.page,
        referrer: entrada.referrer,
        ip: entrada.ip,
        userAgent: entrada.userAgent,
      },
    ],
  });

  // Reenvio do mesmo `event_id`: já está gravado e já foi encaminhado.
  if (count === 0) return;

  /* O `createMany` não devolve id, e o id interno é o que traz o bloco
     `site` (IP, user-agent, página, sessão, params) para o corpo do webhook.
     A leitura extra sai caro em lugar nenhum: isto roda fora da resposta. */
  const gravado = await prisma.funnelEvent.findUnique({ where: { eventId }, select: { id: true } });
  if (!gravado) return;

  dispatchOutbound(
    'checkout.abandoned',
    { funnelEventId: gravado.id, ...(lead ? { leadId: lead.id } : {}) },
    log,
  ).catch((err) => log.warn({ err, eventId }, 'falha ao enfileirar webhook de saída'));
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

      const params: Record<string, unknown> = {
        ...semCpfCompleto(body.params ?? {}),
        ...(body.fbp ? { fbp: body.fbp } : {}),
        ...(body.fbc ? { fbc: body.fbc } : {}),
      };

      /* O abandono de checkout tem regra própria de deduplicação e de vínculo
         com o lead; nada disso cabe no caminho genérico abaixo. Também dispara
         e esquece — quem está saindo da página não espera por nós. */
      if (body.event === 'checkout_abandoned') {
        registrarCheckoutAbandonado({
          eventId: body.event_id,
          sessionId: body.session_id ?? null,
          visitorId,
          utm: sanitizeUtm(body.utm) as object,
          params,
          page: body.page ?? null,
          referrer: body.referrer?.slice(0, 500) ?? null,
          ip,
          userAgent: userAgent ?? null,
          log: req.log,
        }).catch((err) => req.log.warn({ err }, 'falha ao registrar checkout abandonado'));

        return reply.code(204).send();
      }

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
      leadDoVisitante(visitorId, body.session_id ?? null)
        .then((leadId) =>
          prisma.funnelEvent.createMany({
            skipDuplicates: true,
            data: [
              {
                eventId: body.event_id,
                event: body.event,
                sessionId: body.session_id ?? null,
                visitorId,
                /**
                 * Antes isto era sempre `null`, e o resultado aparecia na
                 * tela como uma lista de cliques sem dono: dava para ver que
                 * alguém clicou, nunca quem. Com o lead resolvido aqui, a
                 * ficha do cliente consegue mostrar o caminho que ele fez.
                 */
                leadId,
                utm: sanitizeUtm(body.utm) as object,
                params: params as object,
                ...colunasDeClique(body.event, params),
                page: body.page ?? null,
                referrer: body.referrer?.slice(0, 500) ?? null,
                ip,
                userAgent: userAgent ?? null,
              },
            ],
          }),
        )
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
            /**
             * Valor, moeda, produto e cupom vão junto.
             *
             * Sem isto, a Meta recebia "houve um InitiateCheckout" sem valor
             * nenhum — e campanha otimizada por valor de conversão não tinha
             * por onde otimizar. O GA4 tem o mesmo problema no funil de
             * comércio. Lista fechada; ver `customDataDoEvento`.
             */
            customData: customDataDoEvento(params),
            /* O GA4 exige `client_id`; sem estes dois ele cai no anônimo e o
               relatório dele deixa de casar com o do painel. */
            visitorId,
            sessionId: body.session_id ?? null,
          });
        })
        .catch((err) => req.log.warn({ err, event: body.event }, 'falha ao processar evento de funil'));

      return reply.code(204).send();
    },
  );
};
