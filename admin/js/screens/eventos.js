import { api, describeError, state } from '../api.js';
import { el, field, select, toast } from '../ui.js';
import { nav } from '../nav.js';

export function screenEvents(summary) {
  const rangeSelect = select(String(summary.days), [
    ['1', 'Últimas 24 horas'],
    ['7', 'Últimos 7 dias'],
    ['30', 'Últimos 30 dias'],
  ]);
  rangeSelect.addEventListener('change', () => loadEvents(Number(rangeSelect.value)));

  const funnelRows = summary.funnel.map((step) =>
    el(
      'tr',
      {},
      el('td', {}, step.label),
      el('td', { className: 'ad-num' }, String(step.uniques)),
      el('td', { className: 'ad-num' }, String(step.total)),
      el('td', { className: 'ad-num' }, step.rate === null ? '—' : `${step.rate}%`),
    ),
  );

  const funnelTable = el(
    'table',
    { className: 'ad-table' },
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Etapa'),
        el('th', { className: 'ad-num' }, 'Sessões'),
        el('th', { className: 'ad-num' }, 'Eventos'),
        el('th', { className: 'ad-num' }, '% das visitas'),
      ),
    ),
    el('tbody', {}, ...funnelRows),
  );

  const sourceRows = summary.sources.length
    ? summary.sources.map((s) => el('tr', {}, el('td', {}, s.source), el('td', { className: 'ad-num' }, String(s.sessions))))
    : [el('tr', {}, el('td', { colSpan: 2 }, 'Nenhuma visita registrada no período.'))];

  const sourceTable = el(
    'table',
    { className: 'ad-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Origem'), el('th', { className: 'ad-num' }, 'Sessões'))),
    el('tbody', {}, ...sourceRows),
  );

  const rawBody = el('tbody', {}, el('tr', {}, el('td', { colSpan: 4 }, 'Carregando…')));
  const rawTable = el(
    'table',
    { className: 'ad-table' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Quando'), el('th', {}, 'Evento'), el('th', {}, 'Página'), el('th', {}, 'Origem'))),
    rawBody,
  );

  api(`/events?days=${summary.days}&limit=40`)
    .then(({ items }) => {
      if (!items.length) {
        rawBody.replaceChildren(
          el('tr', {}, el('td', { colSpan: 4 }, 'Nenhum evento ainda. Abra a landing page para gerar o primeiro.')),
        );
        return;
      }
      rawBody.replaceChildren(
        ...items.map((i) =>
          el(
            'tr',
            {},
            el('td', {}, new Date(i.createdAt).toLocaleString('pt-BR')),
            el('td', {}, i.event),
            el('td', {}, i.page || '—'),
            el('td', {}, (i.utm && i.utm.utm_source) || (i.referrer ? 'referência' : 'direto')),
          ),
        ),
      );
    })
    .catch(() => rawBody.replaceChildren(el('tr', {}, el('td', { colSpan: 4 }, 'Não foi possível carregar os eventos.'))));

  return el(
    'div',
    {},
    el(
      'div',
      { className: 'ad-card' },
      el('h2', {}, 'Funil'),
      el(
        'p',
        { className: 'ad-hint' },
        'Sessões conta pessoas distintas; eventos conta disparos. A porcentagem é sobre as visitas do período.',
      ),
      field('Período', rangeSelect),
      el('div', { className: 'ad-sp' }),
      funnelTable,
    ),
    el('div', { className: 'ad-card' }, el('h2', {}, 'Origem do tráfego'), el('div', { className: 'ad-sp' }), sourceTable),
    el(
      'div',
      { className: 'ad-card' },
      el('h2', {}, 'Últimos eventos'),
      el('p', { className: 'ad-hint' }, 'Útil para conferir se o rastreamento está chegando enquanto você mexe no GTM.'),
      rawTable,
    ),
  );
}

export async function loadEvents(days) {
  try {
    state.eventsSummary = await api(`/events/summary?days=${days}`);
    nav.paintShell('eventos');
  } catch (err) {
    toast(describeError(err), true);
  }
}
