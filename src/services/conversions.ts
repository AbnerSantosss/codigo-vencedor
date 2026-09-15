import { prisma } from '../db.js';
import { env } from '../env.js';
import { getSiteConfig } from './config.js';
import { SECRET_KEYS, ga4ApiSecretKey, getFirstSecret, metaCapiTokenKey } from './secrets.js';
import { tryDecrypt } from './crypto.js';
import { sendMetaEvent, toMetaEventName, type MetaResult } from './meta.js';
import { paramsDeComercio, sendGa4Event, toGa4EventName, type Ga4Result } from './ga4.js';

/**
 * Envio de conversões pelo servidor.
 *
 * Tudo aqui é "dispare e esqueça" do ponto de vista de quem chamou: o
 * comprador nunca espera a Meta responder para ver o QR Code, e uma falha de
 * rastreamento nunca pode derrubar uma venda. O resultado de cada plataforma
 * fica gravado em `FunnelEvent.forwarded`, que é o que a tela de Eventos
 * mostra quando algo não chega no Events Manager.
 *
 * **Isto não é a medição do funil.** O que o painel conta vem de
 * `POST /api/track` → `FunnelEvent`, primeira parte, e continua sendo a fonte
 * da verdade mesmo com pixel e GTM desligados. O que sai daqui é saída para
 * plataforma de anúncio — se a Meta recusar tudo, o dashboard não muda.
 *
 * Formato de `forwarded`, que a tela de Eventos lê:
 *  - `meta` / `ga4`: um resumo em texto (é o que vira o selo colorido);
 *  - `meta:<pixelId>` / `ga4:<measurementId>`: o resultado daquele alvo.
 *
 * O detalhe por alvo vai em chaves planas de propósito, e não num objeto
 * aninhado: a tela de Eventos faz `Object.values(forwarded).some(...)` e
 * `resultado.toLowerCase()` em cada valor (`panel/src/features/screens/
 * Eventos.tsx`), então um objeto ali derrubaria a listagem inteira com
 * TypeError — e a listagem é de outro agente, não dá para consertar junto.
 */

interface ForwardContext {
  eventId: string;
  event: string;
  eventSourceUrl: string;
  referrerUrl?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  /** Presente só a partir do formulário preenchido. */
  lead?: {
    nome: string;
    email: string;
    /* Nulos porque um lead em rascunho ainda não tem telefone nem CPF. */
    fone?: string | null;
    cpfEnc?: string | null;
  } | null;
  customData?: Record<string, unknown>;
  eventTimeMs?: number;
  /** Só o GA4 usa: é o `client_id`. Quem não passa, é buscado do `FunnelEvent`. */
  visitorId?: string | null;
  sessionId?: string | null;
}

/* ------------------------------------------------------------------ *
 * Alvos configurados
 *
 * "Alvo" é um pixel (ou stream) ativo **e** com credencial resolvida. Um item
 * cadastrado sem token não vira alvo: ele aparece em `forwarded` como
 * `sem_token` para o dono ver o motivo, em vez de sumir em silêncio.
 * ------------------------------------------------------------------ */

interface AlvoMeta {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
  eventos: Set<string>;
}

async function alvosMeta(): Promise<{ ativos: AlvoMeta[]; semCredencial: string[] }> {
  const cfg = await getSiteConfig();
  const ativos: AlvoMeta[] = [];
  const semCredencial: string[] = [];

  for (const pixel of cfg.tracking.meta.pixels) {
    if (!pixel.active) continue;
    /* Token por pixel, com queda para o `meta.capiToken` antigo: é o que faz a
       instalação que só tem o legado continuar enviando quando o dono cadastra
       o primeiro pixel na forma nova. */
    const token = await getFirstSecret([metaCapiTokenKey(pixel.id), SECRET_KEYS.metaCapiToken]);
    if (!token) {
      semCredencial.push(pixel.id);
      continue;
    }
    ativos.push({
      pixelId: pixel.id,
      accessToken: token,
      testEventCode: pixel.testEventCode || null,
      eventos: new Set(pixel.events),
    });
  }

  return { ativos, semCredencial };
}

interface AlvoGa4 {
  measurementId: string;
  apiSecret: string;
}

