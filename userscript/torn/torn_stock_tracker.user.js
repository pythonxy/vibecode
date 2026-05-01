// ==UserScript==
// @name         Torn Foreign Stock Tracker
// @namespace    https://www.torn.com/
// @version      2.0.1
// @description  Track item stock prices with dynamic height and spinning refresh.
// @author       pythonxyz [3923535]
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      droqsdb.com
// @downloadURL https://github.com/pythonxy/vibecode/raw/refs/heads/main/userscript/torn/torn_stock_tracker.user.js
// @updateURL https://github.com/pythonxy/vibecode/raw/refs/heads/main/userscript/torn/torn_stock_tracker.user.js
// ==/UserScript==

(function () {
 
  // ─── Safe classList helper (old WebView fallback) ─────────────────────────────
  function addClass(el, cls) {
    try {
      if (el.classList) { el.classList.add(cls); }
      else if (el.className.indexOf(cls) === -1) { el.className += ' ' + cls; }
    } catch (e) {}
  }
  function removeClass(el, cls) {
    try {
      if (el.classList) { el.classList.remove(cls); }
      else { el.className = el.className.replace(new RegExp('(?:^|\\s)' + cls + '(?!\\S)', 'g'), ''); }
    } catch (e) {}
  }
  function hasClass(el, cls) {
    try { return el.classList ? el.classList.contains(cls) : el.className.indexOf(cls) !== -1; }
    catch (e) { return false; }
  }
 
  // ─── Storage (GM → localStorage → in-memory fallback) ────────────────────────
  var _mem = {};
  var store = {
    get: function (key, def) {
      try { if (typeof GM_getValue !== 'undefined') return GM_getValue(key, def); } catch (e) {}
      try { var v = localStorage.getItem('tst_' + key); if (v !== null) return JSON.parse(v); } catch (e) {}
      return (_mem[key] !== undefined) ? _mem[key] : def;
    },
    set: function (key, val) {
      _mem[key] = val;
      try { if (typeof GM_setValue !== 'undefined') { GM_setValue(key, val); return; } } catch (e) {}
      try { localStorage.setItem('tst_' + key, JSON.stringify(val)); } catch (e) {}
    }
  };
 
  // ─── HTTP (GM → fetch fallback) ───────────────────────────────────────────────
  function httpGet(url, onload, onerror) {
    try {
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method: 'GET', url: url, timeout: 10000,
          onload:    function (r) { try { onload(r.status, r.responseText); } catch (e) { onerror(e.message); } },
          onerror:   function ()  { onerror('Network error'); },
          ontimeout: function ()  { onerror('Timeout'); }
        });
        return;
      }
    } catch (e) {}
    // fetch fallback — no AbortSignal to stay compatible with old WebViews
    try {
      fetch(url)
        .then(function (r) {
          return r.text().then(function (t) { onload(r.status, t); });
        })
        .catch(function (e) { onerror(e.message || 'Network error'); });
    } catch (e) {
      onerror('fetch unavailable: ' + e.message);
    }
  }
 
  // ─── Defer until body is ready ────────────────────────────────────────────────
  function ready(fn) {
    try {
      if (document.body) { fn(); return; }
      var iv = setInterval(function () {
        if (document.body) { clearInterval(iv); fn(); }
      }, 50);
    } catch (e) {}
  }
 
  ready(function () {
    try { init(); } catch (e) {
      // Last-resort: show a minimal visible error so users can report it
      try {
        var err = document.createElement('div');
        err.style.cssText = 'position:fixed;bottom:18px;left:18px;z-index:99999;background:#1a1a1a;color:#ef5350;font-family:monospace;font-size:11px;padding:8px 12px;border-radius:6px;border:1px solid #ef5350;';
        err.textContent = 'TST Error: ' + e.message;
        document.body.appendChild(err);
      } catch (e2) {}
    }
  });
 
  function init() {
 
    // ─── State ──────────────────────────────────────────────────────────────────
    var savedItem  = store.get('tst_item', 'Xanax');
    var isExpanded = store.get('tst_expanded', true);
    var savedX     = store.get('tst_x', null);
    var savedY     = store.get('tst_y', null);
 
    // ─── Styles ─────────────────────────────────────────────────────────────────
    var style = document.createElement('style');
    style.textContent = [
      '#tst-widget{position:fixed;z-index:99999;font-family:"Courier New",monospace;font-size:12px;width:420px;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.6);border:1px solid #3a3a3a;-webkit-user-select:none;user-select:none;transition:width .25s ease,height .25s ease,border-radius .25s ease;}',
 
      /* Minimized circle */
      '#tst-widget.minimized{width:46px!important;height:46px!important;border-radius:50%!important;border-color:#2a2a2a;box-shadow:0 2px 14px rgba(0,0,0,.65);}',
      '#tst-widget.minimized #tst-header{width:46px;height:46px;padding:0;justify-content:center;border-bottom:none;border-radius:50%;}',
      '#tst-widget.minimized #tst-header-title{display:none;}',
      '#tst-widget.minimized #tst-header-right{display:none;}',
      '#tst-widget.minimized #tst-body{display:none!important;}',
 
      '#tst-bubble-label{display:none;font-size:13px;font-weight:bold;color:#e8c84a;letter-spacing:1px;pointer-events:none;font-family:"Courier New",monospace;}',
      '#tst-widget.minimized #tst-bubble-label{display:block;}',
 
      '#tst-pulse-mini{position:absolute;top:5px;right:5px;width:7px;height:7px;border-radius:50%;background:#4caf50;-webkit-animation:tst-pulse 2s infinite;animation:tst-pulse 2s infinite;display:none;}',
      '#tst-widget.minimized #tst-pulse-mini{display:block;}',
 
      '#tst-widget.dragging{opacity:.85;}',
 
      /* Header */
      '#tst-header{position:relative;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;-webkit-justify-content:space-between;justify-content:space-between;background:#1a1a1a;padding:7px 10px;cursor:grab;border-bottom:1px solid #333;}',
      '#tst-header:active{cursor:grabbing;}',
      '#tst-header-title{color:#e8c84a;font-weight:bold;font-size:12px;letter-spacing:1px;text-transform:uppercase;display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;gap:6px;pointer-events:none;}',
      '#tst-pulse{width:7px;height:7px;border-radius:50%;background:#4caf50;-webkit-animation:tst-pulse 2s infinite;animation:tst-pulse 2s infinite;-webkit-flex-shrink:0;flex-shrink:0;}',
      '#tst-pulse.error{background:#e53935;-webkit-animation:none;animation:none;}',
      '#tst-pulse.loading{background:#e8c84a;-webkit-animation:tst-pulse .6s infinite;animation:tst-pulse .6s infinite;}',
      '@-webkit-keyframes tst-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
      '@keyframes tst-pulse{0%,100%{opacity:1}50%{opacity:.3}}',
      '#tst-header-right{display:-webkit-flex;display:flex;-webkit-align-items:center;align-items:center;gap:8px;pointer-events:none;}',
      '#tst-drag-hint{color:#444;font-size:10px;letter-spacing:1px;}',
      '#tst-toggle-btn{color:#888;font-size:14px;line-height:1;padding:0 2px;transition:color .15s;pointer-events:all;cursor:pointer;-webkit-tap-highlight-color:transparent;background:none;border:none;}',
      '#tst-toggle-btn:hover{color:#e8c84a;}',
 
      /* Body */
      '#tst-body{background:#111;display:-webkit-flex;display:flex;-webkit-flex-direction:column;flex-direction:column;}',
 
      /* Search row */
      '#tst-search-row{display:-webkit-flex;display:flex;gap:6px;padding:8px 10px 7px;border-bottom:1px solid #222;-webkit-align-items:center;align-items:center;}',
      '#tst-item-input{-webkit-flex:1;flex:1;min-width:0;background:#1e1e1e;border:1px solid #333;border-radius:4px;color:#ddd;font-family:"Courier New",monospace;font-size:12px;padding:5px 8px;outline:none;-webkit-user-select:text;user-select:text;}',
      '#tst-item-input:focus{border-color:#e8c84a;}',
      '#tst-item-input::-webkit-input-placeholder{color:#555;}',
      '#tst-item-input::placeholder{color:#555;}',
      '#tst-fetch-btn{background:#e8c84a;color:#111;border:none;border-radius:4px;font-family:"Courier New",monospace;font-size:12px;font-weight:bold;padding:5px 12px;cursor:pointer;white-space:nowrap;-webkit-tap-highlight-color:transparent;}',
 
      /* Table */
      '#tst-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;}',
      '#tst-table{width:100%;border-collapse:collapse;font-size:11px;}',
      '#tst-table thead tr{background:#1a1a1a;border-bottom:1px solid #333;}',
      '#tst-table th{color:#888;font-weight:normal;text-align:left;padding:5px 8px;white-space:nowrap;letter-spacing:.5px;font-size:10px;text-transform:uppercase;}',
      '#tst-table th.num{text-align:right;}',
      '#tst-table tbody tr{border-bottom:1px solid #1a1a1a;}',
      '#tst-table tbody tr:last-child{border-bottom:none;}',
      '#tst-table td{padding:5px 8px;white-space:nowrap;color:#ccc;}',
      '#tst-table td.num{text-align:right;}',
      '#tst-table td.country{color:#e8c84a;font-weight:bold;}',
      '#tst-table td.green{color:#66bb6a;font-weight:bold;}',
      '#tst-table td.yellow{color:#e8c84a;font-weight:bold;}',
      '#tst-table td.red{color:#ef5350;font-weight:bold;}',
 
      /* Status / error messages */
      '#tst-msg{padding:14px 10px;font-size:11px;color:#e8c84a;text-align:center;}',
      '#tst-msg.error{color:#ef5350;}',
 
      /* Footer */
      '#tst-footer{display:-webkit-flex;display:flex;-webkit-justify-content:space-between;justify-content:space-between;-webkit-align-items:center;align-items:center;padding:4px 10px 5px;border-top:1px solid #1e1e1e;background:#0d0d0d;}',
      '#tst-countdown{color:#555;font-size:10px;}',
      '#tst-refresh-btn{background:transparent;color:#555;border:1px solid #2a2a2a;border-radius:3px;font-size:13px;padding:1px 5px;cursor:pointer;line-height:1;-webkit-tap-highlight-color:transparent;}',
      '#tst-refresh-btn:hover{color:#e8c84a;border-color:#e8c84a;}',
      '#tst-refresh-btn.spinning{-webkit-animation:tst-spin .6s linear infinite;animation:tst-spin .6s linear infinite;}',
      '@-webkit-keyframes tst-spin{to{-webkit-transform:rotate(360deg)}}',
      '@keyframes tst-spin{to{transform:rotate(360deg)}}',
      '#tst-last-update{color:#444;font-size:10px;}',
 
      '@media(max-width:480px){#tst-widget{width:96vw;}}',
      '@media(pointer:coarse){#tst-toggle-btn{padding:4px 6px;}#tst-fetch-btn{padding:6px 12px;}#tst-refresh-btn{padding:4px 8px;font-size:15px;}}',
    ].join('');
    document.head.appendChild(style);
 
    // ─── DOM ────────────────────────────────────────────────────────────────────
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
          '<span id="tst-drag-hint">&#x2840; drag</span>' +
          '<span id="tst-toggle-btn">&#9660;</span>' +
        '</div>' +
      '</div>' +
      '<div id="tst-body">' +
        '<div id="tst-search-row">' +
          '<input id="tst-item-input" placeholder="Item name" value="' + savedItem + '" />' +
          '<button id="tst-fetch-btn">GO</button>' +
        '</div>' +
        '<div id="tst-table-wrap"><div id="tst-msg">Fetching data&#8230;</div></div>' +
        '<div id="tst-footer">' +
          '<span id="tst-countdown">Next refresh: 30s</span>' +
          '<button id="tst-refresh-btn" title="Force refresh">&#8635;</button>' +
          '<span id="tst-last-update"></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(widget);
 
    // ─── Position ───────────────────────────────────────────────────────────────
    function applyPosition(x, y) {
      widget.style.left = x + 'px'; widget.style.top = y + 'px';
      widget.style.bottom = 'auto'; widget.style.right = 'auto';
    }
    if (savedX !== null && savedY !== null) { applyPosition(savedX, savedY); }
    else { widget.style.bottom = '18px'; widget.style.left = '18px'; }
 
    // ─── Refs ───────────────────────────────────────────────────────────────────
    var body        = widget.querySelector('#tst-body');
    var header      = widget.querySelector('#tst-header');
    var toggleBtn   = widget.querySelector('#tst-toggle-btn');
    var itemInput   = widget.querySelector('#tst-item-input');
    var fetchBtn    = widget.querySelector('#tst-fetch-btn');
    var tableWrap   = widget.querySelector('#tst-table-wrap');
    var refreshBtn  = widget.querySelector('#tst-refresh-btn');
    var pulse       = widget.querySelector('#tst-pulse');
    var pulseMini   = widget.querySelector('#tst-pulse-mini');
    var countdownEl = widget.querySelector('#tst-countdown');
    var lastUpEl    = widget.querySelector('#tst-last-update');
 
    // ─── Expand/minimize ────────────────────────────────────────────────────────
    function setExpanded(v) {
      isExpanded = v;
      store.set('tst_expanded', v);
      if (v) {
        removeClass(widget, 'minimized');
        body.style.display    = 'flex';
        toggleBtn.innerHTML   = '&#9660;';
      } else {
        addClass(widget, 'minimized');
        body.style.display    = 'none';
        toggleBtn.innerHTML   = '&#9650;';
      }
    }
    setExpanded(isExpanded);
 
    // ─── Pulse ──────────────────────────────────────────────────────────────────
    function setPulse(cls) {
      pulse.className = cls;
      pulseMini.style.background = cls === 'error' ? '#e53935' : cls === 'loading' ? '#e8c84a' : '#4caf50';
      pulseMini.style.webkitAnimation = cls === 'error' ? 'none' : '';
      pulseMini.style.animation       = cls === 'error' ? 'none' : '';
    }
 
    // ─── Drag (mouse + touch) ────────────────────────────────────────────────────
    var dragging = false, ox = 0, oy = 0, didDrag = false;
 
    function dStart(cx, cy) {
      dragging = true; didDrag = false;
      var r = widget.getBoundingClientRect();
      ox = cx - r.left; oy = cy - r.top;
      addClass(widget, 'dragging');
    }
    function dMove(cx, cy) {
      if (!dragging) return;
      didDrag = true;
      var x = Math.max(0, Math.min(cx - ox, window.innerWidth  - widget.offsetWidth));
      var y = Math.max(0, Math.min(cy - oy, window.innerHeight - widget.offsetHeight));
      applyPosition(x, y);
    }
    function dEnd() {
      if (!dragging) return;
      dragging = false;
      removeClass(widget, 'dragging');
      if (didDrag) {
        var r = widget.getBoundingClientRect();
        store.set('tst_x', r.left); store.set('tst_y', r.top);
        savedX = r.left; savedY = r.top;
      }
    }
 
    header.addEventListener('mousedown', function (e) {
      if (e.target === toggleBtn) return;
      dStart(e.clientX, e.clientY); e.preventDefault();
    });
    document.addEventListener('mousemove', function (e) { dMove(e.clientX, e.clientY); });
    document.addEventListener('mouseup', dEnd);
 
    header.addEventListener('touchstart', function (e) {
      if (e.target === toggleBtn) return;
      if (e.touches && e.touches[0]) dStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!dragging) return;
      if (e.touches && e.touches[0]) dMove(e.touches[0].clientX, e.touches[0].clientY);
      try { e.preventDefault(); } catch (ex) {}
    }, { passive: false });
    document.addEventListener('touchend', dEnd);
 
    header.addEventListener('click', function () { if (didDrag) return; if (!isExpanded) setExpanded(true); });
    toggleBtn.addEventListener('click', function (e) { e.stopPropagation(); setExpanded(!isExpanded); });
 
    // ─── Countdown ──────────────────────────────────────────────────────────────
    var countdown = 30, timer = null;
    function startCountdown() {
      clearInterval(timer); countdown = 30;
      countdownEl.textContent = 'Next refresh: 30s';
      timer = setInterval(function () {
        countdown--;
        countdownEl.textContent = 'Next refresh: ' + countdown + 's';
        if (countdown <= 0) { clearInterval(timer); fetchData(); }
      }, 1000);
    }
 
    // ─── Helpers ────────────────────────────────────────────────────────────────
    function toTitleCase(s) {
      return (s || '').trim().replace(/\w\S*/g, function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      });
    }
    function fmtMoney(v) { return v == null ? '\u2014' : '$' + Math.round(v).toLocaleString(); }
    function fmtNum(v)   { return v == null ? '\u2014' : Math.round(v).toLocaleString(); }
 
    function stockClass(v) {
      if (v == null || v === undefined) return '';
      if (v > 50)  return 'green';
      if (v > 10)  return 'yellow';
      if (v === 0) return 'red';
      return '';
    }
    function profitClass(v) {
      if (v == null || v === undefined) return '';
      if (v > 0) return 'green';
      if (v < 0) return 'red';
      return '';
    }
 
    // ─── Render table ────────────────────────────────────────────────────────────
    function renderTable(itemName, countries) {
      if (!countries || countries.length === 0) {
        tableWrap.innerHTML = '<div id="tst-msg">No data found for ' + itemName + '.</div>';
        return;
      }
 
      var sorted = countries.slice().sort(function (a, b) {
        var av = (a.profitPerMinute != null) ? a.profitPerMinute : -999999999;
        var bv = (b.profitPerMinute != null) ? b.profitPerMinute : -999999999;
        return bv - av;
      });
 
      var html =
        '<table id="tst-table"><thead><tr>' +
        '<th>Country</th>' +
        '<th class="num">Stock</th>' +
        '<th class="num">Restock</th>' +
        '<th class="num">Price</th>' +
        '<th class="num">$/Min</th>' +
        '</tr></thead><tbody>';
 
      for (var i = 0; i < sorted.length; i++) {
        var c  = sorted[i];
        var sc = stockClass(c.stock);
        var pc = profitClass(c.profitPerMinute);
        html +=
          '<tr>' +
          '<td class="country">' + (c.country || '\u2014').toUpperCase() + '</td>' +
          '<td class="num ' + sc + '">' + fmtNum(c.stock) + '</td>' +
          '<td class="num">' + (c.estimatedRestockDisplay || '\u2014') + '</td>' +
          '<td class="num">' + fmtMoney(c.buyPrice) + '</td>' +
          '<td class="num ' + pc + '">' + fmtMoney(c.profitPerMinute) + '</td>' +
          '</tr>';
      }
 
      html += '</tbody></table>';
      tableWrap.innerHTML = html;
    }
 
    // ─── Fetch ───────────────────────────────────────────────────────────────────
    function fetchData() {
      var itemName = toTitleCase(itemInput.value || savedItem);
      store.set('tst_item', itemName); savedItem = itemName;
 
      setPulse('loading');
      addClass(refreshBtn, 'spinning');
      tableWrap.innerHTML = '<div id="tst-msg">Fetching ' + itemName + '&#8230;</div>';
 
      httpGet(
        'https://droqsdb.com/api/public/v1/item/' + encodeURIComponent(itemName),
        function (status, text) {
          removeClass(refreshBtn, 'spinning');
          if (status !== 200) {
            setPulse('error');
            tableWrap.innerHTML = '<div id="tst-msg" class="error">&#9888; ' + itemName + ' not found</div>';
            startCountdown(); return;
          }
          try {
            var data      = JSON.parse(text);
            var countries = (data && data.item && data.item.countries) || [];
            renderTable(itemName, countries);
            setPulse('');
            lastUpEl.textContent = 'Updated ' + new Date().toLocaleTimeString();
            startCountdown();
          } catch (err) {
            setPulse('error');
            tableWrap.innerHTML = '<div id="tst-msg" class="error">&#9888; Parse error</div>';
            startCountdown();
          }
        },
        function (msg) {
          removeClass(refreshBtn, 'spinning');
          setPulse('error');
          tableWrap.innerHTML = '<div id="tst-msg" class="error">&#9888; ' + (msg || 'Network error') + '</div>';
          startCountdown();
        }
      );
    }
 
    // ─── Button events ───────────────────────────────────────────────────────────
    fetchBtn.addEventListener('click', function (e) {
      e.stopPropagation(); clearInterval(timer); fetchData();
    });
    refreshBtn.addEventListener('click', function (e) {
      e.stopPropagation(); clearInterval(timer); fetchData();
    });
 
    var searchRow = widget.querySelector('#tst-search-row');
    searchRow.addEventListener('mousedown',  function (e) { e.stopPropagation(); });
    searchRow.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
 
    itemInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) {
        e.stopPropagation(); clearInterval(timer); fetchData();
      }
    });
 
    // ─── Init ────────────────────────────────────────────────────────────────────
    fetchData();
 
  } // end init()
 
})();