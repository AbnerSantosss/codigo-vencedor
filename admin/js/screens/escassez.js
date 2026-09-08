import { state } from '../api.js';
import { card, el, field, numberInput, select, textInput, toast, toggle } from '../ui.js';

export function screenScarcity() {
  const s = state.config.scarcity;

  const cdOn = toggle('Contador regressivo', s.countdown.enabled, 'A tarja "OFERTA TERMINA EM" e a barra do checkout.');
  const cdMode = select(s.countdown.mode, [
    ['per_visitor', 'Por visitante — cada pessoa vê o próprio relógio'],
    ['campaign', 'Campanha — uma data e hora fim iguais para todos'],
  ]);
  const cdMinutes = numberInput(s.countdown.minutes, { min: '1', max: '1440' });
  const cdEnds = el('input', {
    className: 'ad-input',
    type: 'datetime-local',
    value: s.countdown.endsAt ? new Date(s.countdown.endsAt).toISOString().slice(0, 16) : '',
  });

  const spotsOn = toggle('Vagas restantes', s.spots.enabled);
  const spotsMode = select(s.spots.mode, [
    ['manual', 'Número fixo que eu escolho'],
    ['from_sales', 'Descontar as vendas pagas do total'],
  ]);
  const spotsValue = numberInput(s.spots.value, { min: '0', max: '9999' });

  const buyersOn = toggle(
    'Compradores nas últimas 24h',
    s.buyers.enabled,
    'Sem efeito hoje: o texto "X pessoas garantiram o acesso" saiu da página. Quem faz esse papel agora é o aviso de compra recente, aqui embaixo, que aparece quando a pessoa abre o checkout.',
  );
  const buyersMode = select(s.buyers.mode, [
    ['manual', 'Número fixo que eu escolho'],
    ['from_sales', 'Contar os pedidos pagos de verdade nas últimas 24h'],
  ]);
  const buyersValue = numberInput(s.buyers.value, { min: '0', max: '99999' });

  const barOn = toggle(
    'Barra amarela sobre o checkout',
    s.bar.enabled,
    'Sem efeito hoje: esta barra foi removida da página. As contagens que existem são a tarja no card de preço e a faixa de lançamento no checkout — as duas leem este mesmo prazo, então nunca divergem.',
  );

  /* -------------------------------------------------------------- *
   * Aviso de compra recente
   *
   * Lista digitada à mão, de propósito. Ela alimenta um aviso que diz
   * "X acabou de adquirir Y" — se o nome não for de alguém que comprou
   * de verdade, é o art. 37 do CDC, e é o dono que assina. Por isso não
   * há gerador de nome aqui e a lista começa vazia.
   * -------------------------------------------------------------- */
  const sp = s.socialProof ?? { enabled: false, intervalSec: 9, items: [] };
  const spOn = toggle('Aviso de compra recente', sp.enabled, 'Um selo rotativo no canto da página: "Adriano · Goiânia acabou de adquirir Maiores Odds".');
  const spInterval = numberInput(sp.intervalSec, { min: '4', max: '60' });
  const spList = el('div', { className: 'ad-sp' });

  function spRow(item = { name: '', city: '', product: '', minutesAgo: 0 }) {
    const name = textInput(item.name, { placeholder: 'Adriano', maxLength: 60 });
    const city = textInput(item.city, { placeholder: 'Goiânia', maxLength: 60 });
    const product = textInput(item.product, { placeholder: 'Maiores Odds', maxLength: 60 });
    const minutesAgo = numberInput(item.minutesAgo, { min: '0', max: '1440' });
    const del = el('button', { className: 'ad-btn ad-btn--sm ad-btn--danger', type: 'button' }, 'Remover');

    const row = el(
      'div',
      { className: 'ad-tpl' },
      el('div', { className: 'ad-grid' },
        field('Primeiro nome', name),
        field('Cidade', city, 'Opcional'),
        field('O que comprou', product),
        field('Há quantos minutos', minutesAgo, '0 esconde o tempo'),
      ),
      el('div', { className: 'ad-inline ad-mt' }, del),
    );
    row.collect = () => ({
      name: name.value.trim(),
      city: city.value.trim(),
      product: product.value.trim(),
      minutesAgo: Number(minutesAgo.value) || 0,
    });
    del.addEventListener('click', () => { row.remove(); sync(); });
    return row;
  }

  for (const item of sp.items ?? []) spList.append(spRow(item));

  const spAdd = el('button', { className: 'ad-btn ad-btn--ghost ad-btn--sm', type: 'button' }, '+ Adicionar aviso');
  spAdd.addEventListener('click', () => {
    if (spList.querySelectorAll('.ad-tpl').length >= 20) return toast('Máximo de 20 avisos.', true);
    spList.append(spRow());
    sync();
  });

  const spEmpty = el(
    'p',
    { className: 'ad-hint ad-mt' },
    'Nenhum aviso cadastrado — a landing page não vai exibir nada. Use "+ Adicionar aviso".',
  );

  const spWarn = el(
    'div',
    { className: 'ad-msg ad-msg--warn' },
    'Cadastre aqui só quem comprou de verdade. Este aviso afirma ao visitante que uma compra acabou de acontecer: ' +
      'com nome inventado ele é publicidade enganosa (art. 37 do CDC) e é motivo de reprovação de anúncio na Meta. ' +
      'Sem nenhum aviso cadastrado, ou com o bloco desligado, a landing page não exibe nada.',
  );

  const warn = el(
    'div',
    { className: 'ad-msg ad-msg--warn' },
    'No modo "por visitante" o prazo reinicia para cada pessoa e a oferta não termina de fato. ' +
      'O modo "campanha" e as opções "de verdade" abaixo usam dados reais — no Brasil, número inventado de vaga ' +
      'ou de comprador é o que o art. 37 do CDC trata como publicidade enganosa.',
  );

  function sync() {
    cdMode.parentElement.hidden = !cdOn.input.checked;
    cdMinutes.parentElement.hidden = !cdOn.input.checked || cdMode.value !== 'per_visitor';
    cdEnds.parentElement.hidden = !cdOn.input.checked || cdMode.value !== 'campaign';
    spotsMode.parentElement.hidden = !spotsOn.input.checked;
    spotsValue.parentElement.hidden = !spotsOn.input.checked;
    buyersMode.parentElement.hidden = !buyersOn.input.checked;
    buyersValue.parentElement.hidden = !buyersOn.input.checked || buyersMode.value === 'from_sales';

    const spRows = spList.querySelectorAll('.ad-tpl').length;
    spInterval.parentElement.hidden = !spOn.input.checked || spRows < 2;
    spList.hidden = !spOn.input.checked;
    spAdd.hidden = !spOn.input.checked;
    /* Bloco ligado e sem nenhum aviso: o dono precisa saber que a LP não vai
       mostrar nada, em vez de achar que salvou e não funcionou. */
    spEmpty.hidden = !spOn.input.checked || spRows > 0;
  }
  for (const control of [cdOn.input, cdMode, spotsOn.input, spotsMode, buyersOn.input, buyersMode, spOn.input]) {
    control.addEventListener('change', sync);
  }
  queueMicrotask(sync);

  return card(
    'Blocos de escassez',
    'Cada bloco liga e desliga sozinho. Nada aqui depende de outro.',
    [
      warn,
      cdOn,
      field('Como o contador funciona', cdMode),
      field('Minutos por visitante', cdMinutes),
      field('Termina em', cdEnds),
      el('div', { className: 'ad-sp' }),
      spotsOn,
      field('Origem do número de vagas', spotsMode),
      field('Total de vagas', spotsValue),
      el('div', { className: 'ad-sp' }),
      buyersOn,
      field('Origem do número de compradores', buyersMode),
      field('Compradores exibidos', buyersValue),
      el('div', { className: 'ad-sp' }),
      barOn,
      el('div', { className: 'ad-sp-lg' }),
      el('p', { className: 'ad-group-title' }, 'Aviso de compra recente'),
      spWarn,
      spOn,
      field('Segundos entre um aviso e o próximo', spInterval),
      spEmpty,
      spList,
      el('div', { className: 'ad-inline ad-mt' }, spAdd),
    ],
    () => ({
      scarcity: {
        countdown: {
          enabled: cdOn.input.checked,
          mode: cdMode.value,
          minutes: Number(cdMinutes.value) || 15,
          endsAt: cdMode.value === 'campaign' && cdEnds.value ? new Date(cdEnds.value).toISOString() : null,
        },
        spots: { enabled: spotsOn.input.checked, mode: spotsMode.value, value: Number(spotsValue.value) || 0 },
        buyers: { enabled: buyersOn.input.checked, mode: buyersMode.value, value: Number(buyersValue.value) || 0 },
        bar: { enabled: barOn.input.checked },
        socialProof: {
          enabled: spOn.input.checked,
          intervalSec: Number(spInterval.value) || 9,
          /* Linha sem nome ou sem produto é descartada em vez de virar erro de
             validação: quem clicou em "Adicionar" e mudou de ideia não deve
             ficar travado no Salvar. */
          items: Array.from(spList.querySelectorAll('.ad-tpl'))
            .map((row) => row.collect())
            .filter((item) => item.name && item.product),
        },
      },
    }),
  );
}