async function alvosGa4(): Promise<{ ativos: AlvoGa4[]; semCredencial: string[]; cadastrados: number }> {
  const cfg = await getSiteConfig();
  const ativos: AlvoGa4[] = [];
  const semCredencial: string[] = [];

  for (const stream of cfg.tracking.ga4.streams) {
    if (!stream.active) continue;
    const apiSecret = await getFirstSecret([ga4ApiSecretKey(stream.measurementId), SECRET_KEYS.ga4ApiSecret]);
    if (!apiSecret) {
      semCredencial.push(stream.measurementId);
      continue;
    }
    ativos.push({ measurementId: stream.measurementId, apiSecret });
  }

  return { ativos, semCredencial, cadastrados: cfg.tracking.ga4.streams.length };
}

/**
 * Uma linha de texto para a coluna que o painel já lê.
 *
 * Com um alvo só o texto continua sendo exatamente o de antes. A tela de
 * Eventos escolhe a cor do selo pelo prefixo `ok` (`tomDoEnvio`), então um
 * formato novo pintaria de vermelho evento que deu certo.
 */
function resumir(textos: string[], sucessos: number, temTeste: boolean): string {
  const total = textos.length;
  if (total === 0) return 'nao_configurado';
  if (total === 1) return textos[0] ?? '';

  const sufixo = temTeste ? ' · teste' : '';
  if (sucessos === total) return `ok (${sucessos} de ${total})${sufixo}`;

  const falhas = total - sucessos;
  return `${sucessos} de ${total} ok · ${falhas} ${falhas === 1 ? 'erro' : 'erros'}${sufixo}`;
}

/**
 * `client_id` do GA4.
 *
 * O `POST /api/track` não repassa o visitante para cá: o cookie `cv_vid` é
 * `httpOnly` e a rota o grava direto na linha do `FunnelEvent`. Em vez de
 * mudar a rota, lemos a linha recém-gravada pelo `eventId` — e só quando o
 * GA4 tem alvo, para instalação sem GA4 não pagar query nenhuma no caminho de
 * uma venda.
 */
async function clientIdDoEvento(ctx: ForwardContext): Promise<string> {
  if (ctx.visitorId) return ctx.visitorId;
  if (ctx.sessionId) return ctx.sessionId;

  const linha = await prisma.funnelEvent
    .findUnique({ where: { eventId: ctx.eventId }, select: { visitorId: true, sessionId: true } })
    .catch(() => null);

  return linha?.visitorId || linha?.sessionId || '';
}

/**
 * Manda um evento do funil para as plataformas configuradas.
 *
 * Nunca lança. O retorno é só para quem quiser logar; o efeito colateral que
 * importa é a gravação em `forwarded`.
 */
