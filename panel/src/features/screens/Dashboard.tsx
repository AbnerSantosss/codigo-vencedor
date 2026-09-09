import { useState } from 'react';
import {
  ArrowUpRight,
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
import {
  Badge,
  Card,
  CardTitle,
  Empty,
  ErrorState,
  Loading,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
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
 * Um cartão da faixa "Funil do site".
 *
 * `valor: undefined` é o caso real de o servidor ainda não mandar a chave
 * `funnel` — a faixa desenha o esqueleto e o resto do dashboard segue de pé.
 */
interface CartaoFunil {
  /** Nome técnico do evento — é o filtro que o cartão abre em `#eventos`. */
  evento: string;
  rotulo: string;
  cor: string;
  Icone: typeof Eye;
  valor: number | undefined;
  nota: string | null;
  /** Segunda linha, quando a nota principal já é outra coisa. */
  delta: string | null;
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
   * chega, cada cartão vira esqueleto em vez de derrubar o dashboard.
   */
  const f = s.funnel;
  const cartoesFunil: CartaoFunil[] = [
    {
      evento: 'page_view',
      rotulo: 'Visualizações de página',
      cor: 'stat-pageviews',
      Icone: Eye,
      valor: f?.pageViews.total,
      nota: f ? `${num(f.pageViews.sessions)} sessões distintas` : null,
      delta: f ? textoDelta(f.pageViews.deltaAbs, '') : null,
    },
    {
      evento: 'begin_checkout',
      rotulo: 'Checkouts abertos',
      cor: 'stat-checkouts',
      Icone: ShoppingCart,
      valor: f?.checkoutsOpened.total,
      nota: f ? `${num(f.checkoutsOpened.sessions)} sessões distintas` : null,
      delta: f ? textoDelta(f.checkoutsOpened.deltaAbs, '') : null,
    },
    {
      evento: 'checkout_abandoned',
      rotulo: 'Checkout abandonado',
      cor: 'stat-checkout-abandoned',
      Icone: UserRoundX,
      valor: f?.checkoutsAbandoned.value,
      nota: f ? `${num(f.checkoutsAbandoned.recovered)} recuperados depois` : null,
      delta: f ? textoDelta(f.checkoutsAbandoned.deltaAbs, '') : null,
    },
    {
      evento: 'add_payment_info',
      rotulo: 'Pix gerado',
      cor: 'stat-pix',
      Icone: QrCode,
      valor: f?.pixCreated.value,
      // Aqui a variação É a nota — repetir embaixo só encheria o cartão.
      nota: f ? textoDelta(f.pixCreated.deltaAbs, '') : null,
      delta: null,
    },
    {
      evento: 'pix_abandoned',
      rotulo: 'Pix abandonado',
      cor: 'stat-pix-abandoned',
      Icone: TimerOff,
      valor: f?.pixAbandoned.value,
      nota: f ? textoDelta(f.pixAbandoned.deltaAbs, '') : null,
      delta: null,
    },
  ];

  return (
    <div className="manager-dashboard">
      <div className="dashboard-overview">
        <div><p className="dashboard-eyebrow">VISÃO DA OPERAÇÃO</p><h2>Visão geral de vendas.</h2><p>Confira as vendas e encontre os clientes que precisam de atenção.</p></div>
      <div>
        <Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período do dashboard" />
      </div>
      </div>

      <div className="dashboard-stat-grid">
        <button className="dashboard-stat stat-revenue" onClick={() => setList('paid')}>
          <span className="stat-top"><Wallet aria-hidden="true" /><span>Receita líquida</span><ArrowUpRight aria-hidden="true" /></span>
          <strong>{brl(s.revenue.cents)}</strong><span className="stat-note">Ticket médio {brl(s.averageTicketCents)}</span>
          <span className="stat-action">Ver pedidos pagos <ArrowUpRight aria-hidden="true" /></span>
        </button>
        <button className="dashboard-stat stat-paid" onClick={() => setList('paid')}>
          <span className="stat-top"><BadgeCheck aria-hidden="true" /><span>Pedidos pagos</span><ArrowUpRight aria-hidden="true" /></span>
          <strong>{num(s.paidOrders.value)}</strong><span className="stat-note">{textoDelta(s.paidOrders.deltaAbs, '')}</span>
          <span className="stat-action">Ver clientes e pagamentos <ArrowUpRight aria-hidden="true" /></span>
        </button>
        <a className="dashboard-stat stat-conversion" href={`#eventos?days=${dias}`}>
          <span className="stat-top"><MousePointerClick aria-hidden="true" /><span>Conversão</span><ArrowUpRight aria-hidden="true" /></span>
          <strong>{pct(s.conversion.pct, 2)}</strong><span className="stat-note">{num(s.visits.value)} sessões no período</span>
          <span className="stat-action">Explorar eventos <ArrowUpRight aria-hidden="true" /></span>
        </a>
        <button className="dashboard-stat stat-abandoned" onClick={() => setList('abandoned')}>
          <span className="stat-top"><UserRoundX aria-hidden="true" /><span>Abandonos</span><ArrowUpRight aria-hidden="true" /></span>
          <strong>{num(s.abandon.drafts + s.abandon.expiredOrders)}</strong><span className="stat-note">{num(s.abandon.drafts)} checkouts · {num(s.abandon.expiredOrders)} Pix expirados</span>
          <span className="stat-action">Ver clientes para contato <ArrowUpRight aria-hidden="true" /></span>
        </button>
      </div>

      <section className="dashboard-funnel" aria-labelledby="dashboard-funil-titulo">
        <div className="dashboard-funnel-title">
          <h3 id="dashboard-funil-titulo">Funil do site</h3>
          <span>Contagem do rastreamento no período — cada cartão abre a lista de eventos já filtrada.</span>
        </div>
        <div className="dashboard-funnel-grid">
          {cartoesFunil.map(({ evento, rotulo, cor, Icone, valor, nota, delta }) => (
            // `<a href>` e não botão, como o cartão de Conversão: leva para
            // outra tela, então precisa abrir em nova aba, ser copiável e
            // aparecer como link para o leitor de tela.
            <a key={evento} className={`dashboard-stat stat-funnel ${cor}`} href={`#eventos?days=${dias}&event=${evento}`}>
              <span className="stat-top"><Icone aria-hidden="true" /><span>{rotulo}</span><ArrowUpRight aria-hidden="true" /></span>
              {valor === undefined ? <Skeleton className="my-3.5 h-7 w-20" /> : <strong>{num(valor)}</strong>}
              <span className="stat-note">
                {nota ?? 'aguardando o servidor'}
                {delta ? <small>{delta}</small> : null}
              </span>
              <span className="stat-action">Ver eventos <ArrowUpRight aria-hidden="true" /></span>
            </a>
          ))}
        </div>
      </section>


      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card wide className="mb-0">
          <CardTitle
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
        </Card>

        <Card wide className="mb-0">
          <CardTitle
            title="De onde vêm as visitas"
            action={<span className="text-xs text-muted">{num(origens.data.total)} sessões</span>}
          />
          {temOrigem ? (
            <div className="dashboard-sources">
              {origens.data.sources.map(source => <div className="dashboard-source" key={source.source}>
                <div><OriginBadge source={source.source} /><strong>{num(source.sessions)} <small>sessões</small></strong></div>
                <progress aria-label={`Sessões de ${source.source}`} value={source.sessions} max={Math.max(1, origens.data.total)} />
              </div>)}
              <p className="text-xs text-muted">Origem registrada nos links de campanha. Quando não há identificação, exibimos direto / sem origem.</p>
            </div>
          ) : <Empty>Ainda sem visitas registradas no período.</Empty>}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card wide className="mb-0">
          <CardTitle
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
        </Card>

        <Card wide className="mb-0">
          <CardTitle
            title="Últimos pedidos"
            action={<span className="text-xs text-muted">{num(recentes.data.orders.length)} exibidos</span>}
          />
          {recentes.data.orders.length === 0 ? (
            <Empty>Nenhum pedido ainda.</Empty>
          ) : (
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Quando</Th>
                    <Th>Cliente</Th>
                    <Th>Origem</Th>
                    <Th num>Valor</Th>
                    <Th num>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {recentes.data.orders.map((o) => {
                    const st = STATUS[o.status];
                    return (
                      <tr key={o.publicId}>
                        <Td muted>{quando(o.createdAt)}</Td>
                        <Td>
                          {o.customer}
                          {/* E-mail mascarado pelo servidor: o dashboard não é
                              lugar de listar dado pessoal por inteiro. */}
                          <span className="block text-2xs text-muted">{o.email}</span>
                        </Td>
                        <Td><OriginBadge source={o.source} /></Td>
                        <Td num>{brl(o.amountCents)}</Td>
                        <Td num>
                          <Badge tom={st.tom}>{st.label}</Badge>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </Card>
      </div>
      {list ? <DashboardCustomers key={`${list}-${dias}`} mode={list} days={dias} drafts={s.abandon.drafts} expired={s.abandon.expiredOrders} onClose={() => setList(null)} /> : null}
    </div>
  );
}
