import { api, describeError, state } from '../api.js';
import { el, field, fmtWhen, formCard, numberInput, reloadAndPaint, secretField, select, textInput, toast, toggle } from '../ui.js';

/* ---------------- E-mail ---------------- */

export const TPL_SHORT = {
  purchase_approved: 'Compra aprovada',
  checkout_abandoned: 'Checkout abandonado',
  pix_abandoned: 'Pix não pago',
  password_reset: 'Senha (painel)',
  user_invite: 'Convite',
};

export function screenEmail(data) {
  const e = data.email;
  const refresh = () => reloadAndPaint('emailCfg', '/email', 'email');
  const put = async (body) => {
    const res = await api('/email', { method: 'PUT', body: JSON.stringify(body) });
    state.emailCfg = { ...state.emailCfg, email: res.email, secrets: res.secrets };
    if (state.config) state.config = { ...state.config, email: res.email };
    return res;
  };

  /* provedor */
  const provider = select(e.provider, [
    ['none', 'Desligado — nenhum e-mail sai'],
    ['smtp', 'SMTP (Gmail com senha de app, ou qualquer servidor)'],
    ['resend', 'Resend (em breve)'],
  ]);
  provider.querySelector('option[value="resend"]').disabled = true;
  const fromName = textInput(e.fromName, { maxLength: 80, placeholder: 'Código Vencedor' });
  const fromEmail = el('input', { className: 'ad-input', type: 'email', value: e.fromEmail, placeholder: 'mesmo do usuário SMTP' });
  const host = textInput(e.smtp.host, { placeholder: 'smtp.gmail.com' });
  const port = numberInput(e.smtp.port, { min: '1', max: '65535' });
  const secure = toggle('Conexão segura (SSL/TLS)', e.smtp.secure, 'Porta 465 usa SSL direto. Para a 587 (STARTTLS), desligue.');
  const user = textInput(e.smtp.user, { placeholder: 'sua-conta@gmail.com', autocomplete: 'off' });
  const pass = secretField(
    'Senha do SMTP',
    'email.apiKey',
    data.secrets['email.apiKey'],
    'No Gmail: Conta Google → Segurança → Verificação em duas etapas → Senhas de app. São 16 letras — não é a senha da conta.',
  );
  const accessUrl = textInput(e.accessUrl, { placeholder: 'https://app.seudominio.com.br', type: 'url' });

  const smtpBox = el('div', { className: 'ad-grid' }, field('Servidor', host), field('Porta', port), field('Usuário', user), pass, secure);
  const syncProvider = () => {
    smtpBox.hidden = provider.value !== 'smtp';
  };
  provider.addEventListener('change', syncProvider);
  queueMicrotask(syncProvider);

  const testBtn = el('button', { className: 'ad-btn ad-btn--ghost', type: 'button' }, 'Testar conexão');
  const testMsg = el('div', { className: 'ad-msg', hidden: true });
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testMsg.hidden = true;
    try {
      const r = await api('/email/test-connection', { method: 'POST' });
      testMsg.className = `ad-msg ad-msg--${r.ok ? 'ok' : 'err'}`;
      testMsg.textContent = r.detail;
      testMsg.hidden = false;
    } catch (err) {
      toast(describeError(err), true);
    } finally {
      testBtn.disabled = false;
    }
  });

  const providerCard = formCard(
    'Provedor de envio',
    'Salve antes de testar: o teste usa o que está gravado no servidor.',
    [
      el(
        'div',
        { className: 'ad-grid' },
        field('Provedor', provider),
        field('Nome do remetente', fromName),
        field('E-mail do remetente', fromEmail, 'No Gmail precisa ser a própria conta ou um alias verificado.'),
      ),
      el('div', { className: 'ad-sp' }),
      smtpBox,
      el('div', { className: 'ad-sp' }),
      field('Link de acesso ao produto', accessUrl, 'Entra no e-mail de compra aprovada como {{link_acesso}}.'),
      testMsg,
    ],
    async () => {
      const secrets = {};
      const v = pass.readValue();
      if (v !== undefined) secrets[pass.secretKey] = v;
      await put({
        email: {
          provider: provider.value,
          fromName: fromName.value.trim(),
          fromEmail: fromEmail.value.trim(),
          smtp: { host: host.value.trim(), port: Number(port.value) || 465, secure: secure.input.checked, user: user.value.trim() },
          accessUrl: accessUrl.value.trim(),
        },
        secrets,
      });
      toast('Configuração de e-mail salva.');
      await refresh();
    },
    [testBtn],
  );

  /* recuperação */
  const r = e.recovery;
  const coOn = toggle('E-mail de checkout abandonado', r.checkoutAbandonedEnabled, 'Para quem digitou nome e e-mail válidos e não gerou o Pix.');
  const coMin = numberInput(r.checkoutAbandonedAfterMin, { min: '5', max: '1440' });
  const pxOn = toggle('E-mail de Pix não pago', r.pixAbandonedEnabled, 'Para quem gerou o Pix e deixou expirar sem pagar.');
  const pxMin = numberInput(r.pixAbandonedAfterMin, { min: '1', max: '1440' });

  const recoveryCard = formCard(
    'Recuperação automática',
    'Cada pessoa recebe no máximo um e-mail de cada tipo. O job roda a cada minuto; quem voltou e comprou antes do prazo não recebe nada.',
    [
      el(
        'div',
        { className: 'ad-grid' },
        coOn,
        field('Enviar após (minutos sem atividade)', coMin),
        pxOn,
        field('Enviar após (minutos depois de expirar)', pxMin),
      ),
    ],
    async () => {
      await put({
        email: {
          recovery: {
            checkoutAbandonedEnabled: coOn.input.checked,
            checkoutAbandonedAfterMin: Number(coMin.value) || 30,
            pixAbandonedEnabled: pxOn.input.checked,
            pixAbandonedAfterMin: Number(pxMin.value) || 10,
          },
        },
      });
      toast('Regras de recuperação salvas.');
    },
  );

  /* templates */
  const tplInputs = {};
  const testTo = el('input', { className: 'ad-input', type: 'email', placeholder: 'para qual e-mail enviar o teste', value: state.user?.email ?? '' });

  const tplBlocks = Object.entries(data.meta).map(([id, meta]) => {
    const t = e.templates[id] ?? data.defaults[id];
    const subject = textInput(t.subject, { maxLength: 200 });
    const body = el('textarea', { className: 'ad-textarea', value: t.body, rows: 9 });
    tplInputs[id] = { subject, body };

    const reset = el('button', { className: 'ad-btn ad-btn--ghost ad-btn--sm', type: 'button' }, 'Restaurar padrão');
    reset.addEventListener('click', () => {
      subject.value = data.defaults[id].subject;
      body.value = data.defaults[id].body;
    });

    const send = el('button', { className: 'ad-btn ad-btn--ghost ad-btn--sm', type: 'button' }, 'Enviar teste');
    send.addEventListener('click', async () => {
      if (!testTo.value.trim()) {
        toast('Informe o e-mail de teste no fim da lista.', true);
        testTo.focus();
        return;
      }
      send.disabled = true;
      try {
        const res = await api('/email/send-test', { method: 'POST', body: JSON.stringify({ to: testTo.value.trim(), template: id }) });
        toast(res.ok ? `Teste enviado para ${testTo.value.trim()}.` : `Falhou: ${res.error}`, !res.ok);
      } catch (err) {
        toast(describeError(err), true);
      } finally {
        send.disabled = false;
      }
    });

    return el(
      'div',
      { className: 'ad-tpl' },
      el('div', { className: 'ad-chart-head' }, el('h3', {}, meta.label), el('div', { className: 'ad-inline' }, reset, send)),
      el('p', { className: 'ad-hint' }, meta.hint),
      field('Assunto', subject),
      el('div', { className: 'ad-sp-sm' }),
      field('Mensagem', body),
      el('p', { className: 'ad-tpl-vars' }, 'Variáveis: ', ...meta.vars.map((v) => el('code', {}, `{{${v}}}`))),
    );
  });

  const templatesCard = formCard(
    'Templates',
    'Texto puro; o servidor monta o HTML. Quebras de linha e links são preservados. O salvar grava todos de uma vez.',
    [
      ...tplBlocks,
      el(
        'div',
        { className: 'ad-tpl' },
        field('E-mail para os testes', testTo, 'Os testes usam dados fictícios (Maria, pedido CV-TESTE1) e o assunto começa com [TESTE].'),
      ),
    ],
    async () => {
      const templates = {};
      for (const [id, { subject, body }] of Object.entries(tplInputs)) {
        templates[id] = { subject: subject.value.trim(), body: body.value };
      }
      await put({ email: { templates } });
      toast('Templates salvos.');
    },
  );

  /* últimos envios */
  const logRows = data.recent.length
    ? data.recent.map((l) => {
        const base = l.template.replace(':teste', '');
        const name = (TPL_SHORT[base] ?? base) + (l.template.endsWith(':teste') ? ' (teste)' : '');
        const ok = l.status === 'enviado';
        return el(
          'tr',
          {},
          el('td', { className: 'ad-muted-cell' }, fmtWhen(l.createdAt)),
          el('td', {}, l.to),
          el('td', {}, name),
          el(
            'td',
            {},
            el('span', { className: `ad-badge ${ok ? 'is-paid' : 'is-warn'}` }, ok ? 'Enviado' : 'Falhou'),
            l.error ? el('div', { className: 'ad-list-note', title: l.error }, l.error) : null,
          ),
        );
      })
    : [el('tr', {}, el('td', { colSpan: 4, className: 'ad-empty' }, 'Nenhum e-mail enviado ainda.'))];

  const logCard = el(
    'section',
    { className: 'ad-card ad-card--wide' },
    el('div', { className: 'ad-chart-head' }, el('h2', {}, 'Últimos envios'), el('span', {}, 'os 20 mais recentes')),
    el(
      'div',
      { className: 'ad-table-wrap' },
      el(
        'table',
        { className: 'ad-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Quando'), el('th', {}, 'Para'), el('th', {}, 'Template'), el('th', {}, 'Status'))),
        el('tbody', {}, ...logRows),
      ),
    ),
  );

  return el('div', {}, providerCard, recoveryCard, templatesCard, logCard);
}
