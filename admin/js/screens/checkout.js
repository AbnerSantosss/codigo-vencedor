import { state } from '../api.js';
import { card, el, field, select, textInput, toggle } from '../ui.js';

export function screenCheckout() {
  const c = state.config.checkout ?? { mode: 'embedded', externalUrl: '', buttonLabel: '', openInNewTab: false };

  const mode = select(c.mode, [
    ['embedded', 'Formulário e QR Code na própria página'],
    ['link', 'Apenas um botão que leva para um link externo'],
  ]);
  const url = textInput(c.externalUrl, { placeholder: 'https://pay.exemplo.com.br/seu-produto' });
  const label = textInput(c.buttonLabel, { maxLength: 60, placeholder: 'Quero garantir minha vaga' });
  const newTab = toggle('Abrir em nova aba', c.openInNewTab === true, 'Mantém sua página aberta enquanto o comprador paga.');

  const linkWarn = el(
    'div',
    { className: 'ad-msg ad-msg--warn' },
    'No modo link a seção de checkout some da página e os quatro CTAs passam a apontar para a URL. ' +
      'Sem URL preenchida o modo é ignorado e o formulário continua — melhor isso do que uma página sem caminho de compra.',
  );

  function sync() {
    const isLink = mode.value === 'link';
    linkWarn.hidden = !isLink;
    url.parentElement.hidden = !isLink;
    label.parentElement.hidden = !isLink;
    newTab.hidden = !isLink;
  }
  mode.addEventListener('change', sync);
  queueMicrotask(sync);

  return card(
    'Como o cliente paga',
    'Escolha entre o checkout embutido, que exige um gateway configurado, e um botão que leva para um link de pagamento pronto.',
    [
      field('Modo do checkout', mode),
      linkWarn,
      field('URL do checkout externo', url, 'Link de pagamento da Appmax, Hotmart, Kiwify, Mercado Pago…'),
      field('Texto do botão', label),
      newTab,
    ],
    () => ({
      checkout: {
        mode: mode.value,
        externalUrl: url.value.trim(),
        buttonLabel: label.value.trim(),
        openInNewTab: newTab.input.checked,
      },
    }),
  );
}
