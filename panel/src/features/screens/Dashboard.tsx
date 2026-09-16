import { useState } from 'react';
import {
  Wallet,
  BadgeCheck,
  MousePointerClick,
  UserRoundX,
  Eye,
  ShoppingCart,
  QrCode,
  TimerOff,
} from 'lucide-react';
import { DashboardCustomers } from './DashboardCustomers';
import { OriginBadge } from '@/components/ui/origin';
import { useQueries } from '@tanstack/react-query';
import { api, descreverErro, ehSessaoExpirada } from '@/lib/api';
import { brl, num, pct, quando } from '@/lib/format';
import type {
  DailySeries,
  EventsSummary,
  MetricsSummary,
  OrderStatus,
  RecentOrder,
  SourcesResponse,
} from '@/lib/types';
import { CaixaGrafico, GraficoReceita } from '@/components/charts/Charts';
import { Badge, Empty, ErrorState, Loading } from '@/components/ui/layout';
import { Surface, SurfaceHeader } from '@/components/ui/surface';
import { StatCard, type StatTone } from '@/components/ui/stat-card';
import { Table, THead, TBody, TRow, TH, TD } from '@/components/ui/table';
import { Funnel, Segmented } from '@/components/ui/metrics';

const PERIODOS = [
  { value: 1, label: '24 horas' },
  { value: 7, label: '7 dias' },
  { value: 30, label: '30 dias' },
];

const STATUS: Record<OrderStatus, { label: string; tom: 'paid' | 'pending' | 'neutral' | 'danger' }> = {
  paid: { label: 'Pago', tom: 'paid' },
  pending: { label: 'Pendente', tom: 'pending' },
  expired: { label: 'Expirado', tom: 'neutral' },
  refunded: { label: 'Estornado', tom: 'danger' },
  failed: { label: 'Falhou', tom: 'danger' },
};

/** "12,3%" ou "estável" — o texto que acompanha a seta do indicador. */
function textoDelta(valor: number | null | undefined, sufixo: string): string {
  if (valor === null || valor === undefined) return 'sem base de comparação';
  if (valor === 0) return 'estável';
  return `${Math.abs(valor).toLocaleString('pt-BR')}${sufixo} vs. período anterior`;
}

/**
 * Cartão de indicador que abre um diálogo em vez de navegar.
 *
 * O `StatCard` vira link quando recebe `href`; aqui a ação é abrir a lista
 * de clientes, então o cartão inteiro fica dentro de um `<button>` de
 * largura cheia. O texto da ação vai na nota para o leitor de tela e para
 * quem não usa ponteiro saberem o que o toque faz.
 */
function CartaoAcao({ onClick, children, rotulo }: { onClick: () => void; children: React.ReactNode; rotulo: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={rotulo}
      className="block w-full min-w-0 rounded-lg text-left text-inherit transition-colors [&>*]:h-full [&>*]:transition-colors hover:[&>*]:border-accent"
    >
      {children}
    </button>
  );
}

/**
 * Um cartão da faixa "Funil do site".
 *
 * `valor: undefined` é o caso real de o servidor ainda não mandar a chave
 * `funnel` — a faixa mostra um traço e o resto do dashboard segue de pé.
 */
interface CartaoFunil {
  /** Nome técnico do evento — é o filtro que o cartão abre em `#eventos`. */
  evento: string;
  rotulo: string;
  tone: StatTone;
  Icone: typeof Eye;
  valor: number | undefined;
  nota: string | null;
  /** Variação absoluta; `null` quando ela já está na nota. */
  delta: number | null | undefined;
  /** Subir é bom (visualizações) ou ruim (abandono)? Decide a cor da seta. */
  subirEhBom: boolean;
}

