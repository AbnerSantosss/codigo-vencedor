import { api, describeError, state } from '../api.js';
import { el, field, numberInput, secretField, select, toast } from '../ui.js';
import { nav } from '../nav.js';

export function screenGateway(data) {
  const provider = select(data.gatewayActive, [
    ['static_pix', 'Pix estático — sua chave, baixa manual'],
    ['mercadopago', 'Mercado Pago'],
    ['appmax', 'Appmax'],
  ]);
  const mode = select(data.gatewayMode, [
    ['sandbox', 'Sandbox (testes)'],
    ['production', 'Produção (dinheiro real)'],
  ]);
  const expires = numberInput(data.pixExpiresMin, { min: '5', max: '1440' });

  const s = data.secrets ?? {};
  const secrets = {
    mp: [
      secretField('Access token', 'mp.accessToken', s['mp.accessToken']),
      secretField('Segredo do webhook', 'mp.webhookSecret', s['mp.webhookSecret'], 'Usado para validar a assinatura das notificações.'),
    ],
    appmax: [
      secretField('Client ID', 'appmax.clientId', s['appmax.clientId']),
      secretField('Client Secret', 'appmax.clientSecret', s['appmax.clientSecret']),
    ],
    pix: [
      secretField('Chave Pix', 'pix.key', s['pix.key'], 'CPF/CNPJ, e-mail, telefone ou chave aleatória.'),
      secretField('Nome do recebedor', 'pix.merchantName', s['pix.merchantName'], 'Como aparece no app do banco. Até 25 caracteres.'),
      secretField('Cidade do recebedor', 'pix.merchantCity', s['pix.merchantCity'], 'Sem acento. Ex.: SAO PAULO'),
    ],
  };

  const groups = {
    mercadopago: el('div', {}, el('h3', { className: 'ad-group-title' }, 'Mercado Pago'), ...secrets.mp),
    appmax: el('div', {}, el('h3', { className: 'ad-group-title' }, 'Appmax'), ...secrets.appmax),
    static_pix: el('div', {}, el('h3', { className: 'ad-group-title' }, 'Pix estático'), ...secrets.pix),
  };

  const prodWarn = el(
    'div',
    { className: 'ad-msg ad-msg--warn' },
    'Modo produção: as cobranças passam a ser reais. Confirme que as credenciais são as de produção, e não as de teste.',
  );

  const testBtn = el('button', { className: 'ad-btn ad-btn--ghost', type: 'button' }, 'Testar conexão');
  const testOut = el('div', { className: 'ad-msg', hidden: true });

  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testOut.hidden = true;
    try {
      const res = await api('/gateway/test', { method: 'POST' });
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

  function sync() {
    for (const [key, node] of Object.entries(groups)) node.hidden = provider.value !== key;
    prodWarn.hidden = mode.value !== 'production';
  }
  provider.addEventListener('change', sync);
  mode.addEventListener('change', sync);
  queueMicrotask(sync);

  const form = el(
    'form',
    { className: 'ad-card' },
    el('h2', {}, 'Gateway de pagamento'),
    el(
      'p',
      { className: 'ad-hint' },
      'As credenciais são gravadas cifradas e nunca voltam para esta tela. Campo em branco mantém o valor atual.',
    ),
    el('div', { className: 'ad-grid' }, field('Provedor ativo', provider), field('Ambiente', mode)),
    prodWarn,
    field('O Pix expira em (minutos)', expires),
    el('div', { className: 'ad-sp-lg' }),
    groups.mercadopago,
    groups.appmax,
    groups.static_pix,
    testOut,
    el('div', { className: 'ad-actions' }, el('button', { className: 'ad-btn', type: 'submit' }, 'Salvar'), testBtn),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const payload = { secrets: {} };
      for (const list of Object.values(secrets)) {
        for (const f of list) {
          const value = f.readValue();
          if (value !== undefined) payload.secrets[f.secretKey] = value;
        }
      }
      const res = await api('/gateway', {
        method: 'PUT',
        body: JSON.stringify({
          gatewayActive: provider.value,
          gatewayMode: mode.value,
          pixExpiresMin: Number(expires.value) || 30,
          ...payload,
        }),
      });
      state.gateway = res;
      toast('Gateway salvo.');
      nav.paintShell('gateway');
    } catch (err) {
      toast(describeError(err), true);
    } finally {
      btn.disabled = false;
    }
  });

  return form;
}
