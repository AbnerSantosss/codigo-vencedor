/* ------------------------------------------------------------------ *
 * Roteamento e casca do painel
 * ------------------------------------------------------------------ */

import { api, describeError, state } from './api.js';
import { app, el } from './ui.js';
import { renderLogin } from './auth-views.js';
import { nav } from './nav.js';

import { screenContent } from './screens/conteudo.js';
import { screenAppearance } from './screens/aparencia.js';
import { screenScarcity } from './screens/escassez.js';
import { screenLinks } from './screens/links.js';
import { screenCheckout } from './screens/checkout.js';
import { screenGateway } from './screens/gateway.js';
import { screenEvents } from './screens/eventos.js';
import { loadDashboardInto, screenDashboard } from './screens/dashboard.js';
import { screenTracking } from './screens/rastreamento.js';
import { screenAccount } from './screens/conta.js';
import { screenUsers } from './screens/usuarios.js';
import { screenEmail } from './screens/email.js';
import { screenRecovery } from './screens/recuperacao.js';

/* ------------------------------------------------------------------ *
 * Telas de configuração
 * ------------------------------------------------------------------ */

export const SCREENS = [
  { id: 'dashboard', label: 'Dashboard', group: 'Vendas' },
  { id: 'recuperacao', label: 'Recuperação', group: 'Vendas' },
  { id: 'checkout', label: 'Checkout', group: 'Vendas' },
  { id: 'gateway', label: 'Gateway', group: 'Vendas' },
  { id: 'rastreamento', label: 'Rastreamento', group: 'Vendas' },
  { id: 'eventos', label: 'Eventos', group: 'Vendas' },
  { id: 'conteudo', label: 'Conteúdo', group: 'Landing page' },
  { id: 'aparencia', label: 'Aparência', group: 'Landing page' },
  { id: 'escassez', label: 'Escassez', group: 'Landing page' },
  { id: 'links', label: 'Links e redes', group: 'Landing page' },
  { id: 'email', label: 'E-mail', group: 'Sistema' },
  { id: 'usuarios', label: 'Usuários', group: 'Sistema', ownerOnly: true },
  { id: 'conta', label: 'Minha conta', group: 'Sistema' },
];

export const canSee = (screen) => !screen.ownerOnly || state.user?.role === 'owner';

/* ------------------------------------------------------------------ *
 * Casca e roteamento
 * ------------------------------------------------------------------ */

/**
 * `load` existe para as telas que dependem de dados que não vêm no
 * `/config` — o que já foi buscado fica em `state` para a navegação não
 * refazer a chamada a cada clique na barra lateral.
 */
export const RENDERERS = {
  dashboard: {
    render: () => screenDashboard(state.dashboard),
    title: 'Dashboard',
    sub: 'Suas vendas e o funil da página.',
    load: async () => {
      if (!state.dashboard) await loadDashboardInto(7);
    },
  },
  conteudo: { render: screenContent, title: 'Conteúdo', sub: 'Preço e informações da oferta.' },
  aparencia: { render: screenAppearance, title: 'Aparência', sub: 'A paleta da landing page.' },
  escassez: { render: screenScarcity, title: 'Escassez', sub: 'Contador, vagas, compradores e o aviso de compra recente.' },
  links: { render: screenLinks, title: 'Links e redes', sub: 'WhatsApp e perfis sociais do rodapé.' },
  checkout: { render: screenCheckout, title: 'Checkout', sub: 'Formulário na página ou botão para um link externo.' },
  gateway: {
    render: () => screenGateway(state.gateway),
    title: 'Gateway',
    sub: 'Provedor de pagamento, ambiente e credenciais.',
    load: async () => {
      if (!state.gateway) state.gateway = await api('/gateway');
    },
  },
  rastreamento: {
    render: () => screenTracking(state.tracking),
    title: 'Rastreamento',
    sub: 'Pixel da Meta, API de Conversões e as demais plataformas.',
    load: async () => {
      if (!state.tracking) state.tracking = await api('/tracking');
    },
  },
  eventos: {
    render: () => screenEvents(state.eventsSummary),
    title: 'Eventos',
    sub: 'O que acontece no site: funil, origem do tráfego e os últimos disparos.',
    load: async () => {
      if (!state.eventsSummary) state.eventsSummary = await api('/events/summary?days=7');
    },
  },
  recuperacao: {
    render: () => screenRecovery(state.recovery),
    title: 'Recuperação de vendas',
    sub: 'Quem preencheu e não gerou o Pix, quem gerou e não pagou — e o que foi feito para trazer de volta.',
    load: async () => {
      if (!state.recovery) state.recovery = await api('/recovery?days=30');
    },
  },
  email: {
    render: () => screenEmail(state.emailCfg),
    title: 'E-mail',
    sub: 'Provedor de envio, templates e as regras dos e-mails automáticos.',
    load: async () => {
      if (!state.emailCfg) state.emailCfg = await api('/email');
    },
  },
  usuarios: {
    render: () => screenUsers(state.users),
    title: 'Usuários',
    sub: 'Quem entra no painel e com que papel. Convites chegam por e-mail com um link para criar a senha.',
    load: async () => {
      if (!state.users) state.users = await api('/users');
    },
  },
  conta: {
    render: () => screenAccount(),
    title: 'Minha conta',
    sub: 'Seus dados de acesso e a troca de senha.',
  },
};

