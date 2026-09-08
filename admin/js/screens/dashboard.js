import { api, describeError, state } from '../api.js';
import { brl, deltaOf, el, kpi, num, toast } from '../ui.js';
import { lineChart, sourcesChart } from '../charts.js';
import { nav } from '../nav.js';

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

export const STATUS_LABEL = {
  paid: ['Pago', 'is-paid'],
  pending: ['Pendente', 'is-pending'],
  expired: ['Expirado', 'is-expired'],
  refunded: ['Estornado', 'is-expired'],
  failed: ['Falhou', 'is-expired'],
};

export function screenDashboard(data) {
  const { summary, daily, sources, recent, funnel } = data;

  /* ---------------- período ---------------- */
  const periods = [
    ['1', 'Hoje'],
    ['7', '7 dias'],
    ['30', '30 dias'],
  ];
  const switcher = el('div', { className: 'ad-period' });
  for (const [value, label] of periods) {
    const b = el('button', { className: `ad-period-btn${String(summary.days) === value ? ' is-on' : ''}`, type: 'button' }, label);
    b.addEventListener('click', () => loadDashboard(Number(value)));
    switcher.append(b);
  }

  /* ---------------- cartões ---------------- */
  const kpis = el(
    'div',
    { className: 'ad-kpis' },
    kpi('Receita', brl(summary.revenue.cents), deltaOf(summary.revenue.deltaPct, '%')),
    kpi('Pedidos pagos', num(summary.paidOrders.value), deltaOf(summary.paidOrders.deltaAbs, '')),
    kpi(
      'Conversão',
      summary.conversion.pct === null ? '—' : `${summary.conversion.pct.toLocaleString('pt-BR')}%`,
      deltaOf(summary.conversion.deltaPp, ' p.p.'),
    ),
    kpi('Ticket médio', brl(summary.averageTicketCents)),
    kpi(
      'Pix pago',
      summary.pixPaidRate.pct === null ? '—' : `${summary.pixPaidRate.pct.toLocaleString('pt-BR')}%`,
      { text: `${num(summary.pixPaidRate.paid)} de ${num(summary.pixPaidRate.created)} gerados`, direction: 'neutral' },
    ),
    el(
      'a',
      { className: 'ad-kpi-link', href: '#recuperacao', title: 'Abrir recuperação de vendas' },
      kpi('Abandonos', num((summary.abandon?.drafts ?? 0) + (summary.abandon?.expiredOrders ?? 0)), {
        text: `${num(summary.abandon?.recoveryEmails ?? 0)} e-mails · ${num(summary.abandon?.recovered?.count ?? 0)} recuperados`,
        direction: 'neutral',
      }),
    ),
  );

  /* ---------------- gráficos ---------------- */
  const lineCanvas = el('canvas');
  const sourcesCanvas = el('canvas');

  const temReceita = daily.series.some((p) => p.revenueCents > 0);
  const temOrigem = sources.sources.length > 0;

  const revenueCard = el(
    'section',
    { className: 'ad-card ad-chart-card' },
    el(
      'div',
      { className: 'ad-chart-head' },
      el('h2', {}, 'Receita por dia'),
      el('span', {}, `${summary.days === 1 ? 'hoje' : `últimos ${summary.days} dias`} · total ${brl(summary.revenue.cents)}`),
    ),
    temReceita
      ? el('div', { className: 'ad-chart' }, lineCanvas)
      : el('p', { className: 'ad-empty' }, 'Nenhuma venda no período. O gráfico aparece com o primeiro pedido pago.'),
  );

  // Altura proporcional ao número de fontes: barra fina com respiro, e o
  // cartão cresce em vez de espremer as barras.
  const sourcesBox = el('div', { className: 'ad-chart' }, sourcesCanvas);
  sourcesBox.style.height = `${Math.max(9, sources.sources.length * 2.6)}rem`;

  const sourcesCard = el(
    'section',
    { className: 'ad-card ad-chart-card' },
    el('div', { className: 'ad-chart-head' }, el('h2', {}, 'Origem do tráfego'), el('span', {}, `${num(sources.total)} sessões`)),
    temOrigem
      ? sourcesBox
      : el('p', { className: 'ad-empty' }, 'Ainda sem visitas registradas no período.'),
  );

  /* ---------------- funil ---------------- */

  /**
   * A última etapa vem da tabela de pedidos, não da de eventos.
   *
   * O evento `purchase` só existe no funil quando o servidor consegue
   * gravá-lo; o pedido pago existe sempre. Ler as duas fontes diferentes
   * fazia o funil dizer "Pagaram: 0" ao lado de um cartão marcando 53 vendas.
   */
  const steps = funnel.funnel.map((s) =>
    s.event === 'purchase' ? { ...s, uniques: summary.paidOrders.value, total: summary.paidOrders.value } : s,
  );
  const maxStep = Math.max(1, ...steps.map((s) => s.uniques));
  const funnelCard = el(
    'section',
    { className: 'ad-card' },
    el('h2', {}, 'Funil'),
    el('p', { className: 'ad-hint' }, 'Sessões distintas em cada etapa. A queda entre elas é onde a página perde gente.'),
    el(
      'div',
      { className: 'ad-funnel' },
      ...steps.map((step, i) => {
        const last = i === steps.length - 1;
        const bar = el('span', { className: 'ad-funnel-fill' });
        bar.style.width = `${Math.max(step.uniques > 0 ? 1.5 : 0, (step.uniques / maxStep) * 100)}%`;
        if (last) bar.classList.add('is-final');
        return el(
          'div',
          { className: `ad-funnel-row${last ? ' is-final' : ''}` },
          el('span', { className: 'ad-funnel-label' }, step.label),
          el('span', { className: 'ad-funnel-track' }, bar),
          el('span', { className: 'ad-num ad-funnel-value' }, num(step.uniques)),
        );
      }),
    ),
  );

  /* ---------------- últimos pedidos ---------------- */
  const rows = recent.orders.length
    ? recent.orders.map((o) => {
        const [label, cls] = STATUS_LABEL[o.status] ?? [o.status, ''];
        return el(
          'tr',
          {},
          el('td', { className: 'ad-muted-cell' }, new Date(o.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })),
          el('td', {}, o.customer),
          el('td', { className: 'ad-num' }, brl(o.amountCents)),
          el('td', { className: 'ad-num' }, el('span', { className: `ad-badge ${cls}` }, label)),
        );
      })
    : [el('tr', {}, el('td', { colSpan: 4, className: 'ad-empty' }, 'Nenhum pedido ainda.'))];

  const ordersCard = el(
    'section',
    { className: 'ad-card' },
    el('div', { className: 'ad-chart-head' }, el('h2', {}, 'Últimos pedidos'), el('span', {}, `${num(recent.orders.length)} exibidos`)),
    el(
      'table',
      { className: 'ad-table' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Quando'), el('th', {}, 'Cliente'), el('th', { className: 'ad-num' }, 'Valor'), el('th', { className: 'ad-num' }, 'Status'))),
      el('tbody', {}, ...rows),
    ),
  );

  const root = el(
    'div',
    {},
    el('div', { className: 'ad-dash-head' }, switcher),
    kpis,
    el('div', { className: 'ad-dash-row ad-dash-row--charts' }, revenueCard, sourcesCard),
    el('div', { className: 'ad-dash-row' }, funnelCard, ordersCard),
  );

  // Chart.js precisa do canvas já no documento para medir. Só depois de
  // anexado é que os gráficos podem ser criados.
  queueMicrotask(() => {
    if (temReceita && lineCanvas.isConnected) lineChart(lineCanvas, daily.series);
    if (temOrigem && sourcesCanvas.isConnected) sourcesChart(sourcesCanvas, sources.sources);
  });

  return root;
}

/** Busca os dados sem repintar — usado pelo  da tela. */
/**
 * Busca tudo que o dashboard precisa em paralelo.
 *
 * `repaint` fica falso no carregamento inicial: ali quem desenha é o
 * `renderShell`, e repintar de dentro do `load` entraria em laço.
 */
export async function loadDashboardInto(days, repaint = false) {
  const [summary, daily, sources, recent, funnel] = await Promise.all([
    api(`/metrics/summary?days=${days}`),
    api(`/metrics/daily?days=${days}`),
    api(`/metrics/sources?days=${days}`),
    api('/metrics/recent-orders?limit=8'),
    api(`/events/summary?days=${days}`),
  ]);
  state.dashboard = { summary, daily, sources, recent, funnel };
  if (repaint) nav.paintShell('dashboard');
}

export async function loadDashboard(days) {
  try {
    await loadDashboardInto(days, true);
  } catch (err) {
    if (err.message !== 'sessao_expirada') toast(describeError(err), true);
  }
}
