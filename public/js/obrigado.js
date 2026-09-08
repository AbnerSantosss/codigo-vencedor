/* ==========================================================================
   Página de obrigado.

   Só mostra os dados do pedido depois que o servidor confirma que ele está
   pago — a query string não é prova de nada. O `purchase` do dataLayer usa o
   event_id que o servidor gerou no webhook, para o GTM (e um eventual Pixel
   dentro dele) bater com a conversão que a API de Conversões já enviou.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var qs = new URLSearchParams(location.search);
  var publicId = qs.get('p') || '';

  window.dataLayer = window.dataLayer || [];

  function brl(cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /* ---------------------------------------------------------------------
     Registro da visita

     Esta página não registrava nada no funil. O efeito era que a última
     etapa não tinha como ser medida: dava para saber quantos geraram Pix e
     quantos pagaram, mas não quantos de fato chegaram na confirmação — e é
     essa diferença que revela alguém pagando e não voltando para a página.

     O `session_id` usa a mesma chave que o `lp.js` guarda, então a visita
     aqui continua a mesma sessão que veio da landing page em vez de abrir
     uma nova. O `visitorId` não é enviado: é um cookie `httpOnly` que o
     servidor lê sozinho.
     --------------------------------------------------------------------- */
  function sessionId() {
    try {
      var atual = sessionStorage.getItem('cv_sid');
      if (atual) return atual;
      /* Sem sessão gravada: a pessoa abriu a confirmação direto (link do
         e-mail, aba restaurada, outro dispositivo). Cria uma para a visita
         não ficar sem sessão nenhuma, que é o que fazia o funil descartar
         a linha. */
      var novo = 'cv-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('cv_sid', novo);
      return novo;
    } catch (e) {
      return '';
    }
  }

  function eventId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function trackPageView() {
    var corpo = JSON.stringify({
      event: 'page_view',
      event_id: eventId(),
      session_id: sessionId(),
      page: '/obrigado',
      referrer: document.referrer || ''
    });
    /* `keepalive` para a requisição sobreviver se a pessoa fechar a aba logo
       depois de ver a confirmação — que é o comportamento normal aqui. */
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpo,
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* rastreamento nunca derruba a confirmação */ }
  }

  trackPageView();

  function loadGtm(id) {
    if (!id || window.__cvGtm) return;
    window.__cvGtm = true;
    var meta = document.querySelector('meta[name="csp-nonce"]');
    var nonce = meta ? meta.getAttribute('content') : '';
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
    if (nonce) { s.setAttribute('nonce', nonce); s.nonce = nonce; }
    document.head.appendChild(s);
  }

  function applyWhatsapp(cfg) {
    var wa = $('[data-cv-whatsapp]');
    if (!wa || !cfg.whatsapp) return;
    var digits = (cfg.whatsapp.url || '').replace(/\D/g, '');
    if (digits.length >= 10) {
      wa.href = 'https://wa.me/' + digits + (cfg.whatsapp.message ? '?text=' + encodeURIComponent(cfg.whatsapp.message) : '');
      wa.hidden = false;
    } else if (/^https?:\/\//.test(cfg.whatsapp.url || '')) {
      wa.href = cfg.whatsapp.url;
      wa.hidden = false;
    }
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    Object.keys(theme || {}).forEach(function (k) {
      if (/^[a-z0-9-]+$/i.test(k)) root.style.setProperty('--cv-' + k, theme[k]);
    });
  }

  fetch('/api/config')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (cfg) {
      applyTheme(cfg.theme);
      applyWhatsapp(cfg);
      loadGtm(cfg.tracking && cfg.tracking.gtmId);

      if (!publicId) return;

      return fetch('/api/orders/' + encodeURIComponent(publicId) + '/status')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (order) {
          if (!order || order.status !== 'paid') return;

          $('[data-cv-order]').textContent = order.reference || publicId.slice(0, 8).toUpperCase();
          $('[data-cv-amount]').textContent = brl(order.amountCents);

          if (order.firstName) {
            $('[data-cv-firstname]').textContent = order.firstName;
            $('[data-cv-firstname-sep]').hidden = false;
          }
          if (order.emailMasked) $('[data-cv-email]').textContent = order.emailMasked;

          /* O event_id vem do servidor: é o mesmo que a API de Conversões
             usou. Sem ele o GTM criaria um evento novo e a Meta contaria a
             venda duas vezes. */
          window.dataLayer.push({
            event: 'purchase',
            event_id: order.purchaseEventId || undefined,
            transaction_id: order.reference || publicId,
            value: order.amountCents / 100,
            currency: order.currency || 'BRL',
            items: [{ item_name: 'Curso Código Vencedor + App', price: order.amountCents / 100, quantity: 1 }]
          });
        });
    })
    .catch(function () { /* a confirmação visual não depende do rastreamento */ });
})();
