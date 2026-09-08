import { useState } from 'react';
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
import { CaixaGrafico, GraficoOrigens, GraficoReceita } from '@/components/charts/Charts';
import {
  Badge,
  Card,
  CardTitle,
  Empty,
  ErrorState,
  Loading,
  Table,
  TableWrap,
  Td,
  Th,
} from '@/components/ui/layout';
import { Funnel, Kpi, KpiGrid, Segmented } from '@/components/ui/metrics';

const PERIODOS = [
  { value: 1, label: 'Hoje' },
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

export function TelaDashboard() {
  const [dias, setDias] = useState(7);

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

  return (
    <>
      <div className="mb-5 flex justify-end">
        <Segmented value={dias} options={PERIODOS} onChange={setDias} label="Período do dashboard" />
      </div>

      <KpiGrid>
        <Kpi
          label="Receita"
          value={brl(s.revenue.cents)}
          delta={s.revenue.deltaPct}
          deltaText={textoDelta(s.revenue.deltaPct, '%')}
        />
        <Kpi
          label="Pedidos pagos"
          value={num(s.paidOrders.value)}
          delta={s.paidOrders.deltaAbs}
          deltaText={textoDelta(s.paidOrders.deltaAbs, '')}
        />
        <Kpi
          label="Conversão"
          value={pct(s.conversion.pct, 2)}
          delta={s.conversion.deltaPp}
          deltaText={textoDelta(s.conversion.deltaPp, ' p.p.')}
        />
        <Kpi label="Ticket médio" value={brl(s.averageTicketCents)} />
        <Kpi
          label="Pix pago"
          value={pct(s.pixPaidRate.pct)}
          note={`${num(s.pixPaidRate.paid)} de ${num(s.pixPaidRate.created)} gerados`}
        />
        <Kpi
          label="Abandonos"
          value={num(s.abandon.drafts + s.abandon.expiredOrders)}
          note={`${num(s.abandon.recoveryEmails)} e-mails · ${num(s.abandon.recovered.count)} recuperados`}
          href="#recuperacao"
        />
      </KpiGrid>

      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Card wide className="mb-0">
          <CardTitle
            title="Receita por dia"
            action={
              <span className="text-xs text-muted">
                {dias === 1 ? 'hoje' : `últimos ${dias} dias`} · total {brl(s.revenue.cents)}
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
            title="Origem do tráfego"
            action={<span className="text-xs text-muted">{num(origens.data.total)} sessões</span>}
          />
          {temOrigem ? (
            // Altura proporcional ao número de fontes: o cartão cresce em vez
            // de espremer as barras.
            <CaixaGrafico altura={`${Math.max(9, origens.data.sources.length * 2.6)}rem`}>
              <GraficoOrigens sources={origens.data.sources} />
            </CaixaGrafico>
          ) : (
            <Empty>Ainda sem visitas registradas no período.</Empty>
          )}
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
    </>
  );
}
