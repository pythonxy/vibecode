// ==UserScript==
// @name         Torn Stock Tracker
// @namespace    https://www.torn.com/
// @version      1.3.0
// @description  Track item stock prices from droqsdb.com on Torn, auto-refreshes every 30s. Works on Tampermonkey and TornPDA.
// @author       You
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      droqsdb.com
// ==/UserScript==

(function () {
  'use strict';

  // ─── Storage: works in both Tampermonkey and TornPDA ────────────────────────
  var store = {
    get: function (key, def) {
      try {
        if (typeof GM_getValue !== 'undefined') return GM_getValue(key, def);
        var v = localStorage.getItem('tst_' + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set: function (key, val) {
      try {
        if (typeof GM_setValue !== 'undefined') { GM_setValue(key, val); return; }
        localStorage.setItem('tst_' + key, JSON.stringify(val));
      } catch (e) {}
    }
  };

  // ─── HTTP: falls back to fetch if GM_xmlhttpRequest unavailable ─────────────
  function httpGet(url, onload, onerror) {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'GET', url: url, timeout: 10000,
        onload:   function (r) { onload(r.status, r.responseText); },
        onerror:  function ()  { onerror('Network error'); },
        ontimeout: function () { onerror('Request timed out'); }
      });
    } else {
      fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(10000) : undefined })
        .then(function (r) {
          return r.text().then(function (t) { onload(r.status, t); });
        })
        .catch(function (e) { onerror(e.message || 'Network error'); });
    }
  }

  // ─── Saved state ────────────────────────────────────────────────────────────
  var savedItem    = store.get('tst_item',    'Xanax');
  var savedCountry = store.get('tst_country', 'Japan');
  var isExpanded   = store.get('tst_expanded', true);
  var savedX       = store.get('tst_x', null);
  var savedY       = store.get('tst_y', null);

  // ─── Inject styles ──────────────────────────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    /* Widget shell */
    '#tst-widget{position:fixed;z-index:99999;font-family:"Courier New",monospace;font-size:12px;width:270px;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.55);border:1px solid #3a3a3a;user-select:none;-webkit-user-select:none;transition:width .25s ease,height .25s ease,border-radius .25s ease;}',

    /* Minimized: circle */
    '#tst-widget.minimized{width:46px!important;height:46px!important;border-radius:50%!important;border-color:#2a2a2a;box-shadow:0 2px 14px rgba(0,0,0,.65);}',
    '#tst-widget.minimized #tst-header{width:46px;height:46px;padding:0;justify-content:center;border-bottom:none;border-radius:50%;}',
    '#tst-widget.minimized #tst-header-title{display:none;}',
    '#tst-widget.minimized #tst-header-right{display:none;}',
    '#tst-widget.minimized #tst-body{display:none!important;}',

    /* ST bubble label */
    '#tst-bubble-label{display:none;font-size:13px;font-weight:bold;color:#e8c84a;letter-spacing:1px;pointer-events:none;font-family:"Courier New",monospace;}',
    '#tst-widget.minimized #tst-bubble-label{display:block;}',

    /* Mini status dot */
    '#tst-pulse-mini{position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:#4caf50;animation:tst-pulse 2s infinite;display:none;}',
    '#tst-widget.minimized #tst-pulse-mini{display:block;}',

    '#tst-widget.dragging{opacity:.85;box-shadow:0 8px 32px rgba(0,0,0,.7);}',

    /* Header */
    '#tst-header{position:relative;display:flex;align-items:center;justify-content:space-between;background:#1a1a1a;padding:7px 10px;cursor:grab;border-bottom:1px solid #333;}',
    '#tst-header:active{cursor:grabbing;}',

    '#tst-header-title{color:#e8c84a;font-weight:bold;font-size:12px;letter-spacing:1px;text-transform:uppercase;display:flex;align-items:center;gap:6px;pointer-events:none;}',

    /* Pulse dot */
    '#tst-pulse{width:7px;height:7px;border-radius:50%;background:#4caf50;animation:tst-pulse 2s infinite;flex-shrink:0;}',
    '#tst-pulse.error{background:#e53935;animation:none;}',
    '#tst-pulse.loading{background:#e8c84a;animation:tst-pulse .6s infinite;}',
    '@keyframes tst-pulse{0%,100%{opacity:1}50%{opacity:.3}}',

    '#tst-header-right{display:flex;align-items:center;gap:8px;pointer-events:none;}',
    '#tst-drag-hint{color:#444;font-size:10px;letter-spacing:1px;}',

    '#tst-toggle-btn{color:#888;font-size:14px;line-height:1;padding:0 2px;transition:color .15s;pointer-events:all;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '#tst-toggle-btn:hover{color:#e8c84a;}',

    /* Body */
    '#tst-body{background:#111;display:flex;flex-direction:column;}',

    '#tst-inputs{display:flex;gap:6px;padding:8px 10px 6px;border-bottom:1px solid #222;}',

    '.tst-input{flex:1;min-width:0;background:#1e1e1e;border:1px solid #333;border-radius:4px;color:#ddd;font-family:"Courier New",monospace;font-size:11px;padding:4px 6px;outline:none;transition:border-color .15s;user-select:text;-webkit-user-select:text;}',
    '.tst-input:focus{border-color:#e8c84a;}',
    '.tst-input::placeholder{color:#555;}',

    '#tst-fetch-btn{background:#e8c84a;color:#111;border:none;border-radius:4px;font-family:"Courier New",monospace;font-size:11px;font-weight:bold;padding:4px 8px;cursor:pointer;transition:background .15s;white-space:nowrap;-webkit-tap-highlight-color:transparent;}',
    '#tst-fetch-btn:hover{background:#f5d96a;}',

    '#tst-refresh-btn{background:transparent;color:#555;border:1px solid #2a2a2a;border-radius:3px;font-size:13px;padding:1px 5px;cursor:pointer;transition:color .15s,border-color .15s;line-height:1;-webkit-tap-highlight-color:transparent;}',
    '#tst-refresh-btn:hover{color:#e8c84a;border-color:#e8c84a;}',
    '#tst-refresh-btn.spinning{animation:tst-spin .6s linear infinite;}',
    '@keyframes tst-spin{to{transform:rotate(360deg)}}',

    '#tst-output{padding:8px 10px 10px;min-height:40px;}',

    '.tst-row{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #1e1e1e;}',
    '.tst-row:last-child{border-bottom:none;}',
    '.tst-label{color:#888;}',
    '.tst-value{color:#e0e0e0;font-weight:bold;}',
    '.tst-value.green{color:#66bb6a;}',
    '.tst-value.yellow{color:#e8c84a;}',
    '.tst-value.red{color:#ef5350;}',

    '.tst-section-title{color:#e8c84a;letter-spacing:1px;font-size:10px;text-transform:uppercase;margin-bottom:6px;margin-top:2px;}',
    '.tst-error{color:#ef5350;font-size:11px;}',
    '.tst-loading{color:#e8c84a;font-size:11px;}',

    '#tst-footer{display:flex;justify-content:space-between;align-items:center;padding:4px 10px 5px;border-top:1px solid #1e1e1e;background:#0d0d0d;}',
    '#tst-countdown{color:#555;font-size:10px;}',
    '#tst-last-update{color:#444;font-size:10px;}',

    /* Touch-friendly tap targets on mobile */
    '@media(pointer:coarse){#tst-toggle-btn{padding:4px 6px;}#tst-fetch-btn{padding:6px 10px;}#tst-refresh-btn{padding:4px 8px;font-size:15px;}}',
  ].join('');
  document.head.appendChild(style);

  // ─── Build widget DOM ────────────────────────────────────────────────────────
  var widget = document.createElement('div');
  widget.id = 'tst-widget';
  widget.innerHTML =
    '<div id="tst-header">' +
      '<span id="tst-bubble-label">ST</span>' +
      '<span id="tst-pulse-mini"></span>' +
      '<div id="tst-header-title">' +
        '<span id="tst-pulse"></span>' +
        'Stock Tracker' +
      '</div>' +
      '<div id="tst-header-right">' +
        '<span id="tst-drag-hint">⠿ drag</span>' +
        '<span id="tst-toggle-btn">▼</span>' +
      '</div>' +
    '</div>' +
    '<div id="tst-body">' +
      '<div id="tst-inputs">' +
        '<input class="tst-input" id="tst-item-input"    placeholder="Item"    value="' + savedItem    + '" />' +
        '<input class="tst-input" id="tst-country-input" placeholder="Country" value="' + savedCountry + '" />' +
        '<button id="tst-fetch-btn">GO</button>' +
      '</div>' +
      '<div id="tst-output"><div class="tst-loading">Fetching data…</div></div>' +
      '<div id="tst-footer">' +
        '<span id="tst-countdown">Next refresh: 30s</span>' +
        '<button id="tst-refresh-btn" title="Force refresh">↻</button>' +
        '<span id="tst-last-update"></span>' +
      '</div>' +
    '</div>';
  document.body.appendChild(widget);

  // ─── Position ────────────────────────────────────────────────────────────────
  function applyPosition(x, y) {
    widget.style.left   = x + 'px';
    widget.style.top    = y + 'px';
    widget.style.bottom = 'auto';
    widget.style.right  = 'auto';
  }

  if (savedX !== null && savedY !== null) {
    applyPosition(savedX, savedY);
  } else {
    widget.style.bottom = '18px';
    widget.style.left   = '18px';
  }

  // ─── Element refs ────────────────────────────────────────────────────────────
  var body         = widget.querySelector('#tst-body');
  var toggleBtn    = widget.querySelector('#tst-toggle-btn');
  var header       = widget.querySelector('#tst-header');
  var itemInput    = widget.querySelector('#tst-item-input');
  var countryInput = widget.querySelector('#tst-country-input');
  var fetchBtn     = widget.querySelector('#tst-fetch-btn');
  var refreshBtn   = widget.querySelector('#tst-refresh-btn');
  var output       = widget.querySelector('#tst-output');
  var pulse        = widget.querySelector('#tst-pulse');
  var pulseMini    = widget.querySelector('#tst-pulse-mini');
  var countdownEl  = widget.querySelector('#tst-countdown');
  var lastUpdateEl = widget.querySelector('#tst-last-update');

  // ─── Expand / minimize ───────────────────────────────────────────────────────
  function setExpanded(expanded) {
    isExpanded = expanded;
    store.set('tst_expanded', expanded);
    if (expanded) {
      widget.classList.remove('minimized');
      body.style.display    = 'flex';
      toggleBtn.textContent = '▼';
    } else {
      widget.classList.add('minimized');
      body.style.display    = 'none';
      toggleBtn.textContent = '▲';
    }
  }
  setExpanded(isExpanded);

  // ─── Pulse helper ────────────────────────────────────────────────────────────
  function setPulse(cls) {
    pulse.className = cls;
    var color = cls === 'error' ? '#e53935' : cls === 'loading' ? '#e8c84a' : '#4caf50';
    pulseMini.style.background = color;
    pulseMini.style.animation  = cls === 'error' ? 'none' : '';
  }

  // ─── Drag (mouse + touch) ────────────────────────────────────────────────────
  var isDragging  = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var didDrag     = false;

  function dragStart(clientX, clientY) {
    isDragging  = true;
    didDrag     = false;
    var rect    = widget.getBoundingClientRect();
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
    widget.classList.add('dragging');
  }

  function dragMove(clientX, clientY) {
    if (!isDragging) return;
    didDrag = true;
    var x = clientX - dragOffsetX;
    var y = clientY - dragOffsetY;
    x = Math.max(0, Math.min(x, window.innerWidth  - widget.offsetWidth));
    y = Math.max(0, Math.min(y, window.innerHeight - widget.offsetHeight));
    applyPosition(x, y);
  }

  function dragEnd() {
    if (!isDragging) return;
    isDragging = false;
    widget.classList.remove('dragging');
    if (didDrag) {
      var rect = widget.getBoundingClientRect();
      store.set('tst_x', rect.left);
      store.set('tst_y', rect.top);
      savedX = rect.left; savedY = rect.top;
    }
  }

  // Mouse
  header.addEventListener('mousedown', function (e) {
    if (e.target === toggleBtn) return;
    dragStart(e.clientX, e.clientY);
    e.preventDefault();
  });
  document.addEventListener('mousemove', function (e) { dragMove(e.clientX, e.clientY); });
  document.addEventListener('mouseup',   dragEnd);

  // Touch
  header.addEventListener('touchstart', function (e) {
    if (e.target === toggleBtn) return;
    dragStart(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!isDragging) return;
    dragMove(e.touches[0].clientX, e.touches[0].clientY);
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchend', dragEnd);

  // ─── Toggle click / tap ──────────────────────────────────────────────────────
  header.addEventListener('click', function (e) {
    if (e.target === toggleBtn) return;
    if (didDrag) return;
    if (!isExpanded) setExpanded(true);
  });
  toggleBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    setExpanded(!isExpanded);
  });

  // ─── Countdown ───────────────────────────────────────────────────────────────
  var countdown = 30;
  var countdownInterval = null;

  function startCountdown() {
    clearInterval(countdownInterval);
    countdown = 30;
    countdownEl.textContent = 'Next refresh: 30s';
    countdownInterval = setInterval(function () {
      countdown--;
      countdownEl.textContent = 'Next refresh: ' + countdown + 's';
      if (countdown <= 0) { clearInterval(countdownInterval); fetchData(); }
    }, 1000);
  }

  // ─── Fetch ───────────────────────────────────────────────────────────────────
  function toTitleCase(str) {
    return str.trim().replace(/\w\S*/g, function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    });
  }

  function fetchData() {
    var itemName    = toTitleCase(itemInput.value    || savedItem);
    var countryName = toTitleCase(countryInput.value || savedCountry);
    store.set('tst_item', itemName);
    store.set('tst_country', countryName);
    savedItem = itemName; savedCountry = countryName;

    setPulse('loading');
    refreshBtn.classList.add('spinning');
    output.innerHTML = '<div class="tst-loading">Fetching ' + itemName + ' / ' + countryName + '…</div>';

    httpGet(
      'https://droqsdb.com/api/public/v1/item/' + encodeURIComponent(itemName),
      function (status, text) {
        if (status !== 200) { showError(itemName + ': ' + countryName + ' not found'); return; }
        try {
          var data      = JSON.parse(text);
          var countries = (data && data.item && data.item.countries) || [];
          var entry     = null;
          for (var i = 0; i < countries.length; i++) {
            if (countries[i].country === countryName) { entry = countries[i]; break; }
          }
          if (!entry) { showError('No stock info found for ' + itemName + ' in ' + countryName + '.'); return; }
          renderEntry(countryName, entry);
          setPulse('');
          refreshBtn.classList.remove('spinning');
          lastUpdateEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
          startCountdown();
        } catch (err) { showError('Parse error: ' + err.message); }
      },
      function (msg) { showError(msg); }
    );
  }

  function showError(msg) {
    setPulse('error');
    refreshBtn.classList.remove('spinning');
    output.innerHTML = '<div class="tst-error">⚠ ' + msg + '</div>';
    startCountdown();
  }

  function colorClass(val, type) {
    if (val == null) return '';
    if (type === 'profit') return val > 0 ? 'green' : val < 0 ? 'red' : '';
    if (type === 'stock')  return val > 50 ? 'green' : val > 10 ? 'yellow' : 'red';
    return '';
  }

  function fmt(val) {
    if (val == null) return '—';
    if (typeof val === 'number') return val.toLocaleString();
    return val;
  }

  function renderEntry(country, e) {
    var rows = [
      { label: 'Source',       value: fmt(e.source),                  cls: '' },
      { label: 'Stock',        value: fmt(e.stock),                   cls: colorClass(e.stock, 'stock') },
      { label: 'Restock',      value: fmt(e.estimatedRestockDisplay), cls: '' },
      { label: 'Buy Price',    value: e.buyPrice    != null ? '$' + fmt(e.buyPrice)    : '—', cls: '' },
      { label: 'Market Price', value: e.marketValue != null ? '$' + fmt(e.marketValue) : '—', cls: '' },
      { label: 'Bazaar Price', value: e.bazaarPrice != null ? '$' + fmt(e.bazaarPrice) : '—', cls: '' },
      { label: 'Profit/Item',  value: e.profitPerItem   != null ? '$' + fmt(e.profitPerItem)   : '—', cls: colorClass(e.profitPerItem, 'profit') },
      { label: 'Profit/Min',   value: e.profitPerMinute != null ? '$' + fmt(e.profitPerMinute) : '—', cls: colorClass(e.profitPerMinute, 'profit') },
    ];
    var html = '<div class="tst-section-title">' + country.toUpperCase() + '</div>';
    for (var i = 0; i < rows.length; i++) {
      html += '<div class="tst-row"><span class="tst-label">' + rows[i].label +
              '</span><span class="tst-value ' + rows[i].cls + '">' + rows[i].value + '</span></div>';
    }
    output.innerHTML = html;
  }

  // ─── Button events ───────────────────────────────────────────────────────────
  fetchBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    clearInterval(countdownInterval);
    fetchData();
  });

  refreshBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    clearInterval(countdownInterval);
    fetchData();
  });

  widget.querySelector('#tst-inputs').addEventListener('mousedown',  function (e) { e.stopPropagation(); });
  widget.querySelector('#tst-inputs').addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });

  [itemInput, countryInput].forEach(function (inp) {
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.stopPropagation(); clearInterval(countdownInterval); fetchData(); }
    });
  });

  // ─── Initial fetch ───────────────────────────────────────────────────────────
  fetchData();

})();