export async function forwardEvent(ctx: ForwardContext): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  try {
    const { ativos, semCredencial } = await alvosMeta();
    for (const pixelId of semCredencial) results[`meta:${pixelId}`] = 'sem_token';

    if (ativos.length === 0) {
      results.meta = 'nao_configurado';
    } else {
      /* `events` é por pixel: um pode ter `purchase` ligado e o outro não, então
         "desligado para este evento" também é por pixel. */
      const habilitados = ativos.filter((alvo) => alvo.eventos.has(ctx.event));
      for (const alvo of ativos) {
        if (!alvo.eventos.has(ctx.event)) results[`meta:${alvo.pixelId}`] = 'desligado_para_este_evento';
      }

      const metaName = toMetaEventName(ctx.event);

      if (habilitados.length === 0) {
        results.meta = 'desligado_para_este_evento';
      } else if (!metaName) {
        results.meta = 'sem_evento_equivalente';
        for (const alvo of habilitados) results[`meta:${alvo.pixelId}`] = 'sem_evento_equivalente';
      } else {
        // Uma vez só: o CPF é o mesmo para todos os pixels e descriptografar é
        // a parte cara deste caminho.
        const cpf = ctx.lead?.cpfEnc ? tryDecrypt(ctx.lead.cpfEnc) : null;
        const entrada = {
          eventName: metaName,
          eventId: ctx.eventId,
          eventTimeMs: ctx.eventTimeMs,
          eventSourceUrl: ctx.eventSourceUrl,
          referrerUrl: ctx.referrerUrl,
          user: {
            email: ctx.lead?.email,
            phone: ctx.lead?.fone,
            fullName: ctx.lead?.nome,
            cpf,
            country: 'br',
            clientIpAddress: ctx.ip,
            clientUserAgent: ctx.userAgent,
            fbp: ctx.fbp,
            fbc: ctx.fbc,
          },
          customData: ctx.customData,
        };

        /* `allSettled`, não `all`: um pixel com token vencido não pode impedir
           o envio dos outros — e é justamente o caso que acontece, porque cada
           pixel costuma viver numa conta de anúncios diferente. */
        const envios = await Promise.allSettled(
          habilitados.map((alvo): Promise<MetaResult> => sendMetaEvent(entrada, alvo)),
        );

        const textos: string[] = [];
        let sucessos = 0;

        envios.forEach((envio, i) => {
          const alvo = habilitados[i];
          if (!alvo) return;

          let texto: string;
          if (envio.status === 'fulfilled') {
            const res = envio.value;
            if (res.ok) sucessos++;
            texto = res.ok
              ? `ok${res.received ? ` (${res.received})` : ''}${alvo.testEventCode ? ' · teste' : ''}`
              : `erro: ${res.error}`;
          } else {
            texto = `falha: ${envio.reason instanceof Error ? envio.reason.message : String(envio.reason)}`;
          }

          results[`meta:${alvo.pixelId}`] = texto;
          textos.push(texto);
        });

        results.meta = resumir(textos, sucessos, habilitados.some((alvo) => Boolean(alvo.testEventCode)));
      }
    }
  } catch (err) {
    results.meta = `falha: ${err instanceof Error ? err.message : String(err)}`;
  }

  /* GA4 pelo Measurement Protocol — o servidor, não o gtag. TikTok e Kwai
     entram aqui no mesmo formato quando forem ligados.

     Sem nenhuma stream cadastrada o GA4 nem aparece em `forwarded`: plataforma
     que o dono nunca ligou não deve virar selo vermelho na tela de Eventos. */
  try {
    const { ativos, semCredencial, cadastrados } = await alvosGa4();

    if (cadastrados > 0) {
      for (const measurementId of semCredencial) results[`ga4:${measurementId}`] = 'sem_api_secret';

      const nomeGa4 = toGa4EventName(ctx.event);
      const clientId = ativos.length && nomeGa4 ? await clientIdDoEvento(ctx) : '';

      if (ativos.length === 0) {
        results.ga4 = 'nao_configurado';
      } else if (!nomeGa4) {
        results.ga4 = 'sem_evento_equivalente';
      } else if (!clientId) {
        // Sem `visitorId` nem `sessionId` o GA4 criaria um usuário novo a cada
        // evento. Inflar "usuários" com fantasma é pior do que não enviar.
        results.ga4 = 'sem_client_id';
      } else {
        const params: Record<string, unknown> = {
          ...paramsDeComercio(ctx.event, ctx.customData),
          page_location: ctx.eventSourceUrl,
          page_referrer: ctx.referrerUrl ?? '',
        };

        const envios = await Promise.allSettled(
          ativos.map(
            (alvo): Promise<Ga4Result> =>
              sendGa4Event(
                {
                  clientId,
                  eventName: nomeGa4,
                  params,
                  sessionId: ctx.sessionId ?? null,
                  eventTimeMs: ctx.eventTimeMs,
                },
                alvo,
              ),
          ),
        );

        const textos: string[] = [];
        let sucessos = 0;

        envios.forEach((envio, i) => {
          const alvo = ativos[i];
          if (!alvo) return;

          let texto: string;
          if (envio.status === 'fulfilled') {
            if (envio.value.ok) sucessos++;
            // "ok (recebido)" e não "ok": o Measurement Protocol responde 204
            // sem validar o conteúdo, então isto não é prova de aceitação.
            texto = envio.value.ok ? 'ok (recebido)' : `erro: ${envio.value.error}`;
          } else {
            texto = `falha: ${envio.reason instanceof Error ? envio.reason.message : String(envio.reason)}`;
          }

          results[`ga4:${alvo.measurementId}`] = texto;
          textos.push(texto);
        });

        results.ga4 = resumir(textos, sucessos, false);
      }
    }
  } catch (err) {
    results.ga4 = `falha: ${err instanceof Error ? err.message : String(err)}`;
  }

  /* Google Ads não sai daqui, e é desenho: a conversão do Ads entra por
     importação a partir do GA4. Ver o comentário no `trackingSchema`. */

  await prisma.funnelEvent
    .updateMany({ where: { eventId: ctx.eventId }, data: { forwarded: results } })
    .catch(() => undefined);

  return results;
}

/**
 * Purchase — o único evento que nasce exclusivamente no servidor, no momento
 * em que o pagamento é confirmado.
 *
 * Grava o próprio `FunnelEvent` porque não houve um `POST /api/track` do
 * navegador para este evento: quem paga o Pix costuma estar no app do banco,
 * não na nossa página.
 */
