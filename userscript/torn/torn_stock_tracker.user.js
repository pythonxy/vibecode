// ==UserScript==
// @name         Torn Foreign Stock Tracker
// @namespace    https://www.torn.com/
// @version      1.5.7
// @description  Track item stock prices with dynamic height and spinning refresh.
// @author       pythonxyz [3923535]
// @match        https://www.torn.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      droqsdb.com
// @downloadURL https://github.com/pythonxy/vibecode/raw/refs/heads/main/userscript/torn/torn_stock_tracker.user.js
// @updateURL https://github.com/pythonxy/vibecode/raw/refs/heads/main/userscript/torn/torn_stock_tracker.user.js
// ==/UserScript==

(function () {
  'use strict';

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

  function httpGet(url, onload, onerror) {
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'GET', url: url, timeout: 10000,
        onload:   function (r) { onload(r.status, r.responseText); },
        onerror:  function ()  { onerror('Network error'); },
        ontimeout: function () { onerror('Request timed out'); }
      });
    } else {
      fetch(url).then(r => r.text().then(t => onload(r.status, t))).catch(e => onerror(e.message));
    }
  }

  var savedItem = store.get('tst_item', 'Xanax');
  var isExpanded = store.get('tst_expanded', true);
  var savedX = store.get('tst_x', null);
  var savedY = store.get('tst_y', null);

  var style = document.createElement('style');
  style.textContent = [
    '#tst-widget{position:fixed;z-index:99999;font-family:"Courier New",monospace;width:400px;background:#111;border-radius:6px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.55);border:1px solid #3a3a3a;user-select:none;height:auto;min-height:0;}',
    '#tst-widget.minimized{width:46px!important;height:46px!important;min-height:46px!important;border-radius:50%!important;cursor:pointer;}',
    '#tst-widget.minimized #tst-header{width:46px;height:46px;padding:0;justify-content:center;border-bottom:none;background: #1a1a1a;}',
    '#tst-widget.minimized #tst-header-title, #tst-widget.minimized #tst-header-right, #tst-widget.minimized #tst-body{display:none!important;}',
    '#tst-bubble-label{display:none;font-size:13px;font-weight:bold;color:#e8c84a;pointer-events:none;}',
    '#tst-widget.minimized #tst-bubble-label{display:block;}',
    '#tst-header{background:#1a1a1a;padding:7px 10px;cursor:grab;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #333;}',
    '#tst-header-title{color:#e8c84a;font-weight:bold;display:flex;align-items:center;gap:6px;font-size:12px;}',
    '#tst-pulse{width:7px;height:7px;border-radius:50%;background:#4caf50;}',
    '.loading#tst-pulse{background:#e8c84a;animation:tst-p 0.6s infinite;}',
    '.error#tst-pulse{background:#ef5350;}',
    '@keyframes tst-p{0%,100%{opacity:1}50%{opacity:.3}}',
    '#tst-toggle-btn{color:#888;cursor:pointer;font-size:14px;padding:0 4px;}',
    '#tst-body{display:flex;flex-direction:column;}',
    '#tst-inputs{display:flex;gap:6px;padding:8px 10px;border-bottom:1px solid #222;}',
    '.tst-input{flex:1;background:#1e1e1e;border:1px solid #333;border-radius:4px;color:#ddd;padding:4px 6px;outline:none;font-size:11px;}',
    '#tst-fetch-btn{background:#e8c84a;color:#111;border:none;border-radius:4px;font-weight:bold;padding:4px 10px;cursor:pointer;}',
    '#tst-output{padding:5px 10px 10px; max-height: 350px; overflow-y: auto;}',
    '#tst-output::-webkit-scrollbar {width: 4px;}',
    '#tst-output::-webkit-scrollbar-thumb {background: #333; border-radius: 2px;}',
    '.tst-table{width:100%;border-collapse:collapse;font-size:11px;}',
    '.tst-table th{text-align:left;color:#e8c84a;font-size:10px;padding:5px 2px;border-bottom:1px solid #333; position: sticky; top: 0; background: #111;}',
    '.tst-table td{padding:5px 2px;border-bottom:1px solid #1a1a1a;color:#e0e0e0;}',
    '.green{color:#66bb6a!important;} .yellow{color:#e8c84a!important;} .red{color:#ef5350!important;}',
    '#tst-footer{display:flex;justify-content:space-between;padding:4px 10px;background:#0d0d0d;font-size:10px;color:#444;border-top:1px solid #1e1e1e;}',
    '#tst-refresh-btn{background:transparent;border:1px solid #2a2a2a;color:#555;cursor:pointer; transition: color .15s;}',
    '#tst-refresh-btn.spinning{animation: tst-spin .6s linear infinite; color: #e8c84a;}',
    '@keyframes tst-spin{to{transform:rotate(360deg)}}'
  ].join('');
  document.head.appendChild(style);

  var widget = document.createElement('div');
  widget.id = 'tst-widget';
  widget.innerHTML = `
    <div id="tst-header">
      <span id="tst-bubble-label">ST</span>
      <div id="tst-header-title"><span id="tst-pulse"></span>Foreign Stock Tracker</div>
      <div id="tst-header-right"><span id="tst-toggle-btn">▼</span></div>
    </div>
    <div id="tst-body">
      <div id="tst-inputs">
        <input class="tst-input" id="tst-item-input" placeholder="Item" value="${savedItem}" />
        <button id="tst-fetch-btn">GO</button>
      </div>
      <div id="tst-output"></div>
      <div id="tst-footer">
        <span id="tst-countdown">30s</span>
        <button id="tst-refresh-btn">↻</button>
        <span id="tst-last-update"></span>
      </div>
    </div>`;
  document.body.appendChild(widget);

  var header = widget.querySelector('#tst-header');
  var body = widget.querySelector('#tst-body');
  var toggleBtn = widget.querySelector('#tst-toggle-btn');
  var output = widget.querySelector('#tst-output');
  var itemInput = widget.querySelector('#tst-item-input');
  var pulse = widget.querySelector('#tst-pulse');
  var refreshBtn = widget.querySelector('#tst-refresh-btn');

  function applyPos(x, y) { widget.style.left = x + 'px'; widget.style.top = y + 'px'; }
  if (savedX !== null) applyPos(savedX, savedY); else { widget.style.bottom='20px'; widget.style.left='20px'; }

  function setExpanded(exp) {
    isExpanded = exp; store.set('tst_expanded', exp);
    if (exp) {
        widget.classList.remove('minimized');
        body.style.display = 'flex';
        toggleBtn.textContent = '▼';
    } else {
        widget.classList.add('minimized');
        body.style.display = 'none';
        toggleBtn.textContent = '▲';
    }
  }
  setExpanded(isExpanded);

  var isDragging = false, dx = 0, dy = 0, didDrag = false;
  function start(e) {
    if (e.target === toggleBtn || e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
    isDragging = true; didDrag = false;
    var r = widget.getBoundingClientRect();
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    dx = cx - r.left; dy = cy - r.top;
  }
  function move(e) {
    if (!isDragging) return;
    didDrag = true;
    var cx = e.touches ? e.touches[0].clientX : e.clientX;
    var cy = e.touches ? e.touches[0].clientY : e.clientY;
    var x = cx - dx, y = cy - dy;
    applyPos(x, y);
    if (e.cancelable) e.preventDefault();
  }
  function end() {
    if (!isDragging) return;
    isDragging = false;
    if (didDrag) {
      var r = widget.getBoundingClientRect();
      store.set('tst_x', r.left); store.set('tst_y', r.top);
    }
  }

  header.addEventListener('mousedown', start);
  header.addEventListener('touchstart', start, {passive: false});
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, {passive: false});
  window.addEventListener('mouseup', end);
  window.addEventListener('touchend', end);

  header.addEventListener('click', (e) => {
    if (didDrag) return;
    if (e.target === toggleBtn || !isExpanded) setExpanded(!isExpanded);
  });

  var count = 30;
  setInterval(() => {
    if (isExpanded) {
        count--;
        widget.querySelector('#tst-countdown').textContent = count + 's';
        if (count <= 0) fetchData();
    }
  }, 1000);

  function fetchData() {
    var item = itemInput.value.trim() || 'Xanax';
    pulse.className = 'loading';
    refreshBtn.classList.add('spinning');

    httpGet('https://droqsdb.com/api/public/v1/item/' + encodeURIComponent(item), (status, text) => {
      count = 30;
      refreshBtn.classList.remove('spinning');
      if (status !== 200) { pulse.className = 'error'; return; }
      try {
        var countries = JSON.parse(text).item.countries;
        var h = '<table class="tst-table"><thead><tr><th>Country</th><th>Stock</th><th>Restock</th><th>Price</th><th>$/Min</th></tr></thead><tbody>';
        countries.forEach(e => {
            var sCls = e.stock > 50 ? 'green' : e.stock > 10 ? 'yellow' : 'red';
            var pCls = e.profitPerMinute > 0 ? 'green' : e.profitPerMinute < 0 ? 'red' : '';
            h += `<tr><td>${e.country.toUpperCase()}</td><td class="${sCls}">${e.stock}</td><td>${e.estimatedRestockDisplay || '—'}</td><td>$${e.buyPrice.toLocaleString()}</td><td class="${pCls}">${e.profitPerMinute ? '$'+e.profitPerMinute.toLocaleString() : '—'}</td></tr>`;
        });
        output.innerHTML = h + '</tbody></table>';
        pulse.className = '';
        widget.querySelector('#tst-last-update').textContent = new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
      } catch(e) { pulse.className = 'error'; }
    }, () => {
        pulse.className = 'error';
        refreshBtn.classList.remove('spinning');
    });
  }

  widget.querySelector('#tst-fetch-btn').onclick = fetchData;
  refreshBtn.onclick = fetchData;
  if (document.readyState === 'complete') {
    fetchData();
  } else {
      window.addEventListener('load', fetchData);
  }
})();