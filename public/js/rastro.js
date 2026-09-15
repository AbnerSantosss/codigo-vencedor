/* ==========================================================================
   Rastro das paginas de documento (/termos, /privacidade)

   Estas duas paginas nao carregavam script nenhum. O efeito pratico: quem
   abria os termos por link direto — o rodape do e-mail, a analise do Meta, o
   resultado de busca — nao existia em lugar nenhum do painel. A rota nao
   aparecia na tela de Cliques, a visita nao entrava no funil, e o GTM nem era
   carregado, entao nenhuma tag disparava ali.

   Aqui vai so o minimo para fechar esse buraco, e nao uma copia do `lp.js`:
   a visita, os cliques e o GTM. Nada de tema, checkout ou escassez — nesta
   pagina nao ha nada disso para configurar.

   As chaves de sessao sao as mesmas do `lp.js` e do `obrigado.js` de
   proposito: quem veio da landing, leu os termos e voltou continua sendo uma
   pessoa so na jornada do painel, e nao tres visitantes distintos.
   ========================================================================== */
(function () {
  'use strict';

  window.dataLayer = window.dataLayer || [];

  var PAGINA = location.pathname || '/';

  /* Sem regex para ler cookie: montar padrao a partir do nome e um convite a
     erro de escape, e aqui basta comparacao exata. */
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

  var qs = new URLSearchParams(location.search);

  var UTMS = (function () {
    try { return JSON.parse(sessionStorage.getItem('cv_utm') || '{}'); } catch (e) { return {}; }
  })();

  function fbcValue() {
    var cookie = readCookie('_fbc');
    if (cookie) return cookie;
    var fbclid = UTMS.fbclid || qs.get('fbclid') || '';
    return fbclid ? 'fb.1.' + Date.now() + '.' + fbclid : '';
  }

  function sessionId() {
    try {
      var atual = sessionStorage.getItem('cv_sid');
      if (atual) return atual;
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

  function sendToServer(event, id, params) {
    var corpo = JSON.stringify({
      event: event,
      event_id: id,
      session_id: sessionId(),
      params: params || {},
      utm: UTMS,
      fbp: readCookie('_fbp'),
      fbc: fbcValue(),
      page: PAGINA,
      referrer: document.referrer || ''
    });
    /* `sendBeacon` primeiro: sair da pagina de termos clicando em "voltar" e
       o comportamento normal aqui, e um `fetch` comum morreria no meio. */
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
    } catch (e) { /* rastreamento nunca pode derrubar a leitura do documento */ }
  }

  /* O mesmo par de sempre: empurra para o dataLayer, para o GTM ver, e manda
     para o servidor, que e quem alimenta o painel. O `event_id` e um so nos
     dois lados — e assim que a deduplicacao funciona. */
  function track(event, params) {
    var id = eventId();
    var payload = { event: event, event_id: id };
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined) payload[k] = params[k];
      }
    }
    window.dataLayer.push(payload);
    sendToServer(event, id, params || {});
    return id;
  }

  /* Texto visivel do elemento, ignorando o que existe so para leitor de tela
     — senao o rotulo do clique vem com o texto do icone junto. */
  function visibleText(el) {
    var out = '';
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true') out += visibleText(n);
    }
    return out;
  }

  track('page_view', { page_title: document.title });

  /* Mesmos parametros de clique do `lp.js`, para as linhas cairem nas mesmas
     colunas da tela de Cliques. Aqui nao ha `data-cv-cta`: nenhum botao
     destas paginas e CTA de compra, e inventar um sujaria o "Clicaram no
     CTA" do funil. */
  document.addEventListener(
    'click',
    function (ev) {
      var el = ev.target && ev.target.closest ? ev.target.closest('a, button') : null;
      if (!el) return;
      var label = (el.getAttribute('aria-label') || visibleText(el)).replace(/\s+/g, ' ').trim().slice(0, 80);
      var href = el.tagName === 'A' ? (el.getAttribute('href') || '') : '';
      track('click', {
        click_label: label,
        click_type: el.tagName === 'A' ? 'link' : 'botao',
        click_section: 'documento',
        click_url: href || undefined,
        click_external: href ? (href.indexOf('http') === 0 && href.indexOf(location.origin) !== 0) : undefined
      });
    },
    true
  );

  /* O nonce vem do servidor a cada request; sem ele a CSP barra o gtm.js. O
     mapa por container evita carregar duas vezes e deixa o segundo id
     funcionar — com uma flag unica ele ficava de fora sem erro no console. */
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
      if (!iniciou) { window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' }); iniciou = true; }
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtm.js?id=' + encodeURIComponent(id);
      if (nonce) { s.setAttribute('nonce', nonce); s.nonce = nonce; }
      document.head.appendChild(s);
    }
  }

  fetch('/api/config', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      var t = (cfg && cfg.tracking) || {};
      loadGtm(t.gtmIds && t.gtmIds.length ? t.gtmIds : t.gtmId);
    })
    .catch(function () { /* documento sem GTM continua legivel */ });
})();
