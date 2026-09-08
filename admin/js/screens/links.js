import { state } from '../api.js';
import { card, el, field, textInput } from '../ui.js';

export function screenLinks() {
  const l = state.config.links;
  const number = textInput(l.whatsapp.number, { placeholder: '5511987654321', inputMode: 'numeric' });
  const message = textInput(l.whatsapp.message, { maxLength: 300 });
  const social = {
    instagram: textInput(l.social.instagram, { placeholder: 'https://instagram.com/seuperfil' }),
    tiktok: textInput(l.social.tiktok, { placeholder: 'https://tiktok.com/@seuperfil' }),
    kwai: textInput(l.social.kwai, { placeholder: 'https://kwai.com/@seuperfil' }),
    x: textInput(l.social.x, { placeholder: 'https://x.com/seuperfil' }),
  };

  return card(
    'Links e redes sociais',
    'Campo vazio some da página em vez de virar um link morto — era assim que os quatro ícones do rodapé estavam.',
    [
      field('WhatsApp — número com DDI e DDD', number, 'Só dígitos. Ex.: 5511987654321 para (11) 98765-4321.'),
      field('Mensagem que já vem digitada', message),
      el('div', { className: 'ad-sp' }),
      el(
        'div',
        { className: 'ad-grid' },
        field('Instagram', social.instagram),
        field('TikTok', social.tiktok),
        field('Kwai', social.kwai),
        field('X (Twitter)', social.x),
      ),
    ],
    () => ({
      links: {
        whatsapp: { number: number.value.replace(/\D/g, ''), message: message.value },
        social: Object.fromEntries(Object.entries(social).map(([k, i]) => [k, i.value.trim()])),
      },
    }),
  );
}
