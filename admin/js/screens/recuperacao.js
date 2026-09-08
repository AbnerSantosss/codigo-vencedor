import { api, describeError, state } from '../api.js';
import { brl, el, fmtFull, fmtPhone, fmtWhen, kpi, num, reloadAndPaint, toast } from '../ui.js';

/* ---------------- Recuperação de vendas ---------------- */

export function screenRecovery(data) {
  const s = data.summary;
  const emailOff = (state.config?.email?.provider ?? 'none') === 'none';
  const reload = (days) =>
    reloadAndPaint('recovery', `/recovery?days=${days}`, 'recuperacao').catch((err) => {
      if (err.message !== 'sessao_expirada') toast(describeError(err), true);
    });

  /* período + rodar agora */
  const switcher = el('div', { className: 'ad-period' });
  for (const [value, label] of [
    ['7', '7 dias'],
    ['30', '30 dias'],
    ['90', '90 dias'],
  ]) {
    const b = el('button', { className: `ad-period-btn${String(data.days) === value ? ' is-on' : ''}`, type: 'button' }, label);
    b.addEventListener('click', () => reload(value));
    switcher.append(b);
  }

  const run = el('button', { className: 'ad-btn ad-btn--ghost', type: 'button' }, 'Rodar recuperação agora');
  run.addEventListener('click', async () => {
    run.disabled = true;
    try {
      const r = await api('/recovery/run', { method: 'POST' });
      toast(`Rodada concluída: ${num(r.expired)} Pix expirados, ${num(r.checkoutEmails)} e-mails de checkout, ${num(r.pixEmails)} de Pix.`);
      await reload(data.days);
    } catch (err) {
      toast(describeError(err), true);
      run.disabled = false;
    }
  });

  /* cartões */
  const kpis = el(
    'div',
    { className: 'ad-kpis' },
    kpi('Checkout abandonado', num(s.checkoutAbandoned), { text: `${num(s.checkoutEmailed)} e-mails enviados`, direction: 'neutral' }),
    kpi('Pix não pago', num(s.pixAbandoned), { text: `${num(s.pixEmailed)} e-mails enviados`, direction: 'neutral' }),
    kpi('Recuperados', num(s.recovered.count), { text: `${brl(s.recovered.cents)} vindos do link do e-mail`, direction: 'neutral' }),
    kpi('Compra aprovada', num(s.emails.purchase_approved?.enviado ?? 0), {
      text: `${num(s.emails.purchase_approved?.falhou ?? 0)} falharam`,
      direction: 'neutral',
    }),
  );

  const warn = emailOff
    ? el(
        'div',
        { className: 'ad-msg ad-msg--warn' },
        'Os e-mails de recuperação estão desligados: nenhum provedor configurado. ',
        el('a', { href: '#email' }, 'Configurar e-mail →'),
      )
    : null;

  /* detalhe de cada linha */
  const dl = (pairs) =>
    el(
      'dl',
      {},
      ...pairs.filter(([, v]) => v != null && v !== '').flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]),
    );
  const block = (title, pairs) => el('div', {}, el('h4', {}, title), dl(pairs));
  const mailto = (email) => el('a', { href: `mailto:${email}` }, email);
  const wa = (fone) => (fone ? el('a', { href: `https://wa.me/55${fone}`, target: '_blank', rel: 'noopener' }, fmtPhone(fone)) : null);

  function detailFor(item, kind) {
    const times =
      kind === 'checkout'
        ? [
            ['Começou', fmtFull(item.startedAt)],
            ['Última atividade', fmtFull(item.lastSeenAt)],
          ]
        : [
            ['Pix gerado', fmtFull(item.generatedAt)],
            ['Expirou', fmtFull(item.expiredAt)],
          ];

    const customer = [
      ['Nome', item.nome],
      ['E-mail', mailto(item.email)],
    ];
    if (kind === 'pix') {
      customer.push(
        ['WhatsApp', wa(item.fone)],
        ['CPF', item.cpfLast3 ? `•••.•••.••${item.cpfLast3[0]}-${item.cpfLast3.slice(1)}` : null],
        ['Pedido', item.reference],
        ['Valor', brl(item.amountCents)],
      );
    }

    const origin = [
      ['Origem', item.utm?.utm_source ?? 'direta / sem UTM'],
      ['Mídia', item.utm?.utm_medium],
      ['Campanha', item.utm?.utm_campaign],
      ['Conteúdo', item.utm?.utm_content],
      ['Dispositivo', item.device],
      ['IP', item.ip],
    ];

    const rec = item.recovery
      ? [
          ['Status', item.recovery.status === 'enviado' ? 'Enviado' : 'Falhou'],
          ['Quando', fmtFull(item.recovery.at)],
          ['Erro', item.recovery.error],
        ]
      : [['Status', emailOff ? 'E-mail desligado' : 'Ainda não enviado — aguardando o prazo configurado']];

    return el(
      'div',
      { className: 'ad-detail-grid' },
      block('Horários', times),
      block('Cliente', customer),
      block('Origem', origin),
      block('E-mail de recuperação', rec),
    );
  }

  /** Tabela com linha expansível: clique (ou Enter) abre o detalhe logo abaixo. */
  function table(items, kind, columns, cells, emptyText) {
    const tbody = el('tbody');
    if (!items.length) tbody.append(el('tr', {}, el('td', { colSpan: columns.length, className: 'ad-empty' }, emptyText)));
    for (const item of items) {
      const tr = el('tr', { className: 'is-click', tabIndex: 0, title: 'Clique para ver os detalhes' }, ...cells(item));
      const detail = el('tr', { className: 'ad-detail', hidden: true }, el('td', { colSpan: columns.length }, detailFor(item, kind)));
      const flip = () => {
        detail.hidden = !detail.hidden;
        tr.classList.toggle('is-open', !detail.hidden);
      };
      tr.addEventListener('click', flip);
      tr.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          flip();
        }
      });
      tbody.append(tr, detail);
    }
    return el(
      'div',
      { className: 'ad-table-wrap' },
      el(
        'table',
        { className: 'ad-table' },
        el('thead', {}, el('tr', {}, ...columns.map((c) => el('th', { className: c.num ? 'ad-num' : '' }, c.label)))),
        tbody,
      ),
    );
  }

  const recBadge = (item) => {
    if (!item.recovery) return el('span', { className: 'ad-badge is-expired' }, 'sem e-mail');
    const ok = item.recovery.status === 'enviado';
    return el('span', { className: `ad-badge ${ok ? 'is-paid' : 'is-warn'}` }, ok ? 'e-mail enviado' : 'e-mail falhou');
  };
  const who = (item) => el('td', {}, el('b', {}, item.nome), el('br'), el('span', { className: 'ad-muted-cell' }, item.email));

  const checkoutCard = el(
    'section',
    { className: 'ad-card ad-card--wide' },
    el('div', { className: 'ad-chart-head' }, el('h2', {}, 'Checkout abandonado'), el('span', {}, `${num(data.checkout.length)} no período`)),
    el('p', { className: 'ad-hint' }, 'Digitou nome e e-mail válidos e saiu antes de gerar o Pix. Clique na linha para ver horários, dados e origem.'),
    table(
      data.checkout,
      'checkout',
      [{ label: 'Quando' }, { label: 'Cliente' }, { label: 'Origem' }, { label: 'E-mail' }],
      (i) => [
        el('td', { className: 'ad-muted-cell' }, fmtWhen(i.lastSeenAt)),
        who(i),
        el('td', {}, i.utm?.utm_source ?? 'direta'),
        el('td', {}, recBadge(i)),
      ],
      'Ninguém abandonou o checkout no período.',
    ),
  );

  const pixCard = el(
    'section',
    { className: 'ad-card ad-card--wide' },
    el('div', { className: 'ad-chart-head' }, el('h2', {}, 'Pix não pago'), el('span', {}, `${num(data.pix.length)} no período`)),
    el('p', { className: 'ad-hint' }, 'Gerou o Pix e deixou expirar. Aqui tem telefone: vale um WhatsApp antes do e-mail.'),
    table(
      data.pix,
      'pix',
      [{ label: 'Quando' }, { label: 'Cliente' }, { label: 'Valor', num: true }, { label: 'Origem' }, { label: 'E-mail' }],
      (i) => [
        el('td', { className: 'ad-muted-cell' }, fmtWhen(i.generatedAt)),
        who(i),
        el('td', { className: 'ad-num' }, brl(i.amountCents)),
        el('td', {}, i.utm?.utm_source ?? 'direta'),
        el('td', {}, recBadge(i)),
      ],
      'Nenhum Pix expirou sem pagamento no período.',
    ),
  );

  return el('div', {}, el('div', { className: 'ad-dash-head ad-dash-head--split' }, run, switcher), warn, kpis, checkoutCard, pixCard);
}
