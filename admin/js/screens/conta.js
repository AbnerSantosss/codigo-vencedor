import { api, state } from '../api.js';
import { el, field, fmtFull, formCard, textInput, toast } from '../ui.js';

/* ---------------- Minha conta ---------------- */

export function screenAccount() {
  const me = state.user ?? {};

  const info = el(
    'section',
    { className: 'ad-card' },
    el('h2', {}, 'Seus dados'),
    el('p', { className: 'ad-hint' }, 'O e-mail é o seu login. Para trocar, peça a um administrador que convide o novo endereço.'),
    el(
      'div',
      { className: 'ad-grid' },
      field('E-mail', textInput(me.email, { readOnly: true })),
      field('Papel', textInput(me.role === 'owner' ? 'Administrador' : 'Usuário', { readOnly: true })),
      field('Último acesso', textInput(fmtFull(me.lastLoginAt), { readOnly: true })),
    ),
  );

  const current = el('input', { className: 'ad-input', type: 'password', autocomplete: 'current-password', required: true });
  const next = el('input', { className: 'ad-input', type: 'password', autocomplete: 'new-password', required: true });
  const confirm = el('input', { className: 'ad-input', type: 'password', autocomplete: 'new-password', required: true });

  const pw = formCard(
    'Trocar senha',
    'Trocar a senha encerra as outras sessões abertas — inclusive em outros aparelhos.',
    [
      el(
        'div',
        { className: 'ad-grid' },
        field('Senha atual', current),
        field('Nova senha', next, 'Mínimo de 12 caracteres, com maiúscula, minúscula e número.'),
        field('Confirme a nova senha', confirm),
      ),
    ],
    async () => {
      if (next.value !== confirm.value) {
        toast('A confirmação não confere com a nova senha.', true);
        return;
      }
      try {
        await api('/auth/password', {
          method: 'PUT',
          body: JSON.stringify({ currentPassword: current.value, newPassword: next.value }),
        });
        current.value = next.value = confirm.value = '';
        toast('Senha atualizada.');
      } catch (err) {
        if (err.data?.error === 'senha_atual_incorreta') toast('A senha atual está incorreta.', true);
        else throw err;
      }
    },
  );
  pw.saveButton.textContent = 'Salvar nova senha';

  return el('div', {}, info, pw);
}