export function navigate(id) {
  const screen = SCREENS.find((s) => s.id === id);
  if (!RENDERERS[id] || !screen || !canSee(screen)) id = 'dashboard';
  if (location.hash !== `#${id}`) {
    location.hash = id;
    return; // o listener de hashchange chama navigate de novo
  }
  renderShell(id);
}

export async function renderShell(active) {
  const spec = RENDERERS[active] ?? RENDERERS.dashboard;
  if (spec.load) {
    try {
      await spec.load();
    } catch (err) {
      // A sessão expirada já mandou o usuário para o login; não há casca
      // para desenhar por cima disso.
      if (err.message === 'sessao_expirada') return;
      paintShell(active, describeError(err));
      return;
    }
  }
  paintShell(active);
}

/**
 * O conteúdo que entra no lugar da tela quando ela não pôde ser montada.
 *
 * O importante aqui não é a mensagem: é que o menu continue desenhado em
 * volta. Antes, uma falha em uma tela deixava o painel inteiro inutilizável.
 */
function cartaoDeFalha(active, motivo) {
  const tentar = el('button', { className: 'ad-btn', type: 'button' }, 'Tentar de novo');
  tentar.addEventListener('click', () => renderShell(active));

  return el(
    'div',
    { className: 'ad-card' },
    el('h2', {}, 'Não deu para carregar esta tela'),
    el('p', { className: 'ad-msg ad-msg--err' }, motivo),
    el('p', { className: 'ad-hint' }, 'O resto do painel continua funcionando: o menu leva para as outras telas.'),
    tentar,
  );
}

export function paintShell(active, falha) {
  /* `menu`, não `nav`: o módulo importa um `nav` (o registro que quebra os
     ciclos) e um `const nav` aqui o sombrearia dentro desta função. */
  const menu = el('nav', { className: 'ad-nav' });
  let lastGroup = null;
  for (const screen of SCREENS.filter(canSee)) {
    if (screen.group !== lastGroup) {
      menu.append(el('div', { className: 'ad-nav-sep' }, screen.group.toUpperCase()));
      lastGroup = screen.group;
    }
    const link = el('a', { href: `#${screen.id}` }, screen.label);
    if (screen.id === active) link.setAttribute('aria-current', 'page');
    menu.append(link);
  }

  const logout = el('button', { className: 'ad-btn ad-btn--ghost ad-btn--block', type: 'button' }, 'Sair');
  logout.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    state.user = null;
    renderLogin();
  });

  const screen = RENDERERS[active] ?? RENDERERS.dashboard;

  /* Uma tela que estoura no meio da montagem não pode levar o painel
     inteiro com ela: o `render()` de cada tela lê `state`, e `state` pode
     estar incompleto por um motivo que o `load` não percebeu. */
  let corpo;
  if (falha) {
    corpo = cartaoDeFalha(active, falha);
  } else {
    try {
      corpo = screen.render();
    } catch (err) {
      /* `describeError` serve para erro que veio do servidor, que fala
         português e diz algo acionável. Um estouro na montagem é outra
         coisa: "Cannot destructure property 'summary' of 'data'" não ajuda
         o dono a decidir nada. A mensagem técnica vai para o console, onde
         quem for diagnosticar a encontra. */
      console.error('[painel] a tela "' + active + '" nao pode ser montada:', err);
      corpo = cartaoDeFalha(active, 'Os dados desta tela chegaram incompletos.');
    }
  }

  app.className = 'ad-shell';
  app.replaceChildren(
    el(
      'aside',
      { className: 'ad-side' },
      el('div', { className: 'ad-side-head' }, el('div', { className: 'ad-logo' }, 'Código', el('i', {}, '///'), ' Vencedor')),
      menu,
      el(
        'div',
        { className: 'ad-side-foot' },
        // A troca de senha mora em "Minha conta"; o e-mail leva até lá.
        el('a', { className: 'ad-who', href: '#conta', title: 'Minha conta' }, state.user?.email ?? ''),
        logout,
      ),
    ),
    el(
      'main',
      { className: 'ad-main' },
      el('header', { className: 'ad-head' }, el('h1', {}, screen.title), el('p', {}, screen.sub)),
      corpo,
      el(
        'p',
        { className: 'ad-hint' },
        'Ver a página: ',
        el('a', { href: '/', target: '_blank', rel: 'noopener' }, 'abrir a landing page'),
      ),
    ),
  );
}

window.addEventListener('hashchange', () => {
  // Link de redefinição/convite colado numa aba já aberta: sai da casca.
  if (/^#(reset|convite)=/.test(location.hash)) return nav.boot();
  if (state.user && state.config) renderShell(location.hash.slice(1) || 'dashboard');
});
