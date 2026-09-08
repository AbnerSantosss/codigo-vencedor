import { state } from '../api.js';
import { card, el, field, numberInput, textInput, toggle } from '../ui.js';

export function screenContent() {
  const c = state.config.content;
  // toFixed(2) para o campo mostrar 27,90 e não 27,9 — é dinheiro na tela.
  const price = numberInput((c.priceCents / 100).toFixed(2), { step: '0.01', min: '1' });
  const from = numberInput((c.priceFromCents / 100).toFixed(2), { step: '0.01', min: '1' });
  const name = textInput(c.productName, { maxLength: 120 });
  const video = toggle('Mostrar a seção de vídeo', c.videoEnabled, 'Desligar remove o bloco "Entenda a ferramenta em ação".');

  return card(
    'Conteúdo da oferta',
    'O preço entra na página, no título da aba, no preview de link do WhatsApp e nos dados estruturados do Google.',
    [el('div', { className: 'ad-grid' }, field('Preço de venda (R$)', price), field('Valor "de" (R$)', from)), field('Nome do produto', name), video],
    () => ({
      content: {
        priceCents: Math.round(parseFloat(price.value) * 100),
        priceFromCents: Math.round(parseFloat(from.value) * 100),
        currency: 'BRL',
        productName: name.value.trim(),
        videoEnabled: video.input.checked,
      },
    }),
  );
}
