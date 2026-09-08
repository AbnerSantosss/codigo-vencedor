import { api, describeError, state } from '../api.js';
import { el, field, secretField, textInput, toast, toggle } from '../ui.js';
import { nav } from '../nav.js';

export function screenTracking(data) {
  const t = data.tracking;
  const s = data.secrets ?? {};

  /* ---------------- Meta ---------------- */
  const metaPixel = textInput(t.meta.pixelId, { placeholder: '1234567890123456', inputMode: 'numeric' });
  const metaToken = secretField(
    'Token da API de Conversões',
    'meta.capiToken',
    s['meta.capiToken'],
    'Events Manager › Configurações › Gerar token de acesso.',
  );
  const metaTest = textInput(t.meta.testEventCode, { placeholder: 'TEST12345', maxLength: 32 });

  const eventBoxes = data.availableEvents.map((ev) => {
    const on = toggle(
      ev.label,
      t.meta.events.includes(ev.id),
      `Vai para a Meta como ${ev.meta}.`,
    );
    on.eventId = ev.id;
    return on;
  });

  const testBtn = el('button', { className: 'ad-btn ad-btn--ghost', type: 'button' }, 'Enviar evento de teste');
  const testOut = el('div', { className: 'ad-msg', hidden: true });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testOut.hidden = true;
    try {
      const res = await api('/tracking/meta/test', { method: 'POST' });
      testOut.className = `ad-msg ad-msg--${res.ok ? 'ok' : 'err'}`;
      testOut.textContent = res.detail;
    } catch (err) {
      testOut.className = 'ad-msg ad-msg--err';
      testOut.textContent = describeError(err);
    } finally {
      testOut.hidden = false;
      testBtn.disabled = false;
    }
  });

  /* ---------------- Demais plataformas ---------------- */
  const gtmId = textInput(t.gtmId, { placeholder: 'GTM-XXXXXXX' });
  const ga4Id = textInput(t.ga4.measurementId, { placeholder: 'G-XXXXXXXXXX' });
  const ga4Secret = secretField('API Secret do GA4', 'ga4.apiSecret', s['ga4.apiSecret'], 'Admin › Fluxos de dados › Measurement Protocol.');
  const adsId = textInput(t.googleAds.conversionId, { placeholder: 'AW-123456789' });
  const adsLabel = textInput(t.googleAds.conversionLabel, { placeholder: 'AbC-D_efG' });
  const ttPixel = textInput(t.tiktok.pixelCode, { placeholder: 'C4A1B2C3D4E5F6' });
  const ttToken = secretField('Token da Events API', 'tiktok.accessToken', s['tiktok.accessToken']);
  const kwPixel = textInput(t.kwai.pixelId, { placeholder: 'ID do pixel' });
  const kwToken = secretField('Token da API', 'kwai.accessToken', s['kwai.accessToken']);

  const secretFields = [metaToken, ga4Secret, ttToken, kwToken];

  function collect() {
    return {
      tracking: {
        gtmId: gtmId.value.trim(),
        meta: {
          pixelId: metaPixel.value.trim(),
          testEventCode: metaTest.value.trim(),
          events: eventBoxes.filter((b) => b.input.checked).map((b) => b.eventId),
        },
        ga4: { measurementId: ga4Id.value.trim() },
        googleAds: { conversionId: adsId.value.trim(), conversionLabel: adsLabel.value.trim() },
        tiktok: { pixelCode: ttPixel.value.trim() },
        kwai: { pixelId: kwPixel.value.trim() },
      },
      secrets: Object.fromEntries(
        secretFields
          .map((f) => [f.secretKey, f.readValue()])
          .filter(([, v]) => v !== undefined),
      ),
    };
  }

  const save = el('button', { className: 'ad-btn', type: 'submit' }, 'Salvar');

  const form = el(
    'form',
    {},

    /* Meta é a primeira porque é a que dispara pelo servidor. */
    el(
      'div',
      { className: 'ad-card' },
      el('h2', {}, 'Meta — API de Conversões'),
      el(
        'p',
        { className: 'ad-hint' },
        'Os eventos saem daqui do servidor, não do navegador: não dependem de bloqueador de anúncio, ' +
          'aba fechada nem cookie de terceiro. O Purchase nasce no webhook do pagamento.',
      ),
      el('div', { className: 'ad-grid' }, field('Pixel ID (dataset)', metaPixel), field('Código de teste', metaTest, 'Só para a aba Testar eventos. Deixe vazio em produção.')),
      el('div', { className: 'ad-sp' }),
      metaToken,
      el('div', { className: 'ad-sp-lg' }),
      el('h3', { className: 'ad-group-title' }, 'Quais eventos enviar'),
      el('div', { className: 'ad-grid' }, ...eventBoxes),
      el(
        'p',
        { className: 'ad-hint ad-mt' },
        'Cada evento leva o mesmo event_id que foi para o dataLayer. Se você montar uma tag de Pixel no GTM, ' +
          'use esse event_id como eventID dela — é o que faz a Meta tratar os dois como um evento só.',
      ),
      testOut,
      el('div', { className: 'ad-actions' }, testBtn),
    ),

    el(
      'div',
      { className: 'ad-card' },
      el('h2', {}, 'Google Tag Manager'),
      el('p', { className: 'ad-hint' }, 'O único identificador que chega ao HTML da página. Gatilhos e tags você monta dentro do GTM.'),
      field('Container ID', gtmId),
    ),

    el(
      'div',
      { className: 'ad-card' },
      el('h2', {}, 'Outras plataformas'),
      el('p', { className: 'ad-hint' }, 'Ficam guardadas e entram no mesmo envio pelo servidor conforme forem ligadas.'),
      el('h3', { className: 'ad-group-title' }, 'Google Analytics 4'),
      field('Measurement ID', ga4Id),
      el('div', { className: 'ad-sp' }),
      ga4Secret,
      el('div', { className: 'ad-sp-lg' }),
      el('h3', { className: 'ad-group-title' }, 'Google Ads'),
      el('div', { className: 'ad-grid' }, field('Conversion ID', adsId), field('Conversion Label', adsLabel)),
      el('div', { className: 'ad-sp-lg' }),
      el('h3', { className: 'ad-group-title' }, 'TikTok Ads'),
      field('Pixel Code', ttPixel),
      el('div', { className: 'ad-sp' }),
      ttToken,
      el('div', { className: 'ad-sp-lg' }),
      el('h3', { className: 'ad-group-title' }, 'Kwai Ads'),
      field('Pixel ID', kwPixel),
      el('div', { className: 'ad-sp' }),
      kwToken,
      el('div', { className: 'ad-actions' }, save),
    ),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    save.disabled = true;
    try {
      const res = await api('/tracking', { method: 'PUT', body: JSON.stringify(collect()) });
      state.tracking = { ...state.tracking, tracking: res.tracking, secrets: res.secrets };
      toast('Rastreamento salvo.');
      nav.paintShell('rastreamento');
    } catch (err) {
      toast(describeError(err), true);
    } finally {
      save.disabled = false;
    }
  });

  return form;
}
