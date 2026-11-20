/* ============================================================
 * PCH iOS shell
 * Keyboard shortcuts + long-press context menu + intro hand-off.
 *
 * Additive only. No page function is replaced, no Telegram code,
 * token, handler or message format is touched.
 * ============================================================ */
(function () {
  'use strict';
  if (window.__PCH_IOS_SHELL__) return;
  window.__PCH_IOS_SHELL__ = true;

  var IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var RELOAD_GUARD_MS = 1200;
  var lastReload = 0;

  /* ---- 1. text-field detection ------------------------------------- */
  function isTextInput(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    var tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      var t = (el.type || 'text').toLowerCase();
      return ['checkbox', 'radio', 'button', 'submit', 'reset', 'file',
              'range', 'color', 'image', 'hidden'].indexOf(t) === -1;
    }
    return false;
  }
  function focused() {
    var el = document.activeElement;
    if (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }
  function activeIsTextInput() { return isTextInput(focused()); }
  function activeIsEditable() {
    var el = focused();
    return !!el && (isTextInput(el) || el.isContentEditable === true);
  }
  function hasSelection() {
    var sel = window.getSelection();
    return !!(sel && sel.toString().length > 0);
  }

  /* ---- 2. reload (page state survives via sessionStorage snapshot) -- */
  try {
    var PREFIX = 'pch_ios_snap_';
    var KEYS = ['pch_device_state_v13', 'pch_user_folder_registry', 'pch_supervisor_cache_v1'];
    KEYS.forEach(function (key) {
      var saved = sessionStorage.getItem(PREFIX + key);
      if (saved !== null) {
        try { localStorage.setItem(key, saved); } catch (e) {}
        sessionStorage.removeItem(PREFIX + key);
      }
    });
  } catch (e) {}

  function doReload() {
    var now = Date.now();
    if (now - lastReload < RELOAD_GUARD_MS) return;
    lastReload = now;
    try {
      ['pch_device_state_v13', 'pch_user_folder_registry', 'pch_supervisor_cache_v1'].forEach(function (key) {
        var v = localStorage.getItem(key);
        if (v !== null) sessionStorage.setItem('pch_ios_snap_' + key, v);
      });
    } catch (e) {}
    try { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); } catch (e) {}
    location.reload();
  }

  /* ---- 3. find bar -------------------------------------------------- */
  var findBar = null, findInput = null, findCount = null;
  function closeFind() { if (findBar) { findBar.remove(); findBar = findInput = findCount = null; } }
  function findNext(back) {
    if (!findInput) return;
    var q = findInput.value;
    if (!q) { findCount.textContent = ''; return; }
    var found = false;
    try { found = window.find(q, false, back === true, true, false, false, false); } catch (e) { found = false; }
    var hits = String(document.body.innerText || '').split(q).length - 1;
    findCount.textContent = found || hits > 0 ? (hits > 0 ? hits + ' hits' : 'found') : 'none';
  }
  function openFind() {
    if (findBar) { findInput.focus(); findInput.select(); return; }
    var sel = window.getSelection();
    var seed = sel && sel.toString().length < 60 ? sel.toString() : '';
    findBar = document.createElement('div');
    findBar.id = 'pch-find-bar';
    findBar.setAttribute('style', [
      'position:fixed', 'top:max(14px,env(safe-area-inset-top))', 'right:12px', 'left:12px',
      'z-index:2147483647', 'display:flex', 'align-items:center', 'gap:8px',
      'background:#0b1220', 'border:1px solid #c8a24a', 'border-radius:12px',
      'padding:8px 10px', 'box-shadow:0 12px 30px rgba(0,0,0,.55)',
      'font:600 13px -apple-system,"Segoe UI",sans-serif', 'color:#e2e8f0'
    ].join(';'));
    findBar.innerHTML =
      '<input id="pch-find-input" placeholder="Find on page" inputmode="search" ' +
      'style="all:unset;flex:1;padding:6px 8px;border-radius:8px;background:#060b14;color:#fff;font-size:16px">' +
      '<span id="pch-find-count" style="color:#94a3b8;font-weight:500;font-size:12px"></span>' +
      '<button id="pch-find-next" style="all:unset;cursor:pointer;padding:4px 8px;color:#c8a24a;font-size:16px">&#9660;</button>' +
      '<button id="pch-find-close" style="all:unset;cursor:pointer;padding:4px 8px;color:#94a3b8;font-size:16px">&#10005;</button>';
    document.documentElement.appendChild(findBar);
    findInput = findBar.querySelector('#pch-find-input');
    findCount = findBar.querySelector('#pch-find-count');
    findInput.value = seed;
    findInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); findNext(ev.shiftKey); }
      else if (ev.key === 'Escape') { ev.preventDefault(); closeFind(); }
    });
    findBar.querySelector('#pch-find-next').onclick = function () { findNext(false); };
    findBar.querySelector('#pch-find-close').onclick = closeFind;
    findInput.focus();
    if (seed) findNext(false);
  }

  /* ---- 4. context menu: long-press on touch, right-click on pointer -- */
  var menu = null;
  function closeMenu() { if (menu) { menu.remove(); menu = null; } }
  function menuItem(label, hint, enabled, fn) {
    var b = document.createElement('div');
    b.textContent = label;
    b.style.cssText = 'padding:12px 14px;border-radius:9px;white-space:nowrap;display:flex;' +
      'justify-content:space-between;gap:18px;font-size:15px;' +
      (enabled ? 'cursor:pointer;color:#e2e8f0' : 'cursor:default;color:#475569');
    if (enabled) {
      b.addEventListener('touchstart', function () { b.style.background = '#1e293b'; }, { passive: true });
      b.addEventListener('touchend', function () { b.style.background = 'transparent'; });
      b.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); closeMenu(); fn(); });
    }
    var h = document.createElement('span');
    h.textContent = hint || '';
    h.style.cssText = 'color:#64748b;font-weight:400;font-size:12px';
    b.appendChild(h);
    return b;
  }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
        return;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e) {}
  }
  function showMenu(x, y) {
    closeMenu();
    var info = { input: activeIsTextInput(), editable: activeIsEditable(), selection: hasSelection() };
    menu = document.createElement('div');
    menu.id = 'pch-context-menu';
    menu.style.cssText = 'position:fixed;z-index:2147483647;min-width:210px;background:#0b1220;' +
      'border:1px solid #334155;border-radius:14px;padding:6px;box-shadow:0 16px 40px rgba(0,0,0,.6);' +
      'font:500 15px -apple-system,"Segoe UI",sans-serif;user-select:none;';
    function sep() {
      var d = document.createElement('div');
      d.style.cssText = 'height:1px;background:#1e293b;margin:5px 4px';
      menu.appendChild(d);
    }
    menu.appendChild(menuItem('Copy', '', info.selection || info.input, function () {
      if (info.selection) copyText(window.getSelection().toString());
      else if (info.input && focused()) copyText(focused().value || '');
    }));
    menu.appendChild(menuItem('Select All', '', true, function () {
      var el = focused();
      if (info.input && el) { try { el.select(); } catch (e) {} }
      else if (document.execCommand) { try { document.execCommand('selectAll'); } catch (e) {} }
    }));
    sep();
    menu.appendChild(menuItem('Find on page', '', true, openFind));
    menu.appendChild(menuItem('Reload', '', true, doReload));
    document.documentElement.appendChild(menu);
    var r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + 'px';
    setTimeout(function () {
      document.addEventListener('touchstart', function (ev) {
        if (menu && !menu.contains(ev.target)) closeMenu();
      }, { once: true, passive: true });
      window.addEventListener('resize', closeMenu, { once: true });
    }, 0);
  }

  // pointer / right click
  window.addEventListener('contextmenu', function (ev) {
    if (ev.defaultPrevented) return;
    ev.preventDefault();
    showMenu(ev.clientX, ev.clientY);
  }, true);

  // long press (iOS has no contextmenu on touch)
  var timer = null, startX = 0, startY = 0, moved = false, longPressed = false;
  window.addEventListener('touchstart', function (ev) {
    if (ev.touches.length !== 1) { clearTimeout(timer); return; }
    var t = ev.touches[0];
    startX = t.clientX; startY = t.clientY; moved = false; longPressed = false;
    if (activeIsTextInput()) return;           // let the system text menu work
    timer = setTimeout(function () {
      longPressed = true;
      showMenu(startX, startY);
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) {} }
    }, 500);
  }, { passive: true });
  window.addEventListener('touchmove', function (ev) {
    var t = ev.touches[0];
    if (!t) return;
    if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
      moved = true;
      clearTimeout(timer);
    }
  }, { passive: true });
  window.addEventListener('touchend', function () {
    clearTimeout(timer);
    if (longPressed && !moved) closeMenu();     // tapping outside dismisses
  }, { passive: true });
  window.addEventListener('touchcancel', function () { clearTimeout(timer); }, { passive: true });

  /* ---- 5. keyboard shortcuts (hardware keyboards on iPad + desktop) -- */
  window.addEventListener('keydown', function (ev) {
    var k = (ev.key || '').toLowerCase();
    var ctrl = (ev.ctrlKey || ev.metaKey) && !ev.altKey;   // iOS maps Cmd <-> Ctrl

    // Shift+R reloads ONLY outside text fields, so typing "R" stays safe.
    if (ev.shiftKey && !ctrl && !ev.altKey && k === 'r' && !activeIsTextInput()) {
      ev.preventDefault();
      doReload();
      return;
    }
    if (ctrl) {
      if (k === 'r' || k === 'f5') { ev.preventDefault(); doReload(); return; }
      if (k === 'f') { ev.preventDefault(); openFind(); return; }
      return;   // C/X/V/A/Z/Y are left to WebKit
    }
    if (k === 'f5') { ev.preventDefault(); doReload(); return; }
    if (k === 'f3') { ev.preventDefault(); if (findBar) findNext(ev.shiftKey); else openFind(); return; }
  }, true);

  /* ---- 6. intro hand-off ------------------------------------------- */
  window.__PCH_INTRO_DONE__ = function () { return true; };

  window.__PCH_IOS_SHELL_INFO__ = {
    version: '1.0.0', ios: IS_IOS, reload: doReload, find: openFind
  };
})();
