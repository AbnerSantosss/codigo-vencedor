import { api, describeError, state } from '../api.js';
import { el, field, fmtWhen, formCard, num, reloadAndPaint, select, textInput, toast } from '../ui.js';

/* ---------------- Usuários ---------------- */

export const USER_STATUS = {
  ativo: ['Ativo', 'is-paid'],
  convite_enviado: ['Convite enviado', 'is-pending'],
  convite_expirado: ['Convite expirado', 'is-warn'],
  bloqueado: ['Bloqueado', 'is-warn'],
};

export function screenUsers(data) {
  const isOwner = state.user?.role === 'owner';
  const refresh = () => reloadAndPaint('users', '/users', 'usuarios');

  /* convite */
  const name = textInput('', { placeholder: 'Nome', maxLength: 80, required: true });
  const email = el('input', { className: 'ad-input', type: 'email', placeholder: 'email@exemplo.com', required: true });
  const role = select('editor', [
    ['editor', 'Usuário — edita a página e vê as métricas'],
    ['owner', 'Administrador — tudo, inclusive usuários e gateway'],
  ]);

  const invite = formCard(
    'Convidar pessoa',
    'Ela recebe um e-mail com um link válido por 48 horas para criar a própria senha. Nenhuma senha viaja por e-mail.',
    [el('div', { className: 'ad-grid' }, field('Nome', name), field('E-mail', email), field('Papel', role))],
    async () => {
      const res = await api('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ name: name.value.trim(), email: email.value.trim(), role: role.value }),
      });
      if (res.email?.ok) toast('Convite enviado.');
      else {
        toast(
          `Usuário criado, mas o e-mail não saiu (${res.email?.error || 'provedor não configurado'}). Configure a aba E-mail e use "Reenviar convite".`,
          true,
        );
      }
      await refresh();
    },
  );
  invite.saveButton.textContent = 'Enviar convite';

  /* lista */
  const rows = data.users.map((u) => {
    const isMe = u.id === data.me;
    const [label, cls] = USER_STATUS[u.status] ?? [u.status, ''];

    const roleSel = select(u.role, [
      ['editor', 'Usuário'],
      ['owner', 'Administrador'],
    ]);
    roleSel.classList.add('ad-role-select');
    roleSel.disabled = !isOwner || isMe;
    roleSel.addEventListener('change', async () => {
      try {
        await api(`/users/${u.id}/role`, { method: 'PUT', body: JSON.stringify({ role: roleSel.value }) });
        toast('Papel atualizado.');
        await refresh();
      } catch (err) {
        toast(describeError(err), true);
        roleSel.value = u.role;
      }
    });

    const actions = el('div', { className: 'ad-actions' });

    if (u.status === 'convite_enviado' || u.status === 'convite_expirado') {
      const resend = el('button', { className: 'ad-btn ad-btn--ghost ad-btn--sm', type: 'button' }, 'Reenviar convite');
      resend.addEventListener('click', async () => {
        resend.disabled = true;
        try {
          const res = await api(`/users/${u.id}/resend-invite`, { method: 'POST' });
          toast(
            res.email?.ok ? 'Convite reenviado.' : `O e-mail não saiu: ${res.email?.error || 'provedor não configurado'}`,
            !res.email?.ok,
          );
          await refresh();
        } catch (err) {
          toast(describeError(err), true);
          resend.disabled = false;
        }
      });
      actions.append(resend);
    }

    if (!isMe) {
      // Dois cliques para excluir, sem diálogo do navegador: o primeiro arma,
      // o segundo confirma; seis segundos sem o segundo e desarma.
      const del = el('button', { className: 'ad-btn ad-btn--ghost ad-btn--sm ad-btn--danger', type: 'button' }, 'Excluir');
      let armed = false;
      del.addEventListener('click', async () => {
        if (!armed) {
          armed = true;
          del.textContent = 'Confirmar exclusão';
          setTimeout(() => {
            armed = false;
            del.textContent = 'Excluir';
          }, 6000);
          return;
        }
        del.disabled = true;
        try {
          await api(`/users/${u.id}`, { method: 'DELETE' });
          toast(`${u.email} excluído.`);
          await refresh();
        } catch (err) {
          toast(describeError(err), true);
          del.disabled = false;
        }
      });
      actions.append(del);
    }

    return el(
      'tr',
      {},
      el('td', {}, el('b', {}, u.name || '—'), el('br'), el('span', { className: 'ad-muted-cell' }, u.email + (isMe ? ' (você)' : ''))),
      el('td', {}, roleSel),
      el(
        'td',
        {},
        el('span', { className: `ad-badge ${cls}` }, label),
        u.status === 'convite_enviado' && u.inviteExpiresAt
          ? el('div', { className: 'ad-list-note' }, `expira ${fmtWhen(u.inviteExpiresAt)}`)
          : null,
      ),
      el(
        'td',
        { className: 'ad-muted-cell' },
        u.lastLoginAt ? fmtWhen(u.lastLoginAt) : u.inviteSentAt ? `convidado ${fmtWhen(u.inviteSentAt)}` : '—',
      ),
      el('td', {}, actions),
    );
  });

  const list = el(
    'section',
    { className: 'ad-card ad-card--wide' },
    el(
      'div',
      { className: 'ad-chart-head' },
      el('h2', {}, 'Quem tem acesso'),
      el('span', {}, `${num(data.users.length)} ${data.users.length === 1 ? 'pessoa' : 'pessoas'}`),
    ),
    el(
      'div',
      { className: 'ad-table-wrap' },
      el(
        'table',
        { className: 'ad-table' },
        el(
          'thead',
          {},
          el('tr', {}, el('th', {}, 'Pessoa'), el('th', {}, 'Papel'), el('th', {}, 'Status'), el('th', {}, 'Último acesso'), el('th', {}, '')),
        ),
        el('tbody', {}, ...rows),
      ),
    ),
    el(
      'p',
      { className: 'ad-hint ad-mt' },
      'Precisa haver sempre ao menos um administrador; não dá para excluir a própria conta nem rebaixar o último administrador.',
    ),
  );

  return el('div', {}, invite, list);
}
