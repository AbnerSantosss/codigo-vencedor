import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num, pct, quando } from '@/lib/format';
import type { EventDetail, EventsList, EventsSummary } from '@/lib/types';
import { EVENTOS, ROTULO_EVENTO } from '@/lib/eventos';
import { Segmented } from '@/components/ui/metrics';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { JsonBlock } from '@/components/ui/json';
import { Badge, Callout, Divider, Empty, ErrorState, Loading } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { Table, TBody, TD, TH, THead, TRow } from '@/components/ui/table';
import { chaves } from '../hooks';
import { OriginBadge } from '@/components/ui/origin';

const PERIODOS = [
  { value: 1, label: '24 h' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

const DIAS_VALIDOS = [1, 7, 30];

/** Ordem fixa dos parâmetros de campanha — deixa a leitura previsível. */
const CHAVES_UTM = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'gclid',
  'fbclid',
  'ttclid',
] as const;

interface Filtros {
  dias: number;
  evento: string;
}

/**
 * Lê `#eventos?days=7&event=checkout_abandoned`.
 *
 * Tudo o que vem da barra de endereços é validado contra as listas acima: o
 * hash é editável pelo visitante e um `days=99999` viraria uma consulta de
 * varredura no banco.
 */
function lerFiltros(): Filtros {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const dias = Number(q.get('days'));
  const evento = q.get('event') ?? '';
  return {
    dias: DIAS_VALIDOS.includes(dias) ? dias : 7,
    evento: EVENTOS.some((o) => o.value === evento) ? evento : '',
  };
}

/**
 * "Android · Chrome" a partir do user-agent.
 *
 * Não é biblioteca de detecção nem tenta ser: é um rótulo de leitura para o
 * dono saber de que aparelho veio o evento. A ordem dos testes importa — o
 * user-agent do Edge contém "Chrome", e o do Chrome contém "Safari".
 */
function dispositivoDe(ua: string | null): string {
  if (!ua) return '—';
  const so = /Android/i.test(ua)
    ? 'Android'
    : /iPhone/i.test(ua)
      ? 'iPhone'
      : /iPad/i.test(ua)
        ? 'iPad'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Macintosh|Mac OS X/i.test(ua)
            ? 'Mac'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'Sistema desconhecido';
  const nav = /Edg\//i.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/i.test(ua)
      ? 'Opera'
      : /SamsungBrowser/i.test(ua)
        ? 'Samsung Internet'
        : /Firefox\//i.test(ua)
          ? 'Firefox'
          : /Chrome\//i.test(ua)
            ? 'Chrome'
            : /Safari\//i.test(ua)
              ? 'Safari'
              : 'navegador desconhecido';
  return `${so} · ${nav}`;
}

/** "ok (1)" é sucesso; qualquer outra coisa é falha ou pulo deliberado. */
function tomDoEnvio(resultado: string): 'paid' | 'neutral' | 'danger' {
  const v = resultado.toLowerCase();
  if (v.startsWith('ok')) return 'paid';
  if (v.includes('skip') || v.includes('ignorado') || v.includes('desligado')) return 'neutral';
  return 'danger';
}

/**
 * Alguma plataforma recusou este evento?
 *
 * Marca a linha na lista para o dono enxergar a falha sem abrir cada payload
 * — um evento que não chegou na CAPI é venda que o Meta nunca vai atribuir.
 */
function falhouEnvio(forwarded: Record<string, string> | null): boolean {
  return Object.values(forwarded ?? {}).some((r) => tomDoEnvio(r) === 'danger');
}

/* ------------------------------------------------------------------ *
 * Detalhe de um evento
 * ------------------------------------------------------------------ */

function Par({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-3xs font-bold tracking-wider text-muted uppercase">{rotulo}</dt>
      <dd className="mt-0.5 text-xs [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/**
 * O painel de payload de uma linha.
 *
 * Este componente só é montado quando a linha é aberta — é isso que segura o
 * `GET /events/:id` até o clique. Uma lista de 40 eventos que buscasse o
 * payload de cada um ao desenhar faria 40 chamadas para mostrar zero delas.
 * Com `staleTime: Infinity`, fechar e reabrir a mesma linha não bate no
 * servidor de novo: payload gravado não muda mais.
 */
function DetalheEvento({ id }: { id: string }) {
  const detalhe = useQuery({
    queryKey: chaves.eventDetail(id),
    queryFn: () => api<EventDetail>(`/events/${encodeURIComponent(id)}`),
    staleTime: Infinity,
  });

  if (detalhe.isPending) return <Loading label="Abrindo o payload…" />;
  if (detalhe.error) {
    if (ehSessaoExpirada(detalhe.error)) return null;
    return <ErrorState message={descreverErro(detalhe.error)} onRetry={() => void detalhe.refetch()} />;
  }

  const { event: e, payload, outboundEvent, deliveries } = detalhe.data;
  const utms = CHAVES_UTM.map((chave) => ({ chave, valor: e.utm?.[chave] })).filter(
    (par): par is { chave: (typeof CHAVES_UTM)[number]; valor: string } => Boolean(par.valor),
  );
  const enviosMeta = Object.entries(e.forwarded ?? {});

  return (
    <div className="grid gap-4">
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Par rotulo="Quando">{quando(e.createdAt)}</Par>
        <Par rotulo="Evento">
          <code className="font-mono">{e.event}</code>
          {ROTULO_EVENTO.has(e.event) ? (
            <span className="block text-2xs text-muted">{ROTULO_EVENTO.get(e.event)}</span>
          ) : null}
        </Par>
        <Par rotulo="Id do evento">
          <code className="font-mono text-2xs">{e.eventId}</code>
        </Par>
        <Par rotulo="Botão">
          {e.clickLabel ?? '—'}
          {e.cta ? <span className="block text-2xs text-muted">chave: {e.cta}</span> : null}
        </Par>
        <Par rotulo="Seção">{e.clickSection ?? '—'}</Par>
        <Par rotulo="Página">{e.page ?? '—'}</Par>
        <Par rotulo="Referrer">{e.referrer ?? 'sem referência'}</Par>
        <Par rotulo="Dispositivo">
          {dispositivoDe(e.userAgent)}
          {e.userAgent ? (
            <span className="mt-0.5 block text-3xs text-muted" title={e.userAgent}>
              {e.userAgent}
            </span>
          ) : null}
        </Par>
        <Par rotulo="Sessão">{e.sessionId ?? '—'}</Par>
        <Par rotulo="Visitante">{e.visitorId ?? '—'}</Par>
        <Par rotulo="IP">{e.ip ?? '—'}</Par>
        <Par rotulo="Lead">{e.leadId ?? '—'}</Par>
        <Par rotulo="Pedido">{e.orderId ?? '—'}</Par>
        <Par rotulo="Origem">
          <OriginBadge source={e.utm?.utm_source} />
        </Par>
      </dl>

      <div>
        <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">
          Atribuição de campanha
        </h4>
        {utms.length === 0 ? (
          <p className="text-xs text-muted">
            Nenhum parâmetro de campanha neste evento — visita direta ou link sem UTM.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {utms.map((par) => (
              <li
                key={par.chave}
                className="min-w-0 rounded-sm border border-line bg-bg px-2.5 py-1.5 text-2xs [overflow-wrap:anywhere]"
              >
                <span className="text-muted">{par.chave}</span>{' '}
                <span className="font-mono font-semibold">{par.valor}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">
          Envio para as plataformas
        </h4>
        {enviosMeta.length === 0 ? (
          <p className="text-xs text-muted">
            Nada foi enviado para plataforma nenhuma a partir deste evento.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {enviosMeta.map(([plataforma, resultado]) => (
              <Badge key={plataforma} tom={tomDoEnvio(resultado)}>
                {plataforma}: {resultado}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Divider className="my-1" />

      <div>
        <h4 className="mb-2 text-3xs font-bold tracking-wider text-muted uppercase">
          Payload — o corpo exato que vai no webhook
        </h4>
        <JsonBlock
          value={payload}
          label={`Payload do evento ${e.event}`}
          copyLabel="Copiar payload"
          copyMessage="Payload copiado"
        />
      </div>

      {outboundEvent ? (
        <div>
          <p className="mb-2 text-xs">
            Sai nos webhooks como <code className="font-mono font-semibold">{outboundEvent}</code>.
          </p>
          {deliveries.length === 0 ? (
            <p className="text-xs text-muted">
              Nenhuma entrega registrada — não há webhook ativo assinando este evento.
            </p>
          ) : (
            <Table stackBelow="sm" caption="Entregas deste evento nos webhooks">
              <THead>
                <TRow>
                  <TH>Webhook</TH>
                  <TH num>HTTP</TH>
                  <TH num>Tentativa</TH>
                  <TH>Quando</TH>
                </TRow>
              </THead>
              <TBody>
                {deliveries.map((d) => (
                  <TRow key={d.id}>
                    <TD label="Webhook">{d.webhookName}</TD>
                    <TD num label="HTTP">
                      <Badge tom={d.deliveredAt ? 'paid' : 'danger'}>
                        {d.statusCode ?? 'sem resposta'}
                      </Badge>
                    </TD>
                    <TD num label="Tentativa">
                      {d.attempt}
                    </TD>
                    <TD muted label="Quando">
                      {quando(d.deliveredAt ?? d.createdAt)}
                    </TD>
                  </TRow>
                ))}
              </TBody>
            </Table>
          )}
        </div>
      ) : (
        <Callout tom="info">
          Este evento <strong>não vai para webhook</strong>. <code>page_view</code>,{' '}
          <code>view_content</code>, <code>select_promotion</code> e <code>click</code> ficam de fora
          por volume: são milhares por dia e afogariam o destino sem acrescentar nada sobre a venda.
          O payload acima continua sendo o que seria enviado, se um dia entrar.
        </Callout>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tela
 * ------------------------------------------------------------------ */

export function TelaEventos() {
  const [filtros, setFiltros] = useState<Filtros>(lerFiltros);
  const [aberto, setAberto] = useState<string | null>(null);
  const idSelect = useId();

  /* Os cartões do dashboard levam para `#eventos?days=7&event=page_view`
     com a tela já montada. Trocar só a query do hash não remonta o
     componente, então o `useState` inicial não veria a mudança — quem
     sincroniza é este ouvinte. */
  useEffect(() => {
    const aoTrocarHash = (): void => {
      setFiltros(lerFiltros());
      setAberto(null);
    };
    window.addEventListener('hashchange', aoTrocarHash);
    return () => window.removeEventListener('hashchange', aoTrocarHash);
  }, []);

  /* O caminho inverso: mexer nos controles reescreve o hash, e aí o filtro
     aplicado é copiável da barra de endereços. `replaceState` de propósito —
     `location.hash = …` empilharia uma entrada de histórico por clique e o
     botão "voltar" viraria "desfazer filtro" trinta vezes antes de sair da
     tela. Ele também não dispara `hashchange`, então não briga com o ouvinte
     acima. */
  useEffect(() => {
    const q = new URLSearchParams({ days: String(filtros.dias) });
    if (filtros.evento) q.set('event', filtros.evento);
    history.replaceState(null, '', `${location.pathname}${location.search}#eventos?${q.toString()}`);
  }, [filtros]);

  const aplicar = useCallback((mudanca: Partial<Filtros>) => {
    setFiltros((atual) => ({ ...atual, ...mudanca }));
    /* Fecha o payload aberto: a linha some quando a lista é refeita, e um
       painel expandido apontando para um id que não está mais na tela é
       confusão garantida. */
    setAberto(null);
  }, []);

  const resumo = useQuery({
    queryKey: chaves.eventsSummary(filtros.dias),
    queryFn: () => api<EventsSummary>(`/events/summary?days=${filtros.dias}`),
  });

  /**
   * A lista paginada pelo cursor que o servidor já devolvia e a tela ignorava.
   *
   * `useInfiniteQuery` em vez de acumular páginas na mão porque ele guarda o
   * acumulado no cache da chave: trocar de tela e voltar mostra tudo o que já
   * tinha sido carregado, sem refazer as chamadas.
   */
  const lista = useInfiniteQuery({
    queryKey: chaves.events(filtros.dias, filtros.evento || null),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ days: String(filtros.dias), limit: '40' });
      if (filtros.evento) q.set('event', filtros.evento);
      if (pageParam) q.set('cursor', pageParam);
      return api<EventsList>(`/events?${q.toString()}`);
    },
    getNextPageParam: (ultima) => ultima.nextCursor,
  });

  if (resumo.isPending) return <Loading />;
  if (resumo.error) {
    if (ehSessaoExpirada(resumo.error)) return null;
    return <ErrorState message={descreverErro(resumo.error)} onRetry={() => void resumo.refetch()} />;
  }

  const s = resumo.data;
  const itens = lista.data?.pages.flatMap((p) => p.items) ?? [];
  const rotuloFiltro = filtros.evento ? (ROTULO_EVENTO.get(filtros.evento) ?? filtros.evento) : null;

  return (
    <>
      {/* No celular o seletor de evento ocupa a linha inteira e o período
          vem embaixo; a partir de `sm` os dois dividem a mesma linha à
          direita. Nada de barra de filtros rolando para o lado. */}
      <div className="mb-5 flex flex-wrap items-end gap-3 sm:justify-end">
        <Field label="Evento" htmlFor={idSelect} className="w-full sm:w-60">
          <Select
            id={idSelect}
            value={filtros.evento}
            onChange={(ev) => aplicar({ evento: ev.target.value })}
          >
            {EVENTOS.map((o) => (
              <option key={o.value || 'todos'} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Segmented
          value={filtros.dias}
          options={PERIODOS}
          onChange={(v) => aplicar({ dias: v })}
          label="Período"
        />
      </div>

      <Surface as="section" className="mb-5">
        <SurfaceHeader
          title="Funil"
          hint="Sessões conta pessoas distintas; eventos conta disparos. A porcentagem é sobre as visitas do período — uma pessoa que recarrega a página cinco vezes é uma visita, não cinco."
        />
        <Table sticky stackBelow="sm" caption="Funil do período">
          <THead>
            <TRow>
              <TH>Etapa</TH>
              <TH num>Sessões</TH>
              <TH num>Eventos</TH>
              <TH num>% das visitas</TH>
            </TRow>
          </THead>
          <TBody>
            {s.funnel.map((step) => (
              <TRow key={step.event}>
                <TD label="Etapa">{step.label}</TD>
                <TD num label="Sessões">
                  {num(step.uniques)}
                </TD>
                <TD num muted label="Eventos">
                  {num(step.total)}
                </TD>
                <TD num label="% das visitas">
                  {pct(step.rate)}
                </TD>
              </TRow>
            ))}
          </TBody>
        </Table>
      </Surface>

      <Surface as="section" className="mb-5">
        <SurfaceHeader title="Origem do tráfego" hint="Sessões distintas que abriram a página, por utm_source." />
        {s.sources.length === 0 ? (
          <Empty>Nenhuma visita registrada no período.</Empty>
        ) : (
          <Table sticky stackBelow="sm" caption="Sessões por origem">
            <THead>
              <TRow>
                <TH>Origem</TH>
                <TH num>Sessões</TH>
              </TRow>
            </THead>
            <TBody>
              {s.sources.map((src) => (
                <TRow key={src.source}>
                  <TD label="Origem">
                    <OriginBadge source={src.source} />
                  </TD>
                  <TD num label="Sessões">
                    {num(src.sessions)}
                  </TD>
                </TRow>
              ))}
            </TBody>
          </Table>
        )}
      </Surface>

      <Surface as="section" className="mb-5">
        <SurfaceHeader
          title="Últimos eventos"
          hint="Abra a seta de uma linha para ver o payload inteiro — de onde veio, campanha, UTMs, IP, aparelho — exatamente como sai no webhook. A sessão aparece cortada de propósito: é tela de depuração, não de identificar visitante."
          action={
            <span className="text-xs text-muted">
              {rotuloFiltro ? `filtrando: ${rotuloFiltro} · ` : ''}
              {num(itens.length)} carregados
            </span>
          }
        />
        {lista.isPending ? (
          <Loading label="Buscando os últimos disparos…" />
        ) : lista.error ? (
          <ErrorState message={descreverErro(lista.error)} onRetry={() => void lista.refetch()} />
        ) : itens.length === 0 ? (
          <Empty>
            {rotuloFiltro
              ? `Nenhum evento "${rotuloFiltro}" no período. Troque o filtro ou aumente o intervalo.`
              : 'Nenhum evento ainda. Abra a landing page para gerar o primeiro.'}
          </Empty>
        ) : (
          <>
            {/* Sem zebra: a linha do payload aberto entra na contagem de
                `nth-child` e desalinharia as faixas; o destaque aqui é o
                `selected` da linha aberta. */}
            <Table sticky stackBelow="sm" caption="Últimos eventos registrados">
              <THead>
                <TRow>
                  <TH>Quando</TH>
                  <TH>Evento</TH>
                  <TH>Onde clicou</TH>
                  <TH>Página</TH>
                  <TH>Origem</TH>
                  <TH>Sessão</TH>
                  <TH>
                    <span className="sr-only">Payload</span>
                  </TH>
                </TRow>
              </THead>
              <TBody zebra={false}>
                {itens.map((i) => {
                  const expandido = aberto === i.id;
                  const idPainel = `evento-payload-${i.id}`;
                  return (
                    <Fragment key={i.id}>
                      <TRow selected={expandido}>
                        <TD muted label="Quando">
                          {quando(i.createdAt)}
                        </TD>
                        <TD label="Evento">
                          <code className="text-xs">{i.event}</code>
                          {ROTULO_EVENTO.has(i.event) ? (
                            <span className="block text-2xs text-muted">
                              {ROTULO_EVENTO.get(i.event)}
                            </span>
                          ) : null}
                          {falhouEnvio(i.forwarded) ? (
                            <Badge tom="danger" className="mt-1">envio falhou</Badge>
                          ) : null}
                        </TD>
                        {/* Responde "onde foi que o lead clicou" sem sair
                            da lista. Vazio na maioria das linhas de
                            propósito: só clique tem botão e seção. */}
                        <TD label="Onde clicou">
                          {i.clickLabel ?? i.cta ?? '—'}
                          {i.clickSection ? (
                            <span className="block text-2xs text-muted">{i.clickSection}</span>
                          ) : null}
                        </TD>
                        <TD muted label="Página">
                          {i.page ?? '—'}
                        </TD>
                        <TD label="Origem">
                          <OriginBadge source={i.utm?.utm_source} />
                          {!i.utm?.utm_source && i.referrer ? (
                            <span className="block text-2xs text-muted" title={i.referrer}>
                              Referência disponível · sem UTM
                            </span>
                          ) : null}
                        </TD>
                        <TD muted label="Sessão">
                          {i.sessionId ?? '—'}
                        </TD>
                        <TD label="Payload" className="w-px pr-0 text-right">
                          {/* `<button>` de verdade: Enter, espaço e foco
                              vêm de graça. Um `<div onClick>` aqui seria
                              invisível para quem navega por teclado. */}
                          <button
                            type="button"
                            onClick={() => setAberto(expandido ? null : i.id)}
                            aria-expanded={expandido}
                            aria-controls={idPainel}
                            className="grid size-11 place-items-center rounded-sm text-muted hover:bg-surface-3 hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                          >
                            <span className="sr-only">
                              {expandido ? 'Ocultar payload do evento' : 'Ver payload do evento'}
                            </span>
                            <ChevronDown
                              className={cn('size-4 transition-transform', expandido && 'rotate-180')}
                              aria-hidden
                            />
                          </button>
                        </TD>
                      </TRow>
                      {expandido ? (
                        <tr id={idPainel}>
                          <td colSpan={7} className="border-b border-line bg-surface-2 p-0">
                            {/* No desktop a tabela é mais larga que a tela
                                e rola dentro do invólucro: `sticky left-0`
                                prende o painel na borda visível, e a
                                largura fica no menor entre a célula e a
                                janela — sem isso o detalhe nasceria fora
                                da área visível, à direita. Abaixo de `sm`
                                a célula vira grade de duas colunas
                                (`.cv-table-stack`): `col-span-2` faz o
                                painel ocupar a linha inteira em vez de
                                espremer-se na coluna do valor. */}
                            <div className="sticky left-0 col-span-2 w-[min(100%,calc(100vw-3rem))] min-w-0 p-3 sm:p-4">
                              <DetalheEvento id={i.id} />
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TBody>
            </Table>

            {lista.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="ghost"
                  onClick={() => void lista.fetchNextPage()}
                  loading={lista.isFetchingNextPage}
                >
                  Carregar mais eventos
                </Button>
              </div>
            ) : (
              <p className="mt-4 text-center text-2xs text-muted">
                Fim da lista — {num(itens.length)} eventos no período.
              </p>
            )}
          </>
        )}
      </Surface>
    </>
  );
}
