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

  /* Cópia literal do `lp.js`: sem bundler e sem sistema de módulos um
     arquivo não enxerga a função do outro, e um `<script>` a mais aqui não
     passaria pela CSP com nonce. Sem regex de propósito — montar padrão a
     partir do nome do cookie é um convite a erro de escape e aqui só
     precisamos de uma comparação exata. */
  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > 0 && parts[i].slice(0, eq) === name) {
        try { return decodeURIComponent(parts[i].slice(eq + 1)); } catch (e) { return parts[i].slice(eq + 1); }
      }
    }
    return '';
  }

  /* As UTMs da chegada continuam na mesma aba, gravadas pelo `lp.js` — a
     confirmação não tem query string de campanha nenhuma. */
  var UTMS = (function () {
    try { return JSON.parse(sessionStorage.getItem('cv_utm') || '{}'); } catch (e) { return {}; }
  })();

  /* `fb.1.<timestamp>.<fbclid>` é o formato que a Meta espera quando o
     cookie `_fbc` não existe — e ele não existe enquanto o Pixel não for
     montado no GTM, que é o caso hoje. */
  function fbcValue() {
    var cookie = readCookie('_fbc');
    if (cookie) return cookie;
    var fbclid = UTMS.fbclid || qs.get('fbclid') || '';
    return fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : '';
  }

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

  /* Mesmo corpo que o `lp.js` monta em `sendToServer`. O que saía daqui não
     levava `utm`, `fbp` nem `fbc`: a última etapa do funil entrava como
     tráfego direto enquanto as anteriores tinham origem, e a mesma visita
     aparecia vinda de dois lugares diferentes.

     `sendBeacon` primeiro pelo mesmo motivo que justificava o `keepalive`:
     fechar a aba logo depois de ver a confirmação é o comportamento normal
     desta página. O `page` fica fixo em '/obrigado' porque é por ele que o
     painel monta a etapa, independente de como a rota seja servida. */
  function sendToServer(event, id, params) {
    var corpo = JSON.stringify({
      event: event,
      event_id: id,
      session_id: sessionId(),
      params: params || {},
      utm: UTMS,
      fbp: readCookie('_fbp'),
      fbc: fbcValue(),
      page: '/obrigado',
      referrer: document.referrer || ''
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([corpo], { type: 'application/json' }));
        return;
      }
    } catch (e) { /* cai no fetch abaixo */ }
    try {
      fetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: corpo,
        keepalive: true
      }).catch(function () {});
    } catch (e) { /* rastreamento nunca derruba a confirmação */ }
  }

  sendToServer('page_view', eventId(), {});

  /* O nonce vem do servidor a cada request. Sem ele a CSP bloqueia o gtm.js,
     e o próprio GTM o repassa para as tags que ele injetar depois.

     Recebe a lista `gtmIds` do /api/config e também um id solto, porque a
     resposta antiga trazia só `gtmId`. A guarda virou um mapa por container:
     com `window.__cvGtm = true` o segundo container simplesmente não
     carregava, e o sintoma era uma tag que "não dispara" sem erro nenhum no
     console. */
  function loadGtm(ids) {
    var lista = [];
    if (typeof ids === 'string') { lista = [ids]; }
    else if (ids && typeof ids.length === 'number') { lista = [].slice.call(ids); }
    if (!lista.length) return;

    var meta = document.querySelector('meta[name="csp-nonce"]');
    var nonce = meta ? meta.getAttribute('content') : '';
    var carregados = (window.__cvGtm && typeof window.__cvGtm === 'object') ? window.__cvGtm : {};
    window.__cvGtm = carregados;

    var iniciou = false;
    for (var i = 0; i < lista.length; i++) {
      var id = lista[i];
      if (!id || carregados[id]) continue;
      carregados[id] = true;
      /* `gtm.start` uma vez só: é o marco de tempo do dataLayer, que os
         containers compartilham. Repetir sujaria a medição de carregamento. */
      if (!iniciou) { window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' }); iniciou = true; }
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
      if (nonce) { s.setAttribute('nonce', nonce); s.nonce = nonce; }
      document.head.appendChild(s);
    }
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

  function confirmationMessage(message) { $('[data-cv-confirmation-status]').textContent = message; }

  fetch('/api/config')
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; })
    .then(function (cfg) {
      applyTheme(cfg.theme);
      applyWhatsapp(cfg);
      loadGtm(cfg.tracking && (cfg.tracking.gtmIds || cfg.tracking.gtmId));

      if (!publicId) { confirmationMessage('Abra o link do seu pedido para conferir o pagamento.'); return; }

      return fetch('/api/orders/' + encodeURIComponent(publicId) + '/status')
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (order) {
          if (!order || order.status !== 'paid') { confirmationMessage(order && order.status === 'pending' ? 'Seu pagamento ainda está aguardando confirmação.' : 'Não foi possível confirmar este pagamento. Consulte o link do seu pedido.'); return; }
          $('[data-cv-confirmation-status]').hidden = true;
          $('[data-cv-confirmed]').hidden = false;
          $('[data-cv-login]').href = 'https://app.codigovencedor.com/login';
          $('[data-cv-login]').hidden = false;
          $('[data-cv-login-note]').textContent = 'Entre com os dados enviados para o seu e-mail.';

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
            items: [{ item_name: 'Código Vencedor + App', price: order.amountCents / 100, quantity: 1 }]
          });

          /* A venda ia só para o GTM: existia para a Meta e não existia na
             tela de Eventos do painel, que é o nosso próprio registro. Vai
             agora pelo mesmo caminho dos outros eventos do site.

             O servidor grava e, de propósito, não encaminha este `purchase`
             para as APIs de conversão — a conversão real nasce no webhook do
             gateway; se saísse daqui, bastaria chamar a rota para registrar
             uma venda que não houve.

             Reenvio não duplica: `event_id` é único no banco, então
             recarregar a confirmação ou voltar pelo link do e-mail cai na
             mesma linha. Sem `purchaseEventId` o evento nem sai — a rota
             exige o campo e descartaria em silêncio, e um id novo a cada
             carga seria o oposto da deduplicação. */
          if (order.purchaseEventId) {
            sendToServer('purchase', order.purchaseEventId, {
              transaction_id: order.reference || publicId,
              value: order.amountCents / 100,
              currency: order.currency || 'BRL'
            });
          }
        });
    })
    .catch(function () { confirmationMessage('Não conseguimos consultar o pedido agora. Recarregue a página em instantes.'); });
})();
