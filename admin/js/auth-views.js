/* ------------------------------------------------------------------ *
 * Telas de autenticação
 * ------------------------------------------------------------------ */

import { api, describeError, state } from './api.js';
import { app, el, field, toast } from './ui.js';
import { nav } from './nav.js';

/* ------------------------------------------------------------------ *
 * Login e troca de senha
 * ------------------------------------------------------------------ */

export const loginLogo = () => el('div', { className: 'ad-logo' }, 'Código', el('i', {}, '///'), ' Vencedor');

/** `kind` é 'err' (padrão) ou 'ok' — a mensagem pós-redefinição de senha é boa notícia. */
export function renderLogin(message, kind = 'err') {
  const email = el('input', { className: 'ad-input', type: 'email', autocomplete: 'username', required: true });
  const password = el('input', { className: 'ad-input', type: 'password', autocomplete: 'current-password', required: true });
  const button = el('button', { className: 'ad-btn ad-btn--block', type: 'submit' }, 'Entrar');
  const error = el('div', { className: `ad-msg ad-msg--${kind}`, hidden: !message }, message || '');

  const forgot = el('button', { className: 'ad-link-btn', type: 'button' }, 'Esqueci minha senha');
  forgot.addEventListener('click', () => renderForgot(email.value.trim()));

  const form = el(
    'form',
    { className: 'ad-login-card' },
    loginLogo(),
    el('p', { className: 'ad-login-sub' }, 'Painel administrativo'),
    error,
    field('E-mail', email),
    el('div', { className: 'ad-sp' }),
    field('Senha', password),
    el('div', { className: 'ad-sp-lg' }),
    button,
    el('div', { className: 'ad-login-foot' }, forgot),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    button.disabled = true;
    error.hidden = true;
    try {
      const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.value.trim(), password: password.value }),
      });
      state.user = res.user;
      if (res.mustChangePassword) renderPasswordChange(true);
      else await nav.boot();
    } catch (err) {
      const messages = {
        credenciais_invalidas: 'E-mail ou senha incorretos.',
        conta_bloqueada: `Conta bloqueada por ${err.data?.minutes ?? 15} minutos após tentativas seguidas.`,
      };
      error.className = 'ad-msg ad-msg--err';
      error.textContent = messages[err.data?.error] || describeError(err);
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  app.className = 'ad-login';
  app.replaceChildren(form);
  email.focus();
}

/** "Esqueci minha senha": pede o e-mail e mostra sempre a mesma resposta. */
export function renderForgot(prefill = '') {
  const email = el('input', { className: 'ad-input', type: 'email', autocomplete: 'username', required: true, value: prefill });
  const button = el('button', { className: 'ad-btn ad-btn--block', type: 'submit' }, 'Enviar link de redefinição');
  const msg = el('div', { className: 'ad-msg', hidden: true });
  const back = el('button', { className: 'ad-link-btn', type: 'button' }, 'Voltar ao login');
  back.addEventListener('click', () => renderLogin());

  const form = el(
    'form',
    { className: 'ad-login-card' },
    loginLogo(),
    el(
      'p',
      { className: 'ad-login-sub' },
      'Informe o e-mail da sua conta. Se ele tiver acesso ao painel, você recebe um link válido por 30 minutos.',
    ),
    msg,
    field('E-mail', email),
    el('div', { className: 'ad-sp-lg' }),
    button,
    el('div', { className: 'ad-login-foot' }, back),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    button.disabled = true;
    try {
      const res = await api('/auth/forgot', { method: 'POST', body: JSON.stringify({ email: email.value.trim() }) });
      msg.className = 'ad-msg ad-msg--ok';
      msg.textContent = res.message;
      msg.hidden = false;
    } catch (err) {
      msg.className = 'ad-msg ad-msg--err';
      msg.textContent = err.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : describeError(err);
      msg.hidden = false;
      button.disabled = false;
    }
  });

  app.className = 'ad-login';
  app.replaceChildren(form);
  email.focus();
}

/**
 * Define a senha a partir de um link de e-mail.
 * `mode` é 'reset' (esqueci a senha) ou 'convite' (usuário novo criando a
 * primeira senha) — a rota do servidor é a mesma, muda só o texto.
 */
