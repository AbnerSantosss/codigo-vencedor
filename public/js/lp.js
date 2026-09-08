/* ==========================================================================
   Código Vencedor — runtime da landing page
   Sem dependência externa. Tudo que é configurável vem de GET /api/config;
   se a API não responder, a página cai nos defaults e continua funcionando.
   ========================================================================== */
(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------------------------------------------------------------
     Config
     --------------------------------------------------------------------- */
  var CFG = {
    priceCents: 2790,
    priceFromCents: 27390,
    currency: 'BRL',
    theme: {},
    scarcity: { countdown: true, spots: true, buyers: true, bar: true },
    countdown: { mode: 'per_visitor', minutes: 15, endsAt: null },
    spots: 7,
    buyers: 43,
    /* Avisos de compra recente. A lista vem do painel; vazia por padrão de
       propósito — nome de comprador não se inventa. */
    socialProof: { enabled: false, intervalSec: 9, items: [] },
    whatsapp: { url: '', message: '' },
    social: {},
    tracking: { gtmId: '' },
    checkout: { mode: 'embedded', externalUrl: '', buttonLabel: '', openInNewTab: false, pollMs: 4000 }
  };

  var brl = function (cents) {
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  /* ---------------------------------------------------------------------
     Rastreamento

     No navegador existe UMA coisa só: o dataLayer do GTM. Gatilhos, tags e
     um eventual Pixel da Meta são montados por você dentro do GTM.

     Quem fala com a Meta é o servidor, pela API de Conversões. Todo push
     carrega um event_id que também vai para /api/track — se você criar uma
     tag de Pixel no GTM, use esse event_id como eventID dela e a Meta trata
     os dois como o mesmo evento em vez de contar duas vezes.

     Purchase nunca nasce aqui: nasce no webhook do gateway.
     --------------------------------------------------------------------- */
  window.dataLayer = window.dataLayer || [];

  /* Sem regex de propósito: montar padrão a partir do nome do cookie é um
     convite a erro de escape, e aqui só precisamos de uma comparação exata. */
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

  /* Identifica a visita para as métricas de funil do admin (visitas únicas,
     etapa a etapa). Vive só na aba: sessionStorage, não cookie. */
  var SESSION_ID = (function () {
    try {
      var id = sessionStorage.getItem('cv_sid');
      if (!id) {
        id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
          : 's-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem('cv_sid', id);
      }
      return id;
    } catch (e) {
      return 's-' + Date.now();
    }
  })();

  var newEventId = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'e-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
  };

  function track(event, params) {
    var eventId = (params && params.event_id) || newEventId();
    var payload = Object.assign({ event: event, event_id: eventId }, params || {});
    window.dataLayer.push(payload);
    sendToServer(event, eventId, params || {});
    return eventId;
  }

  /* Espelho no servidor: alimenta as métricas do admin e o fan-out para
     Meta CAPI, GA4, TikTok e Kwai. sendBeacon sobrevive ao usuário fechar a
     aba no meio do caminho — fetch normal não. */
  /* O `_fbc` que a Meta espera. Quando o cookie não existe (ninguém montou
     a tag do Pixel no GTM, que é o caso hoje), sintetiza a partir do
     `fbclid` da URL — é o formato `fb.1.<timestamp>.<fbclid>` documentado.

     Vive numa função só porque estava duplicado: o envio de evento
     sintetizava e o rascunho do lead não, então a mesma visita gerava `fbc`
     em um lugar e vazio no outro. */
  function fbcValue() {
    return readCookie('_fbc') || (UTMS.fbclid ? 'fb.1.' + Date.now() + '.' + UTMS.fbclid : '');
  }

  function sendToServer(event, eventId, params) {
    var body = JSON.stringify({
      event: event,
      event_id: eventId,
      session_id: SESSION_ID,
      params: params,
      utm: UTMS,
      fbp: readCookie('_fbp'),
      fbc: fbcValue(),
      page: location.pathname,
      referrer: document.referrer || ''
    });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
        return;
      }
    } catch (e) { /* cai no fetch abaixo */ }
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true
    }).catch(function () { /* rastreamento nunca quebra a página */ });
  }

  /* O nonce vem do servidor a cada request. Sem ele a CSP bloqueia o gtm.js,
     e o próprio GTM o repassa para as tags que ele injetar depois. */
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

  /* ---------------------------------------------------------------------
     UTMs — capturadas na chegada e mantidas para o checkout
     --------------------------------------------------------------------- */
  var UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'];

  function captureUtms() {
    var qs = new URLSearchParams(location.search);
    var found = {};
    UTM_KEYS.forEach(function (k) { if (qs.get(k)) found[k] = qs.get(k); });
    try {
      if (Object.keys(found).length) sessionStorage.setItem('cv_utm', JSON.stringify(found));
      return JSON.parse(sessionStorage.getItem('cv_utm') || '{}');
    } catch (e) { return found; }
  }
  var UTMS = captureUtms();

  /* ---------------------------------------------------------------------
     Aplicação da config na página
     --------------------------------------------------------------------- */
  /** Executa um passo da configuração sem deixar que ele derrube os demais. */
  function safely(nome, fn) {
    try {
      fn();
    } catch (e) {
      if (window.console && console.warn) console.warn('[cv] falha ao aplicar ' + nome + ':', e);
    }
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    Object.keys(theme || {}).forEach(function (k) {
      if (/^[a-z0-9-]+$/i.test(k)) root.style.setProperty('--cv-' + k, theme[k]);
    });
  }

  /* Recebe uma raiz porque o modal da VSL nasce depois do boot: quando ele é
     clonado do <template>, o preço dentro dele ainda é o do HTML estático.
     Sem isto, um preço trocado no painel apareceria certo na página e errado
     no modal. */
  function applyPrices(root) {
    $$('[data-cv-price]', root).forEach(function (el) { el.textContent = brl(CFG.priceCents); });
    $$('[data-cv-price-from]', root).forEach(function (el) { el.textContent = brl(CFG.priceFromCents); });
    $$('[data-cv-discount]', root).forEach(function (el) { el.textContent = '− ' + brl(CFG.priceFromCents - CFG.priceCents); });
  }

  function applyConfig() {
    applyPrices(document);
    $$('[data-cv-spots]').forEach(function (el) { el.textContent = CFG.spots; });
    $$('[data-cv-buyers]').forEach(function (el) { el.textContent = CFG.buyers; });

    /* Escassez: cada bloco liga/desliga sozinho pelo admin. */
    $$('[data-cv-scarcity]').forEach(function (el) {
      el.hidden = !CFG.scarcity[el.getAttribute('data-cv-scarcity')];
    });

    /* WhatsApp — sem número configurado, o botão simplesmente não aparece,
       em vez de virar um link morto. */
    var wa = $('[data-cv-whatsapp]');
    if (wa) {
      var digits = (CFG.whatsapp.url || '').replace(/\D/g, '');
      if (digits.length >= 10) {
        wa.href = 'https://wa.me/' + digits + (CFG.whatsapp.message ? '?text=' + encodeURIComponent(CFG.whatsapp.message) : '');
        wa.hidden = false;
      } else if (/^https?:\/\//.test(CFG.whatsapp.url)) {
        wa.href = CFG.whatsapp.url;
        wa.hidden = false;
      }
    }

    /* Redes sociais — idem: sem URL, o ícone não é renderizado. */
    $$('[data-cv-social]').forEach(function (el) {
      var url = CFG.social[el.getAttribute('data-cv-social')];
      if (url && /^https?:\/\//.test(url)) { el.href = url; el.hidden = false; }
    });

    /* Cada bloco é isolado: um erro em um deles (config estranha vinda da
       API, elemento ausente numa página que não é a LP) não pode derrubar os
       outros e deixar a página sem tema ou sem rastreamento. */
    safely('checkout', function () { applyCheckoutMode(document); });
    safely('tema', function () { applyTheme(CFG.theme); });
    safely('gtm', function () { loadGtm(CFG.tracking.gtmId); });
  }

  /**
   * Modo do checkout.
   *
   * `embedded`: nada muda — o formulário e o QR ficam na página.
   * `link`: a seção de checkout some e todos os CTAs passam a apontar para
   * a URL externa (link de pagamento da Appmax, Hotmart, Kiwify...). Serve
   * para vender antes de a integração de gateway existir, e para quem
   * prefere o checkout hospedado do provedor.
   *
   * Sem URL configurada o modo é ignorado: melhor manter o formulário do que
   * deixar a página sem nenhum caminho de compra.
   */
  function isHttpUrl(value) {
    return typeof value === 'string' && (value.slice(0, 8) === 'https://' || value.slice(0, 7) === 'http://');
  }

  /* Recebe uma raiz pelo mesmo motivo de applyPrices: o CTA dentro do modal
     da VSL é clonado depois do boot e, sem esta passada, continuaria
     apontando para um #checkout que o modo "link" acabou de esconder. */
  function applyCheckoutMode(root) {
    var url = (CFG.checkout && CFG.checkout.externalUrl) || '';
    if (!CFG.checkout || CFG.checkout.mode !== 'link' || !isHttpUrl(url)) return;

    /* O card da oferta continua (resumo, selos e gatilhos); some so o
       formulario, e o botao do resumo — que existe para este modo — aparece.
       A classe avisa o CSS para fechar o grid em uma coluna. */
    if (!root || root === document) {
      var box = document.getElementById('checkout');
      if (box) box.classList.add('cv-checkout-box--link');
      var form = document.querySelector('.cv-checkout-form');
      if (form) form.hidden = true;
      $$('[data-cv-link-cta]').forEach(function (a) { a.hidden = false; });
    }

    var label = (CFG.checkout.buttonLabel || '').trim();
    var newTab = CFG.checkout.openInNewTab === true;

    $$('a[href="#checkout"]', root || document).forEach(function (a) {
      a.href = url;
      if (newTab) { a.target = '_blank'; a.rel = 'noopener'; }
      if (label) {
        /* Preserva a seta decorativa; troca só o texto. */
        var arrow = a.querySelector('span[aria-hidden="true"]');
        a.textContent = label;
        if (arrow) { a.append(' '); a.append(arrow); }
      }
    });
  }

  /* ---------------------------------------------------------------------
     Contador
     --------------------------------------------------------------------- */
  var deadline = null;

  function fmt(ms) {
    ms = Math.max(0, ms);
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function initCountdown() {
    if (!CFG.scarcity.countdown) return;

    if (CFG.countdown.mode === 'campaign' && CFG.countdown.endsAt) {
      deadline = new Date(CFG.countdown.endsAt).getTime();
    } else {
      var KEY = 'cv_offer_deadline';
      var stored = 0;
      try { stored = +localStorage.getItem(KEY) || 0; } catch (e) {}
      if (!stored || stored < Date.now()) {
        stored = Date.now() + (CFG.countdown.minutes || 15) * 60000;
        try { localStorage.setItem(KEY, String(stored)); } catch (e) {}
      }
      deadline = stored;
    }

    var tick = function () {
      var left = deadline - Date.now();
      $$('[data-cv-countdown]').forEach(function (el) { el.textContent = fmt(left); });
      if (left <= 0 && CFG.countdown.mode === 'campaign') {
        $$('[data-cv-scarcity="countdown"], [data-cv-scarcity="bar"]').forEach(function (el) { el.hidden = true; });
        clearInterval(timer);
      }
    };
    tick();
    var timer = setInterval(tick, 1000);
  }

  /* ---------------------------------------------------------------------
     FAQ
     --------------------------------------------------------------------- */
  function initFaq() {
    $$('.cv-faq-q').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        $$('.cv-faq-q').forEach(function (other) {
          other.setAttribute('aria-expanded', 'false');
          var i = $('.cv-faq-icon', other); if (i) i.textContent = '+';
          var a = document.getElementById(other.getAttribute('aria-controls'));
          if (a) a.hidden = true;
        });
        if (!open) {
          btn.setAttribute('aria-expanded', 'true');
          var icon = $('.cv-faq-icon', btn); if (icon) icon.textContent = '−';
          var ans = document.getElementById(btn.getAttribute('aria-controls'));
          if (ans) ans.hidden = false;
        }
      });
    });
  }

  /* ---------------------------------------------------------------------
     VSL — o vídeo abre num modal, sem controle de tempo

     Regra do dono: dentro do modal não se volta nem se adianta. Por isso
     `controls` fica desligado e a barra de progresso é um indicador, não um
     slider: sem foco, sem clique, `pointer-events: none` no CSS.

     A barra usa `p^0.35` em vez do progresso real: aos 25% do vídeo ela
     marca 61%, aos 50% marca 78%. Anda rápido no começo e arrasta no fim,
     que é a leitura de "já está acabando" que uma VSL quer. É uma barra de
     ritmo, não de tempo — e é por isso que nenhum número de minuto aparece
     ao lado dela: dizer "faltam 2:14" seria informação falsa.

     Os bytes do vídeo só saem da rede no clique: 480p no celular, 720p no
     desktop. Quem nunca assiste não paga por isso.
     --------------------------------------------------------------------- */
  function initVideo() {
    var frame = $('[data-cv-video]');
    var tpl = document.getElementById('cv-vsl-tpl');
    if (!frame || !tpl) return;

    var open = false;
    var modal = null, video = null, bar = null, raf = 0, lastFocus = null, marks = {};

    function paint() {
      if (!video || !bar) return;
      var d = video.duration;
      if (d && isFinite(d) && d > 0) {
        var real = Math.min(1, video.currentTime / d);
        bar.style.setProperty('--cv-vsl-p', String(Math.pow(real, 0.35)));

        /* Marcos de audiência. Servem para saber onde a VSL perde gente —
           `select_promotion` já está na allowlist de /api/track. */
        [25, 50, 75].forEach(function (m) {
          if (!marks[m] && real >= m / 100) {
            marks[m] = true;
            track('select_promotion', { promotion_name: 'vsl_' + m });
          }
        });
      }
      raf = requestAnimationFrame(paint);
    }

    /* Foco preso no modal: sem isto o Tab escapa para o formulário atrás e a
       pessoa digita num campo que não está vendo. */
    function trapFocus(ev) {
      if (ev.key !== 'Tab' || !modal) return;
      var focusable = $$('button, a[href]', modal).filter(function (el) { return !el.disabled; });
      if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
    }

    function onKey(ev) {
      if (ev.key === 'Escape') { close(); return; }
      trapFocus(ev);
    }

    function close() {
      if (!open) return;
      open = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      document.body.classList.remove('cv-locked');
      if (video) { try { video.pause(); } catch (e) {} video.removeAttribute('src'); try { video.load(); } catch (e) {} }
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
      modal = video = bar = null;
      if (lastFocus && lastFocus.isConnected) lastFocus.focus();
    }

    function show() {
      if (open) return;
      open = true;
      marks = {};
      lastFocus = document.activeElement;

      modal = tpl.content.firstElementChild.cloneNode(true);
      var stage = $('[data-cv-vsl-stage]', modal);
      bar = $('[data-cv-vsl-bar]', modal);

      var mobile = window.matchMedia('(max-width: 47.99em)').matches;
      video = document.createElement('video');
      video.src = mobile ? '/assets/video-lp-480p.mp4' : '/assets/video-lp-720p.mp4';
      video.poster = mobile ? '/assets/video-lp-poster-480.jpg' : '/assets/video-lp-poster.jpg';
      video.playsInline = true;
      video.preload = 'auto';
      video.controls = false;
      /* Fica sem controles nativos, então esconder do menu de contexto o
         "salvar vídeo"/"velocidade" evita reabrir por ali o que a UI fechou. */
      video.setAttribute('disablepictureinpicture', '');
      video.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
      video.setAttribute('title', 'Demonstração da ferramenta');
      /* Mudo na largada: sem isso o autoplay é bloqueado e a pessoa vê um
         quadro parado. O botão de som liga o áudio no primeiro toque. */
      video.muted = true;
      stage.insertBefore(video, stage.firstChild);

      var soundBtn = $('[data-cv-vsl-sound]', modal);
      var soundLabel = $('[data-cv-vsl-sound-label]', modal);
      soundBtn.addEventListener('click', function () {
        video.muted = !video.muted;
        soundLabel.textContent = video.muted ? 'Ativar o som' : 'Silenciar';
      });

      /* O escudo cobre o vídeo só para engolir o duplo-toque que, no iOS,
         pula 10 segundos mesmo com os controles desligados. Um toque simples
         nele pausa e retoma — a pessoa precisa poder parar. */
      $('[data-cv-vsl-shield]', modal).addEventListener('click', function () {
        if (video.paused) { video.play().catch(function () {}); } else { video.pause(); }
      });

      $('[data-cv-vsl-close]', modal).addEventListener('click', close);
      $('[data-cv-vsl-cta]', modal).addEventListener('click', close);
      /* Clique no fundo (fora da caixa) também fecha. */
      modal.addEventListener('click', function (ev) { if (ev.target === modal) close(); });

      document.body.appendChild(modal);
      document.body.classList.add('cv-locked');
      document.addEventListener('keydown', onKey, true);
      applyPrices(modal);
      safely('checkout-modal', function () { applyCheckoutMode(modal); });

      video.play().catch(function () { /* sem autoplay: o toque no escudo inicia */ });
      raf = requestAnimationFrame(paint);
      $('[data-cv-vsl-close]', modal).focus();
      track('view_content', { content_name: 'video_demo' });
    }

    /* O quadro inteiro abre a VSL, não só o botão de play: no celular o dedo
       acerta a moldura com muito mais frequência que o círculo. */
    frame.addEventListener('click', show);
  }

  /* ---------------------------------------------------------------------
     Card da Aposta Segura — os números sobem do zero

     O arquivo original do designer rodava no runtime do Claude Design
     (`x-dc`/`DCLogic`). Nada daquilo entra aqui: o card é HTML/CSS puro e
     esta função só escreve texto nos `[data-cv-as]`.

     Anima quando o card entra na tela, não no load: os dois cards da página
     estão longe um do outro e animar o de baixo antes de alguém ver seria
     mostrar a conta já resolvida.
     --------------------------------------------------------------------- */
  var AS_VALUES = {
    safePct:      { v: 8.86,   f: 'pct' },
    somaInversa:  { v: 91.86,  f: 'pct' },
    retornoMin:   { v: 108.86, f: 'brl' },
    lucro:        { v: 8.86,   f: 'brl' },
    odd1:         { v: 4.34,   f: 'num' },
    odd2:         { v: 4.44,   f: 'num' },
    odd3:         { v: 2.16,   f: 'num' },
    ap1:          { v: 25.08,  f: 'brl' },
    ap2:          { v: 24.52,  f: 'brl' },
    ap3:          { v: 50.40,  f: 'brl' },
    p1:           { v: 25.1,   f: 'paren' },
    p2:           { v: 24.5,   f: 'paren' },
    p3:           { v: 50.4,   f: 'paren' },
    r1:           { v: 108.85, f: 'brl' },
    r2:           { v: 108.87, f: 'brl' },
    r3:           { v: 108.86, f: 'brl' },
    totalAposta:  { v: 100,    f: 'brl' },
    totalRetorno: { v: 108.86, f: 'approx' }
  };

  function asFormat(kind, value) {
    switch (kind) {
      /* Vírgula no dinheiro, ponto na odd e na porcentagem: é assim que a
         ferramenta mostra, e o card existe para ser reconhecido. */
      case 'brl':    return 'R$ ' + value.toFixed(2).replace('.', ',');
      case 'approx': return '≈ R$ ' + value.toFixed(2).replace('.', ',');
      case 'pct':    return value.toFixed(2) + '%';
      case 'paren':  return '(' + value.toFixed(1) + '%)';
      default:       return value.toFixed(2);
    }
  }

  function runAsCard(card) {
    var fields = $$('[data-cv-as]', card).map(function (el) {
      var spec = AS_VALUES[el.getAttribute('data-cv-as')];
      return spec ? { el: el, spec: spec } : null;
    }).filter(Boolean);
    if (!fields.length) return;

    var write = function (t) {
      fields.forEach(function (f) { f.el.textContent = asFormat(f.spec.f, f.spec.v * t); });
    };

    /* Os valores finais já estão escritos no HTML. Quem pediu menos movimento
       (ou não tem rAF) simplesmente fica com eles — nada a animar. */
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { write(1); return; }
    if (typeof requestAnimationFrame !== 'function') { write(1); return; }

    var DUR = 1200, start = 0, done = false;
    var finish = function () {
      if (done) return;
      done = true;
      write(1);
    };

    /* Trava de segurança, igual à do arquivo original do designer: se o rAF
       parar no meio (aba em segundo plano, aparelho engasgado), o card fica
       congelado em "R$ 3,20" — que numa página de venda lê como se a
       ferramenta tivesse achado outra conta. Passado o prazo, snap no final. */
    var snap = setTimeout(finish, DUR + 400);

    var step = function (now) {
      if (done) return;
      if (!start) start = now;
      var p = Math.min(1, (now - start) / DUR);
      /* Mesma curva do original: ease-out cúbico. Termina desacelerando, o que
         dá a leitura de "a conta fechou" em vez de um corte seco. */
      write(1 - Math.pow(1 - p, 3));
      if (p < 1) { requestAnimationFrame(step); return; }
      clearTimeout(snap);
      done = true;
    };

    write(0);
    requestAnimationFrame(step);
  }

  function initApostaSeguraCard() {
    var cards = $$('[data-cv-as-card]');
    if (!cards.length) return;

    if (!('IntersectionObserver' in window)) { cards.forEach(runAsCard); return; }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        io.unobserve(entry.target);
        runAsCard(entry.target);
      });
    }, { threshold: .35 });
    cards.forEach(function (card) { io.observe(card); });
  }

  /* ---------------------------------------------------------------------
     Bônus revelado no checkout

     Aparece quando nome e e-mail ficam válidos — o mesmo ponto em que o
     rascunho do lead já é salvo. Uma vez só: reaparecer a cada tecla
     transformaria o argumento em ruído.
     --------------------------------------------------------------------- */
  function initBonus(form) {
    var box = $('[data-cv-bonus]');
    if (!box || !form) return function () {};
    var shown = false;

    return function () {
      if (shown) return;
      var nome = form.elements.nome.value.trim();
      var email = form.elements.email.value.trim();
      if (nome.split(/\s+/).length < 2 || !validEmail(email)) return;
      shown = true;
      box.hidden = false;
      track('select_promotion', { promotion_name: 'bonus_calculadora' });
    };
  }

  /* ---------------------------------------------------------------------
     Barra de compra do celular

     O card da ferramenta entre o texto e o botão é o que o dono pediu e é o
     que convence — mas empurra o CTA do hero para uns 1150px de altura, fora
     da primeira dobra de qualquer celular. Esta barra cobre esse vão.

     Duas regras, as duas por IntersectionObserver (nada de listener de
     scroll, que roda em toda rolagem):
      - escondida enquanto o CTA do hero está na tela — dois botões iguais
        visíveis ao mesmo tempo só ocupam espaço;
      - escondida quando o formulário de checkout está na tela — ali o botão
        de verdade é "Gerar Pix", e a barra taparia justamente o campo que a
        pessoa está preenchendo.
     --------------------------------------------------------------------- */
  function initBuyBar() {
    var bar = $('[data-cv-buybar]');
    var heroCta = $('[data-cv-cta="hero"]');
    if (!bar || !heroCta) return;

    /* No modo "link" o CTA já aponta para fora; a barra segue valendo, mas
       sem gateway configurado o dono pode ter escondido o checkout inteiro. */
    if (!('IntersectionObserver' in window)) return;

    var heroVisivel = true, formVisivel = false;

    function sync() {
      var mostrar = !heroVisivel && !formVisivel;
      if (mostrar) {
        bar.hidden = false;
        bar.setAttribute('data-cv-buybar-on', '');
        document.body.classList.add('cv-buybar-space');
      } else {
        bar.removeAttribute('data-cv-buybar-on');
        bar.hidden = true;
        document.body.classList.remove('cv-buybar-space');
      }
    }

    new IntersectionObserver(function (entries) {
      heroVisivel = entries[0].isIntersecting;
      sync();
    }, { threshold: 0 }).observe(heroCta);

    var form = $('#cv-form');
    if (form) {
      new IntersectionObserver(function (entries) {
        formVisivel = entries[0].isIntersecting;
        sync();
      }, { threshold: 0 }).observe(form);
    }

    sync();
  }

  /* ---------------------------------------------------------------------
     Aviso de compra recente

     A lista é cadastrada pelo dono na tela de Escassez. Sem itens, ou com o
     bloco desligado, nada entra no DOM: a página não inventa comprador.
     Fecha para sempre naquela sessão se a pessoa dispensar.
     --------------------------------------------------------------------- */
  /* Intenção de compra: virou true quando o checkout foi revelado. Vive fora
     das duas funções porque quem escreve (initCheckoutReveal, antes do boot) e
     quem lê (initSocialProof, depois do fetch de config) rodam em momentos
     diferentes — um evento solto se perderia no intervalo. */
  var intencaoDeCompra = false;
  var aoIntencionarCompra = [];

  function marcarIntencaoDeCompra() {
    if (intencaoDeCompra) return;
    intencaoDeCompra = true;
    var fila = aoIntencionarCompra;
    aoIntencionarCompra = [];
    fila.forEach(function (fn) { try { fn(); } catch (e) {} });
  }

  function quandoIntencionarCompra(fn) {
    if (intencaoDeCompra) { fn(); return; }
    aoIntencionarCompra.push(fn);
  }

  function initSocialProof() {
    var cfg = CFG.socialProof;
    var tpl = document.getElementById('cv-proof-tpl');
    if (!tpl || !cfg || !cfg.enabled || !cfg.items || !cfg.items.length) return;

    var items = cfg.items.filter(function (it) { return it && it.name && it.product; });
    if (!items.length) return;

    var every = Math.max(4, Math.min(60, cfg.intervalSec || 9)) * 1000;
    var node = null, i = 0, timer = 0, dismissed = false;

    function hide() {
      if (node && node.parentNode) node.parentNode.removeChild(node);
      node = null;
    }

    function show() {
      if (dismissed) return;
      hide();
      var it = items[i % items.length];
      i += 1;

      node = tpl.content.firstElementChild.cloneNode(true);
      $('[data-cv-proof-who]', node).textContent = it.city ? it.name + ' · ' + it.city : it.name;
      $('[data-cv-proof-what]', node).textContent =
        'acabou de adquirir ' + it.product + (it.minutesAgo ? ' · há ' + it.minutesAgo + ' min' : '');
      $('[data-cv-proof-close]', node).addEventListener('click', function () {
        dismissed = true;
        clearInterval(timer);
        hide();
      });
      document.body.appendChild(node);

      /* Sai de cena antes do próximo entrar: dois avisos empilhados no canto
         cobririam o CTA no celular. */
      setTimeout(function () { if (!dismissed) hide(); }, Math.min(every - 800, 6000));
    }

    /* Espera a pessoa abrir o checkout. O atraso curto depois disso evita que
       o aviso entre no mesmo quadro do formulário e roube a atenção dele. */
    quandoIntencionarCompra(function () {
      setTimeout(function () {
        if (dismissed) return;
        show();
        timer = setInterval(show, every);
      }, 2500);
    });
  }

  /* ---------------------------------------------------------------------
     Máscaras e validação
     --------------------------------------------------------------------- */
  function maskCpf(v) {
    return v.replace(/\D/g, '').slice(0, 11)
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  function maskFone(v) {
    var d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length > 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length > 2) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    return d;
  }

  /* Valida os dígitos verificadores — não só o comprimento. Um CPF inválido
     é recusado pelo gateway lá na frente; barrar aqui evita a cobrança falhada. */
  function validCpf(raw) {
    var c = (raw || '').replace(/\D/g, '');
    if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
    for (var t = 9; t < 11; t++) {
      var sum = 0;
      for (var i = 0; i < t; i++) sum += parseInt(c[i], 10) * ((t + 1) - i);
      var d = (sum * 10) % 11 % 10;
      if (d !== parseInt(c[t], 10)) return false;
    }
    return true;
  }

  var validEmail = function (v) { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v || ''); };

  /* ---------------------------------------------------------------------
     Checkout
     --------------------------------------------------------------------- */
  function initCheckout() {
    var form = $('#cv-form');
    if (!form) return;
    /* No modo "link" a seção inteira está oculta: não há o que inicializar. */
    if (CFG.checkout && CFG.checkout.mode === 'link' && CFG.checkout.externalUrl) return;

    var stepForm = $('[data-cv-step="form"]');
    var stepPix = $('[data-cv-step="pix"]');
    var errorEl = $('[data-cv-error]');
    var submitBtn = $('[data-cv-submit]');
    var pollTimer = null, expiryTimer = null, startedTracked = false;

    var cpfInput = form.elements.cpf;
    var foneInput = form.elements.fone;
    cpfInput.addEventListener('input', function () { cpfInput.value = maskCpf(cpfInput.value); });
    foneInput.addEventListener('input', function () { foneInput.value = maskFone(foneInput.value); });

    var maybeShowBonus = initBonus(form);

    form.addEventListener('input', function () {
      if (!startedTracked) { startedTracked = true; track('begin_checkout'); }
      showError('');
      /* No `input`, e não no `blur`: o bônus é a recompensa por ter preenchido,
         e recompensa que chega depois de a pessoa sair do campo perde o efeito. */
      maybeShowBonus();
    });

    /* Rascunho do lead: assim que nome e e-mail ficam válidos, o servidor
       já sabe quem é a pessoa — é isso que permite recuperar quem sai antes
       de apertar "Gerar Pix". Dispara ao sair do campo, não a cada tecla, e
       só de novo se o valor mudou. */
    var lastDraft = '';
    function saveDraft() {
      var nome = form.elements.nome.value.trim();
      var email = form.elements.email.value.trim();
      if (nome.split(/\s+/).length < 2 || !validEmail(email)) return;
      var key = nome + '|' + email.toLowerCase();
      if (key === lastDraft) return;
      lastDraft = key;
      var body = JSON.stringify({
        nome: nome, email: email, utm: UTMS, session_id: SESSION_ID,
        fbp: readCookie('_fbp'), fbc: fbcValue()
      });
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon('/api/checkout/draft', new Blob([body], { type: 'application/json' }));
          return;
        }
      } catch (e) { /* cai no fetch */ }
      fetch('/api/checkout/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true })
        .catch(function () { /* rascunho nunca atrapalha o visitante */ });
    }
    form.elements.nome.addEventListener('blur', saveDraft);
    form.elements.email.addEventListener('blur', saveDraft);
    /* Quem fecha a aba com os dois campos preenchidos também vira rascunho. */
    window.addEventListener('pagehide', saveDraft);

    function showError(msg, field) {
      if (!errorEl) return;
      errorEl.textContent = msg || '';
      errorEl.hidden = !msg;
      $$('.cv-input', form).forEach(function (i) { i.removeAttribute('aria-invalid'); });
      if (field && form.elements[field]) {
        form.elements[field].setAttribute('aria-invalid', 'true');
        form.elements[field].focus();
      }
    }

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();

      /* `session_id`, `fbp` e `fbc` iam faltando aqui. A rota sempre os
         aceitou e o rascunho sempre os enviou — só o submit não, e como o
         servidor gravava `?? null` sobre o rascunho, o submit **apagava** o
         que o rascunho havia salvo certo. Sem isso, `Lead.sessionId` ficava
         nulo e a etapa "Pagaram" do funil dava zero. */
      var data = {
        nome: form.elements.nome.value.trim(),
        email: form.elements.email.value.trim(),
        cpf: form.elements.cpf.value.replace(/\D/g, ''),
        fone: form.elements.fone.value.replace(/\D/g, ''),
        utm: UTMS,
        session_id: SESSION_ID,
        fbp: readCookie('_fbp'),
        fbc: fbcValue()
      };

      if (data.nome.split(/\s+/).length < 2) return showError('Informe seu nome e sobrenome.', 'nome');
      if (!validEmail(data.email)) return showError('Informe um e-mail válido.', 'email');
      if (!validCpf(data.cpf)) return showError('CPF inválido. Confira os números digitados.', 'cpf');
      if (data.fone.length < 10) return showError('Informe um WhatsApp com DDD.', 'fone');

      data.event_id = track('generate_lead');

      submitBtn.disabled = true;
      var originalLabel = submitBtn.innerHTML;
      submitBtn.textContent = 'Gerando seu Pix…';

      fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
        .then(function (r) {
          if (!r.ok) throw new Error('http_' + r.status);
          return r.json();
        })
        .then(function (res) {
          showPix(res, data.nome);
          track('add_payment_info', { order_id: res.orderPublicId });
          startPolling(res.orderPublicId);
        })
        .catch(function () {
          showError('Não conseguimos gerar o Pix agora. Tente de novo em instantes.');
        })
        .then(function () {
          submitBtn.disabled = false;
          submitBtn.innerHTML = originalLabel;
        });
    });

    function showPix(res, nome) {
      $('[data-cv-firstname]').textContent = (nome || '').split(' ')[0];
      $('[data-cv-emv]').textContent = res.emv || '';

      var qr = $('[data-cv-qr]');
      if (res.qrCodeBase64) qr.src = 'data:image/png;base64,' + res.qrCodeBase64;
      else qr.closest('.cv-pix-qr').hidden = true;

      /* Cobrança de demonstração: avisa e libera o botão que confirma o
         pagamento, para dar de percorrer o fluxo inteiro sem gateway. */
      var warn = $('[data-cv-simulated]');
      var simBtn = $('[data-cv-simulate]');
      if (warn) warn.hidden = !res.simulated;
      if (simBtn) {
        simBtn.hidden = !res.simulated;
        simBtn.dataset.order = res.orderPublicId || '';
      }

      stepForm.hidden = true;
      stepPix.hidden = false;
      stepPix.scrollIntoView({ behavior: 'smooth', block: 'center' });

      /* O prazo vem do gateway; nunca fixamos um tempo nosso, porque ele
         varia por transação. */
      if (res.expiresAt) {
        var end = new Date(res.expiresAt).getTime();
        clearInterval(expiryTimer);
        expiryTimer = setInterval(function () {
          var left = end - Date.now();
          $$('[data-cv-pix-expiry]').forEach(function (el) { el.textContent = fmt(left); });
          if (left <= 0) clearInterval(expiryTimer);
        }, 1000);
      }
    }

    function startPolling(id) {
      clearInterval(pollTimer);
      pollTimer = setInterval(function () {
        fetch('/api/orders/' + encodeURIComponent(id) + '/status')
          .then(function (r) { return r.json(); })
          .then(function (s) {
            if (s.status === 'paid') {
              clearInterval(pollTimer);
              clearInterval(expiryTimer);
              location.href = '/obrigado?p=' + encodeURIComponent(id);
            } else if (s.status === 'expired') {
              clearInterval(pollTimer);
              clearInterval(expiryTimer);
            }
          })
          .catch(function () { /* rede instável: a próxima volta tenta de novo */ });
      }, CFG.checkout.pollMs);
    }

    var copyBtn = $('[data-cv-copy]');
    copyBtn.addEventListener('click', function () {
      var code = $('[data-cv-emv]').textContent;
      var done = function () {
        copyBtn.textContent = '✓ Código copiado';
        setTimeout(function () { copyBtn.textContent = 'Copiar código Pix'; }, 2500);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(code).then(done, fallbackCopy);
      } else {
        fallbackCopy();
      }
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = code;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) {
          copyBtn.textContent = 'Selecione e copie o código acima';
        }
        document.body.removeChild(ta);
      }
    });

    $('[data-cv-reset]').addEventListener('click', function () {
      clearInterval(pollTimer);
      clearInterval(expiryTimer);
      stepPix.hidden = true;
      stepForm.hidden = false;
      stepForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    /* Só aparece em cobrança de demonstração. O servidor recusa a chamada
       para qualquer pedido real, então não há como usar isto para burlar. */
    var simBtn = $('[data-cv-simulate]');
    if (simBtn) {
      simBtn.addEventListener('click', function () {
        var id = simBtn.dataset.order;
        if (!id) return;
        simBtn.disabled = true;
        simBtn.textContent = 'Confirmando…';
        fetch('/api/orders/' + encodeURIComponent(id) + '/simulate-payment', { method: 'POST' })
          .then(function (r) {
            if (!r.ok) throw new Error('falhou');
            /* Não redireciona daqui: deixa o polling detectar o pagamento,
               que é exatamente o caminho de uma venda real. */
            simBtn.textContent = 'Pagamento confirmado';
          })
          .catch(function () {
            simBtn.disabled = false;
            simBtn.textContent = 'Simular pagamento aprovado';
            showError('Não foi possível simular o pagamento.');
          });
      });
    }
  }

  /* ---------------------------------------------------------------------
     CTAs e profundidade de rolagem
     --------------------------------------------------------------------- */
  /**
   * Registra o clique em qualquer botão ou link da página.
   *
   * Um listener só, delegado no documento, em vez de um por elemento: pega
   * também o que o `lp.js` cria depois (o player de vídeo, os botões do
   * passo do Pix) e não precisa ser refeito quando a página muda.
   *
   * Os CTAs de compra continuam disparando `select_promotion`, que é o
   * evento que interessa para otimização. O resto vai como `click`, com o
   * bastante para o GTM montar um gatilho: rótulo, tipo, destino e seção.
   */
  /**
   * Texto do elemento sem o que é decoração.
   *
   * `textContent` puro traz as setas e os sinais de "+/−" dos ícones, e o
   * rótulo do evento chegava no GTM como "O que eu recebo por R$ 27,90?−".
   * Tudo que é `aria-hidden` já está marcado como invisível para leitor de
   * tela; aqui vale a mesma regra.
   */
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

  function initClickTracking() {
    document.addEventListener(
      'click',
      function (ev) {
        var el = ev.target && ev.target.closest ? ev.target.closest('a, button') : null;
        if (!el) return;

        var cta = el.getAttribute('data-cv-cta');
        var label = (el.getAttribute('aria-label') || visibleText(el)).replace(/\s+/g, ' ').trim().slice(0, 80);
        var section = el.closest('section');
        var params = {
          click_label: label,
          click_type: el.tagName === 'A' ? 'link' : 'botao',
          click_section: section ? section.id || section.getAttribute('data-cv-section') || '' : 'rodape',
        };

        if (el.tagName === 'A') {
          var href = el.getAttribute('href') || '';
          params.click_url = href;
          params.click_external = isHttpUrl(href) && href.indexOf(location.origin) !== 0;
        }

        /* CTA de compra tem evento próprio; o resto é clique genérico. */
        if (cta) {
          track('select_promotion', Object.assign({ cta: cta }, params));
        } else {
          track('click', params);
        }
      },
      // Captura: garante o registro mesmo quando algum handler
      // chama stopPropagation antes de a fase de bolha chegar aqui.
      true,
    );
  }

  /* O card da oferta e o checkout sao um so e ficam sempre visiveis (pedido do
     dono em 2026-09-08 — ate entao o formulario so aparecia depois do clique
     num CTA). O que sobrou desta funcao e a "intencao de compra", que segura o
     aviso de compra recente ate a pessoa demonstrar interesse: chegar com
     #checkout na URL, clicar num CTA, ou comecar a digitar no formulario. */
  function initCheckoutReveal() {
    var checkout = $('#checkout');
    if (!checkout) return;

    if (location.hash === '#checkout') marcarIntencaoDeCompra();

    /* Fase de captura, como antes: pega o clique mesmo se algum handler parar
       a propagacao. */
    document.addEventListener('click', function (ev) {
      var link = ev.target && ev.target.closest ? ev.target.closest('a[href="#checkout"]') : null;
      if (link) marcarIntencaoDeCompra();
    }, true);

    var form = $('#cv-form');
    if (form) form.addEventListener('input', marcarIntencaoDeCompra, { once: true });
  }

  function initCtas() {

    var seen = false;
    var oferta = $('#oferta');
    if (oferta && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries[0].isIntersecting && !seen) {
          seen = true;
          track('view_content', { content_name: 'oferta' });
          io.disconnect();
        }
      }, { threshold: .3 });
      io.observe(oferta);
    }
  }

  /* ---------------------------------------------------------------------
     Boot
     --------------------------------------------------------------------- */
  function boot() {
    applyConfig();
    initCountdown();
    initFaq();
    initVideo();
    initApostaSeguraCard();
    initCheckout();
    initCtas();
    initClickTracking();
    safely('barra-de-compra', initBuyBar);
    safely('prova-social', initSocialProof);
    track('page_view', { page: 'lp' });
  }

  /* Largura da barra de rolagem, para os fundos de sangria total nao
     estourarem o viewport de layout.

     `100vw` conta a barra de rolagem; a area util do documento nao. Em 1440
     com barra classica a diferenca medida foi de 15px, o que alargava o
     documento em 8px e cortava as pontas do gradiente. Aqui a diferenca e
     medida e publicada como `--cv-sbw`, que o CSS desconta.

     Escrito via CSSOM (`setProperty`), que a CSP `style-src 'self'` permite —
     o mesmo caminho que o `applyTheme` ja usa. Sem JS, o CSS cai no
     fallback `0px` e o comportamento e o de antes. */
  function medirBarraDeRolagem() {
    var sbw = window.innerWidth - document.documentElement.clientWidth;
    /* Barra sobreposta (celular, macOS) da 0. Zoom pode dar fracao negativa. */
    if (!(sbw > 0)) sbw = 0;
    document.documentElement.style.setProperty('--cv-sbw', sbw + 'px');
  }

  medirBarraDeRolagem();

  /* A barra aparece e desaparece conforme a pagina cresce (abrir o checkout,
     por exemplo) e some ao entrar em tela cheia. Debounce para nao medir a
     cada quadro do arrasto da janela. */
  var timerBarra = 0;
  window.addEventListener('resize', function () {
    clearTimeout(timerBarra);
    timerBarra = setTimeout(medirBarraDeRolagem, 150);
  });

  /* Fora do boot de proposito: o boot so roda depois do fetch de /api/config, e
     esperar por ele faria o checkout piscar na tela antes de ser escondido.
     O script e `defer`, entao isto executa antes da primeira pintura. */
  initCheckoutReveal();

  fetch('/api/config', { headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (cfg) {
      if (cfg) {
        Object.keys(cfg).forEach(function (k) {
          CFG[k] = (cfg[k] && typeof cfg[k] === 'object' && !Array.isArray(cfg[k]))
            ? Object.assign({}, CFG[k], cfg[k])
            : cfg[k];
        });
      }
    })
    .catch(function () { /* sem backend: segue com os defaults */ })
    .then(boot);
})();
