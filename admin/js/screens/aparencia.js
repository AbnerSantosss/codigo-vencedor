import { api, describeError, state } from '../api.js';
import { card, colorField, el, field, textInput, toast } from '../ui.js';
import { nav } from '../nav.js';

export function screenAppearance() {
  const theme = { ...state.config.theme };
  const fields = {};

  const labels = {
    accent: 'Destaque (amarelo)',
    'accent-hover': 'Destaque — hover',
    'accent-soft': 'Destaque — fundo suave',
    'accent-ghost': 'Destaque — fundo fantasma',
    bg: 'Fundo da página',
    surface: 'Card',
    'surface-alt': 'Card alternativo',
    input: 'Campo de formulário',
    'icon-bg': 'Fundo de ícone',
    border: 'Borda',
    'border-strong': 'Borda forte',
    text: 'Texto principal',
    'text-2': 'Texto secundário',
    'text-3': 'Texto terciário',
    muted: 'Texto suave',
    'muted-2': 'Texto suave 2',
    'muted-3': 'Texto suave 3',
    danger: 'Erro',
    cta: 'Botão de compra',
    'cta-hover': 'Botão de compra — hover',
    'cta-ink': 'Texto do botão de compra',
    'alert-bg': 'Barra de urgência',
    'alert-ink': 'Texto da barra de urgência',
  };

  const grid = el('div', { className: 'ad-grid' });
  for (const [key, label] of Object.entries(labels)) {
    const f = colorField(label, theme[key]);
    fields[key] = f.input;
    grid.append(f);
  }

  const radius = textInput(theme.radius, { placeholder: '12px' });
  fields.radius = radius;
  grid.append(field('Raio das bordas', radius, 'Ex.: 12px'));

  const resetBtn = el('button', { className: 'ad-btn ad-btn--ghost', type: 'button' }, 'Restaurar padrão do designer');
  resetBtn.addEventListener('click', async () => {
    if (!window.confirm('Voltar todas as cores para o padrão original?')) return;
    try {
      const res = await api('/config/theme/reset', { method: 'POST' });
      state.config.theme = res.theme;
      toast('Paleta restaurada.');
      nav.paintShell('aparencia');
    } catch (err) {
      toast(describeError(err), true);
    }
  });

  return card(
    'Aparência',
    'Cada cor é uma variável que a página lê ao carregar. Salve e abra a landing page para conferir o resultado.',
    [grid, el('div', { className: 'ad-sp-lg' }), resetBtn],
    () => ({ theme: Object.fromEntries(Object.entries(fields).map(([k, i]) => [k, i.value.trim()])) }),
  );
}
