import { Fragment, useCallback, useEffect, useId, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { cn } from '@/lib/cn';
import { num, pct, quando } from '@/lib/format';
import type { EventDetail, EventsList, EventsSummary } from '@/lib/types';
import { Segmented } from '@/components/ui/metrics';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/form';
import { JsonBlock } from '@/components/ui/json';
import {
  Badge,
  Callout,
  Card,
  CardTitle,
  Divider,
  Empty,
  ErrorState,
  Loading,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { chaves } from '../hooks';
import { OriginBadge } from '@/components/ui/origin';

const PERIODOS = [
  { value: 1, label: '24 h' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

const DIAS_VALIDOS = [1, 7, 30];

/**
 * Os eventos que a landing dispara, com rótulo em português.
 *
 * O rótulo é para o dono e o valor técnico continua visível no `<code>` da
 * coluna Evento — quem configura o GTM precisa do nome exato, e quem lê o
 * dashboard precisa saber o que "add_payment_info" significa. Mostrar só um
 * dos dois deixaria sempre alguém sem informação.
 */
const EVENTOS: { value: string; label: string }[] = [
  { value: '', label: 'Todos os eventos' },
  { value: 'page_view', label: 'Visualização de página' },
  { value: 'view_content', label: 'Viu o conteúdo' },
  { value: 'select_promotion', label: 'Viu a oferta' },
  { value: 'click', label: 'Clique' },
  { value: 'begin_checkout', label: 'Checkout aberto' },
  { value: 'checkout_abandoned', label: 'Checkout abandonado' },
  { value: 'generate_lead', label: 'Lead gerado' },
  { value: 'add_payment_info', label: 'Pix gerado' },
  { value: 'pix_abandoned', label: 'Pix abandonado' },
  { value: 'purchase', label: 'Compra' },
];

const ROTULO_EVENTO = new Map(EVENTOS.filter((e) => e.value).map((e) => [e.value, e.label]));

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
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Webhook</Th>
                    <Th num>HTTP</Th>
                    <Th num>Tentativa</Th>
                    <Th>Quando</Th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id}>
                      <Td>{d.webhookName}</Td>
                      <Td num>
                        <Badge tom={d.deliveredAt ? 'paid' : 'danger'}>
                          {d.statusCode ?? 'sem resposta'}
                        </Badge>
                      </Td>
                      <Td num>{d.attempt}</Td>
                      <Td muted>{quando(d.deliveredAt ?? d.createdAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
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

      <Card wide>
        <CardTitle
          title="Funil"
          hint="Sessões conta pessoas distintas; eventos conta disparos. A porcentagem é sobre as visitas do período — uma pessoa que recarrega a página cinco vezes é uma visita, não cinco."
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Etapa</Th>
                <Th num>Sessões</Th>
                <Th num>Eventos</Th>
                <Th num>% das visitas</Th>
              </tr>
            </thead>
            <tbody>
              {s.funnel.map((step) => (
                <tr key={step.event}>
                  <Td>{step.label}</Td>
                  <Td num>{num(step.uniques)}</Td>
                  <Td num muted>
                    {num(step.total)}
                  </Td>
                  <Td num>{pct(step.rate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Card wide>
        <CardTitle title="Origem do tráfego" hint="Sessões distintas que abriram a página, por utm_source." />
        {s.sources.length === 0 ? (
          <Empty>Nenhuma visita registrada no período.</Empty>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Origem</Th>
                  <Th num>Sessões</Th>
                </tr>
              </thead>
              <tbody>
                {s.sources.map((src) => (
                  <tr key={src.source}>
                    <Td><OriginBadge source={src.source} /></Td>
                    <Td num>{num(src.sessions)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      <Card wide>
        <CardTitle
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
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Quando</Th>
                    <Th>Evento</Th>
                    <Th>Página</Th>
                    <Th>Origem</Th>
                    <Th>Sessão</Th>
                    <Th>
                      <span className="sr-only">Payload</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((i) => {
                    const expandido = aberto === i.id;
                    const idPainel = `evento-payload-${i.id}`;
                    return (
                      <Fragment key={i.id}>
                        <tr className={expandido ? 'bg-surface-2' : undefined}>
                          <Td muted>{quando(i.createdAt)}</Td>
                          <Td>
                            <code className="text-xs">{i.event}</code>
                            {ROTULO_EVENTO.has(i.event) ? (
                              <span className="block text-2xs text-muted">
                                {ROTULO_EVENTO.get(i.event)}
                              </span>
                            ) : null}
                            {falhouEnvio(i.forwarded) ? (
                              <Badge tom="danger" className="mt-1">envio falhou</Badge>
                            ) : null}
                          </Td>
                          <Td muted>{i.page ?? '—'}</Td>
                          <Td>
                            <OriginBadge source={i.utm?.utm_source} />
                            {!i.utm?.utm_source && i.referrer ? (
                              <span className="block text-2xs text-muted" title={i.referrer}>
                                Referência disponível · sem UTM
                              </span>
                            ) : null}
                          </Td>
                          <Td muted>{i.sessionId ?? '—'}</Td>
                          <Td className="w-px pr-0 text-right">
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
                          </Td>
                        </tr>
                        {expandido ? (
                          <tr id={idPainel}>
                            <td colSpan={6} className="border-b border-line bg-surface-2 p-0">
                              {/* A tabela é mais larga que a tela no celular
                                  e rola dentro do `TableWrap`. `sticky
                                  left-0` prende o painel na borda visível,
                                  e a largura fica no menor entre a célula e
                                  a janela — sem isso o detalhe nasceria
                                  fora da área visível, à direita. */}
                              <div className="sticky left-0 w-[min(100%,calc(100vw-3rem))] min-w-0 p-3 sm:p-4">
                                <DetalheEvento id={i.id} />
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>

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
      </Card>
    </>
  );
}