export async function forwardPurchase(orderId: string): Promise<Record<string, string>> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { lead: true },
  });

  if (!order || !order.purchaseEventId) return { meta: 'pedido_sem_event_id' };

  const utm = (order.utm ?? {}) as Record<string, string>;

  await prisma.funnelEvent
    .create({
      data: {
        eventId: order.purchaseEventId,
        event: 'purchase',
        orderId: order.id,
        leadId: order.leadId,
        sessionId: order.lead.sessionId,
        utm: utm,
        params: {
          value: order.amountCents / 100,
          currency: order.currency,
          order_id: order.reference,
          /* Cupom e desconto entram no `params` do evento gravado para a tela
             de eventos do painel conseguir responder "esta venda saiu com
             cupom?" sem precisar abrir o pedido. Nulos quando não houve. */
          coupon: order.couponCode,
          discount: order.discountCents / 100,
        },
        page: '/obrigado',
        ip: order.lead.ip,
        userAgent: order.lead.userAgent,
      },
    })
    .catch(() => undefined);

  return forwardEvent({
    eventId: order.purchaseEventId,
    event: 'purchase',
    eventSourceUrl: `${env.PUBLIC_URL}/obrigado`,
    ip: order.lead.ip,
    userAgent: order.lead.userAgent,
    fbp: order.lead.fbp,
    fbc: order.lead.fbc,
    /* Vêm do lead porque este evento nasce no servidor: não houve `POST
       /api/track` do navegador e, portanto, não há cookie para ler. */
    visitorId: order.lead.visitorId,
    sessionId: order.lead.sessionId,
    eventTimeMs: (order.paidAt ?? new Date()).getTime(),
    lead: {
      nome: order.lead.nome,
      email: order.lead.email,
      fone: order.lead.fone,
      cpfEnc: order.lead.cpfEnc,
    },
    customData: {
      value: order.amountCents / 100,
      currency: order.currency,
      order_id: order.reference,
      content_type: 'product',
      content_ids: ['codigo-vencedor'],
      contents: [{ id: 'codigo-vencedor', quantity: 1, item_price: order.amountCents / 100 }],
      /**
       * `value` continua sendo o que entrou no caixa, não o preço de tabela —
       * a Meta otimiza por receita, e mandar o valor cheio numa venda com
       * cupom inflaria o ROAS da campanha. O cupom vai como informação à
       * parte, que é exatamente para isso que a Meta tem o campo.
       */
      ...(order.couponCode ? { coupon: order.couponCode } : {}),
    },
  });
}

/**
 * Envia um evento de teste para validar a configuração no Events Manager.
 *
 * Com vários pixels, testar "o pixel" não quer dizer nada: o `pixelId` escolhe
 * qual. Sem ele, o primeiro ativo com token — que é o comportamento antigo
 * quando só existia um.
 */
export async function sendMetaTestEvent(pixelId?: string): Promise<{ ok: boolean; detail: string }> {
  const { ativos } = await alvosMeta();
  const meta = pixelId ? ativos.find((alvo) => alvo.pixelId === pixelId) : ativos[0];

  if (!meta) {
    return {
      ok: false,
      detail: pixelId
        ? `Nenhum pixel ativo com o id ${pixelId} e token da API de Conversões salvo.`
        : 'Cadastre um pixel ativo e o token da API de Conversões antes de testar.',
    };
  }

  const res = await sendMetaEvent(
    {
      eventName: 'PageView',
      eventId: `teste-${Date.now()}`,
      eventSourceUrl: env.PUBLIC_URL,
      user: {
        // Dado sintético, só para a chamada ter identificação válida — a doc
        // recusa evento sem nenhum parâmetro de casamento utilizável.
        email: 'teste@codigovencedor.local',
        clientUserAgent: 'CodigoVencedor/1.0 (teste de configuracao)',
        clientIpAddress: '127.0.0.1',
        country: 'br',
      },
    },
    meta,
  );

  if (res.ok) {
    return {
      ok: true,
      detail: meta.testEventCode
        ? `A Meta recebeu ${res.received ?? 1} evento no pixel ${meta.pixelId}. Confira em Events Manager › Testar eventos, com o código ${meta.testEventCode}.`
        : `A Meta recebeu ${res.received ?? 1} evento no pixel ${meta.pixelId}. Sem test_event_code preenchido, ele entra no fluxo normal em vez da aba de testes.`,
    };
  }

  return { ok: false, detail: `A Meta recusou (pixel ${meta.pixelId}): ${res.error}` };
}
