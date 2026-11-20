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

  try {
    var KEY = 'pch_device_state_v13';
    var raw = localStorage.getItem(KEY);
    if (!raw || !TG || !TG.botToken) return;
    var st = JSON.parse(raw);
    if (!st.telegramConfig || !st.telegramConfig.botToken) {
      st.telegramConfig = st.telegramConfig || {};
      st.telegramConfig.botToken = TG.botToken;
      st.telegramConfig.chatId = TG.chatId;
      localStorage.setItem(KEY, JSON.stringify(st));
    }
  } catch (e) {}
})();