export function renderSetPassword(token, mode) {
  const invite = mode === 'convite';
  const next = el('input', { className: 'ad-input', type: 'password', autocomplete: 'new-password', required: true });
  const confirm = el('input', { className: 'ad-input', type: 'password', autocomplete: 'new-password', required: true });
  const button = el('button', { className: 'ad-btn ad-btn--block', type: 'submit' }, invite ? 'Criar senha' : 'Salvar nova senha');
  const error = el('div', { className: 'ad-msg ad-msg--err', hidden: true });

  const again = el('button', { className: 'ad-link-btn', type: 'button' }, invite ? 'Voltar ao login' : 'Pedir outro link');
  again.addEventListener('click', () => {
    history.replaceState(null, '', '/admin');
    if (invite) renderLogin('Se o convite expirou, peça a um administrador para reenviar.');
    else renderForgot();
  });

  const form = el(
    'form',
    { className: 'ad-login-card' },
    loginLogo(),
    el(
      'p',
      { className: 'ad-login-sub' },
      invite ? 'Bem-vindo ao painel. Crie a senha que você vai usar para entrar.' : 'Escolha a nova senha do seu acesso ao painel.',
    ),
    error,
    field('Nova senha', next, 'Mínimo de 12 caracteres, com maiúscula, minúscula e número.'),
    el('div', { className: 'ad-sp' }),
    field('Confirme a senha', confirm),
    el('div', { className: 'ad-sp-lg' }),
    button,
    el('div', { className: 'ad-login-foot' }, again),
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (next.value !== confirm.value) {
      error.textContent = 'A confirmação não confere com a senha.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    error.hidden = true;
    try {
      await api('/auth/reset', { method: 'POST', body: JSON.stringify({ token, newPassword: next.value }) });
      history.replaceState(null, '', '/admin');
      renderLogin(invite ? 'Senha criada. Entre com seu e-mail e a nova senha.' : 'Senha redefinida. Entre com a nova senha.', 'ok');
    } catch (err) {
      error.textContent = describeError(err);
      error.hidden = false;
      button.disabled = false;
    }
  });

  app.className = 'ad-login';
  app.replaceChildren(form);
  next.focus();
}

export function renderPasswordChange(forced) {
  const current = el('input', { className: 'ad-input', type: 'password', autocomplete: 'current-password', required: true });
  const next = el('input', { className: 'ad-input', type: 'password', autocomplete: 'new-password', required: true });
  const confirm = el('input', { className: 'ad-input', type: 'password', autocomplete: 'new-password', required: true });
  const button = el('button', { className: 'ad-btn ad-btn--block', type: 'submit' }, 'Salvar nova senha');
  const error = el('div', { className: 'ad-msg ad-msg--err', hidden: true });

  const form = el(
    'form',
    { className: 'ad-login-card' },
    el('div', { className: 'ad-logo' }, 'Trocar senha'),
    el(
      'p',
      { className: 'ad-login-sub' },
      forced
        ? 'A senha inicial veio por variável de ambiente e passou por log de deploy. Escolha uma nova antes de continuar.'
        : 'Trocar a senha encerra as outras sessões abertas.',
    ),
    error,
    field('Senha atual', current),
    el('div', { className: 'ad-sp' }),
    field('Nova senha', next, 'Mínimo de 12 caracteres, com maiúscula, minúscula e número.'),
    el('div', { className: 'ad-sp' }),
    field('Confirme a nova senha', confirm),
    el('div', { className: 'ad-sp-lg' }),
    button,
  );

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (next.value !== confirm.value) {
      error.textContent = 'A confirmação não confere com a nova senha.';
      error.hidden = false;
      return;
    }
    button.disabled = true;
    error.hidden = true;
    try {
      await api('/auth/password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
      });
      toast('Senha atualizada.');
      await nav.boot();
    } catch (err) {
      error.textContent =
        err.data?.error === 'senha_atual_incorreta' ? 'A senha atual está incorreta.' : describeError(err);
      error.hidden = false;
    } finally {
      button.disabled = false;
    }
  });

  app.className = 'ad-login';
  app.replaceChildren(form);
  current.focus();
}