export function TelaDashboard() {
  const [dias, setDias] = useState(1);
  const [list, setList] = useState<'paid' | 'abandoned' | null>(null);

  /**
   * As cinco chamadas do dashboard em paralelo.
   *
   * Foi este disparo simultâneo que revelou o pior defeito do painel: com
   * cinco 401 ao mesmo tempo, o refresh concorrente destruía a sessão de 7
   * dias. Continua paralelo — o que mudou é que agora existe um refresh só,
   * compartilhado (`lib/api.ts`).
   */
  const [resumo, diario, origens, recentes, funil] = useQueries({
    queries: [
      { queryKey: ['metrics', 'summary', dias], queryFn: () => api<MetricsSummary>(`/metrics/summary?days=${dias}`) },
      { queryKey: ['metrics', 'daily', dias], queryFn: () => api<DailySeries>(`/metrics/daily?days=${dias}`) },
      { queryKey: ['metrics', 'sources', dias], queryFn: () => api<SourcesResponse>(`/metrics/sources?days=${dias}`) },
      {
        queryKey: ['metrics', 'recent'],
        queryFn: () => api<{ orders: RecentOrder[] }>('/metrics/recent-orders?limit=8'),
      },
      { queryKey: ['events', 'summary', dias], queryFn: () => api<EventsSummary>(`/events/summary?days=${dias}`) },
    ],
  });

  const erro = [resumo, diario, origens, recentes, funil].find((q) => q.error)?.error;
  if (erro && !ehSessaoExpirada(erro)) {
    return (
      <ErrorState
        message={descreverErro(erro)}
        onRetry={() => {
          void resumo.refetch();
          void diario.refetch();
          void origens.refetch();
          void recentes.refetch();
          void funil.refetch();
        }}
      />
    );
  }

  if (!resumo.data || !diario.data || !origens.data || !recentes.data || !funil.data) {
    return <Loading label="Somando as vendas…" />;
  }

  const s = resumo.data;
  const temReceita = diario.data.series.some((p) => p.revenueCents > 0);
  const temOrigem = origens.data.sources.length > 0;
  const totalOrigens = Math.max(1, origens.data.total);

  /**
   * A última etapa do funil vem da tabela de pedidos, não da de eventos.
   *
   * O evento `purchase` só existe quando o servidor consegue gravá-lo; o
   * pedido pago existe sempre. Ler duas fontes diferentes fazia o funil
   * dizer "Pagaram: 0" ao lado de um cartão marcando 53 vendas.
   */
  const etapas = funil.data.funnel.map((e) =>
    e.event === 'purchase' ? { ...e, uniques: s.paidOrders.value, total: s.paidOrders.value } : e,
  );
  const maiorEtapa = Math.max(1, ...etapas.map((e) => e.uniques));

  /**
   * Os cinco indicadores que o dono pediu por nome: visualizações de página,
   * checkouts abertos, checkout abandonado, Pix gerado e Pix abandonado.
   *
   * Ficam numa faixa própria, abaixo — e não no meio — dos quatro cartões de
   * dinheiro. Receita, pedidos pagos, conversão e abandono respondem "quanto
   * entrou"; estes respondem "onde a página perde gente", que é outra
   * pergunta e merece outro bloco.
   *
   * `f` vem opcional do servidor (ver `MetricsSummary.funnel`): quando não
   * chega, cada cartão mostra um traço em vez de derrubar o dashboard.
   */
  const f = s.funnel;
  const cartoesFunil: CartaoFunil[] = [
    {
      evento: 'page_view',
      rotulo: 'Visualizações de página',
      tone: 'info',
      Icone: Eye,
      valor: f?.pageViews.total,
      nota: f ? `${num(f.pageViews.sessions)} sessões distintas` : null,
      delta: f?.pageViews.deltaAbs,
      subirEhBom: true,
    },
    {
      evento: 'begin_checkout',
      rotulo: 'Checkouts abertos',
      tone: 'ok',
      Icone: ShoppingCart,
      valor: f?.checkoutsOpened.total,
      nota: f ? `${num(f.checkoutsOpened.sessions)} sessões distintas` : null,
      delta: f?.checkoutsOpened.deltaAbs,
      subirEhBom: true,
    },
    {
      evento: 'checkout_abandoned',
      rotulo: 'Checkout abandonado',
      tone: 'warn',
      Icone: UserRoundX,
      valor: f?.checkoutsAbandoned.value,
      nota: f ? `${num(f.checkoutsAbandoned.recovered)} recuperados depois` : null,
      delta: f?.checkoutsAbandoned.deltaAbs,
      subirEhBom: false,
    },
    {
      evento: 'add_payment_info',
      rotulo: 'Pix gerado',
      tone: 'accent',
      Icone: QrCode,
      valor: f?.pixCreated.value,
      nota: null,
      delta: f?.pixCreated.deltaAbs,
      subirEhBom: true,
    },
    {
      evento: 'pix_abandoned',
      rotulo: 'Pix abandonado',
      tone: 'danger',
      Icone: TimerOff,
      valor: f?.pixAbandoned.value,
      nota: null,
      delta: f?.pixAbandoned.deltaAbs,
      subirEhBom: false,
    },
  ];

  const abandonos = s.abandon.drafts + s.abandon.expiredOrders;

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p className="mb-2 text-3xs font-extrabold tracking-[.15em] text-accent uppercase">Visão da operação</p>
          <h2 className="text-xl font-extrabold tracking-tight sm:text-2xl">Visão geral de vendas.</h2>
          <p className="mt-2 text-sm text-muted">Confira as vendas e encontre os clientes que precisam de atenção.</p>
        </div>
        <div className="shrink-0">
          <Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período do dashboard" />
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 sm:gap-4">
        <CartaoAcao rotulo="Receita líquida — ver pedidos pagos" onClick={() => setList('paid')}>
          <StatCard
            label="Receita líquida"
            value={brl(s.revenue.cents)}
            icon={<Wallet />}
            tone="accent"
            note={`Ticket médio ${brl(s.averageTicketCents)} · Ver pedidos pagos`}
          />
        </CartaoAcao>
        <CartaoAcao rotulo="Pedidos pagos — ver clientes e pagamentos" onClick={() => setList('paid')}>
          <StatCard
            label="Pedidos pagos"
            value={num(s.paidOrders.value)}
            icon={<BadgeCheck />}
            tone="ok"
            delta={s.paidOrders.deltaAbs}
            deltaText={textoDelta(s.paidOrders.deltaAbs, '')}
            note="Ver clientes e pagamentos"
          />
        </CartaoAcao>
        <StatCard
          label="Conversão"
          value={pct(s.conversion.pct, 2)}
          icon={<MousePointerClick />}
          tone="info"
          href={`#eventos?days=${dias}`}
          note={`${num(s.visits.value)} sessões no período · Explorar eventos`}
        />
        <CartaoAcao rotulo="Abandonos — ver clientes para contato" onClick={() => setList('abandoned')}>
          <StatCard
            label="Abandonos"
            value={num(abandonos)}
            icon={<UserRoundX />}
            tone="warn"
            note={`${num(s.abandon.drafts)} checkouts · ${num(s.abandon.expiredOrders)} Pix expirados · Ver clientes para contato`}
          />
        </CartaoAcao>
      </div>

      <section className="mb-5" aria-labelledby="dashboard-funil-titulo">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
          <h3 id="dashboard-funil-titulo" className="text-3xs font-extrabold tracking-[.15em] text-accent uppercase">
            Funil do site
          </h3>
          <span className="text-3xs text-muted sm:text-2xs">
            Contagem do rastreamento no período — cada cartão abre a lista de eventos já filtrada.
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3 xl:grid-cols-5">
          {cartoesFunil.map(({ evento, rotulo, tone, Icone, valor, nota, delta, subirEhBom }) => (
            // `href` e não botão, como o cartão de Conversão: leva para outra
            // tela, então precisa abrir em nova aba, ser copiável e aparecer
            // como link para o leitor de tela.
            <StatCard
              key={evento}
              size="sm"
              label={rotulo}
              value={valor === undefined ? '—' : num(valor)}
              icon={<Icone />}
              tone={tone}
              href={`#eventos?days=${dias}&event=${evento}`}
              // Quando subir é ruim (abandono), a seta não ganha cor: a
              // variação vem no texto, sem o verde de "deu certo".
              delta={subirEhBom ? delta : null}
              deltaText={f ? textoDelta(delta, '') : undefined}
              note={nota ?? (f ? undefined : 'aguardando o servidor')}
            />
          ))}
        </div>
      </section>

      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Surface as="section">
          <SurfaceHeader
            title="Receita por dia"
            action={
              <span className="text-xs text-muted">
                {dias === 1 ? 'últimas 24 horas' : `últimos ${dias} dias`} · total {brl(s.revenue.cents)}
              </span>
            }
          />
          {temReceita ? (
            <CaixaGrafico altura="15rem">
              <GraficoReceita series={diario.data.series} />
            </CaixaGrafico>
          ) : (
            <Empty>Nenhuma venda no período. O gráfico aparece com o primeiro pedido pago.</Empty>
          )}
        </Surface>

        <Surface as="section">
          <SurfaceHeader
            title="De onde vêm as visitas"
            action={<span className="text-xs text-muted">{num(origens.data.total)} sessões</span>}
          />
          {temOrigem ? (
            <div className="grid gap-4">
              {origens.data.sources.map((source) => {
                const parte = Math.max(0, Math.min(100, (source.sessions / totalOrigens) * 100));
                return (
                  <div key={source.source}>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <OriginBadge source={source.source} />
                      <strong className="text-sm whitespace-nowrap tabular">
                        {num(source.sessions)} <small className="text-3xs font-normal text-muted">sessões</small>
                      </strong>
                    </div>
                    {/* Largura por prop `style` (CSSOM) — permitida pela CSP. */}
                    <div
                      role="progressbar"
                      aria-label={`Sessões de ${source.source}`}
                      aria-valuemin={0}
                      aria-valuemax={totalOrigens}
                      aria-valuenow={source.sessions}
                      className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
                    >
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${parte}%` }} />
                    </div>
                  </div>
                );
              })}
              <p className="text-xs text-muted">
                Origem registrada nos links de campanha. Quando não há identificação, exibimos direto / sem origem.
              </p>
            </div>
          ) : (
            <Empty>Ainda sem visitas registradas no período.</Empty>
          )}
        </Surface>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Surface as="section">
          <SurfaceHeader
            title="Funil"
            hint="Sessões distintas em cada etapa. A queda entre elas é onde a página perde gente."
          />
          <Funnel
            steps={etapas.map((e) => ({
              label: e.label,
              value: e.uniques,
              pct: Math.max(e.uniques > 0 ? 1.5 : 0, (e.uniques / maiorEtapa) * 100),
            }))}
          />
        </Surface>

        <Surface as="section">
          <SurfaceHeader
            title="Últimos pedidos"
            action={<span className="text-xs text-muted">{num(recentes.data.orders.length)} exibidos</span>}
          />
          {recentes.data.orders.length === 0 ? (
            <Empty>Nenhum pedido ainda.</Empty>
          ) : (
            <Table stackBelow="sm" caption="Últimos pedidos recebidos">
              <THead>
                <tr>
                  <TH>Quando</TH>
                  <TH>Cliente</TH>
                  <TH>Origem</TH>
                  <TH num>Valor</TH>
                  <TH num>Status</TH>
                </tr>
              </THead>
              <TBody>
                {recentes.data.orders.map((o) => {
                  const st = STATUS[o.status];
                  return (
                    <TRow key={o.publicId}>
                      <TD muted label="Quando">{quando(o.createdAt)}</TD>
                      <TD label="Cliente">
                        {o.customer}
                        {/* E-mail mascarado pelo servidor: o dashboard não é
                            lugar de listar dado pessoal por inteiro. */}
                        <span className="block text-2xs text-muted">{o.email}</span>
                      </TD>
                      <TD label="Origem"><OriginBadge source={o.source} /></TD>
                      <TD num label="Valor">{brl(o.amountCents)}</TD>
                      <TD num label="Status">
                        <Badge tom={st.tom}>{st.label}</Badge>
                      </TD>
                    </TRow>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Surface>
      </div>
      {list ? <DashboardCustomers key={`${list}-${dias}`} mode={list} days={dias} drafts={s.abandon.drafts} expired={s.abandon.expiredOrders} onClose={() => setList(null)} /> : null}
    </div>
  );
}
