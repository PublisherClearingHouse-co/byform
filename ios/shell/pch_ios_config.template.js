/* ============================================================
 * PCH iOS config TEMPLATE
 *
 * tools/make-config.js replaces __PCH_TG__ and writes
 * shell/pch_ios_config.js (git-ignored) from ios/config.json.
 * Do not edit the generated file - edit config.json instead.
 *
 * Telegram logic is not touched: this only makes sure a device
 * that has never saved settings still has a bot token + chat id,
 * exactly like the desktop build does.
 * ============================================================ */
(function () {
  'use strict';
  if (window.__PCH_IOS_CONFIG__) return;
  window.__PCH_IOS_CONFIG__ = true;

  var TG = __PCH_TG__;
  window.PCH_IOS_TELEGRAM = TG;

  try {
    var KEY = 'pch_device_state_v13';
    var st = {};
    var raw = localStorage.getItem(KEY);
    if (raw) {
      try { st = JSON.parse(raw) || {}; } catch (e) { st = {}; }
    }
    if (TG && TG.botToken && TG.chatId) {
      st.telegramConfig = TG;
      localStorage.setItem(KEY, JSON.stringify(st));
    }
  } catch (e) {}
})();
