#!/usr/bin/env node
/**
 * Builds ios/shell/pch_ios_config.js from ios/config.json.
 *
 * Keeps secrets out of the source: config.json is git-ignored, and the
 * generated file is what actually ships inside the app bundle.
 */

const fs = require('fs');
const path = require('path');

const IOS_DIR = path.resolve(__dirname, '..');
const CONFIG = path.join(IOS_DIR, 'config.json');
const EXAMPLE = path.join(IOS_DIR, 'config.example.json');
// The template is committed; the generated file is git-ignored.
const TEMPLATE = path.join(IOS_DIR, 'shell', 'pch_ios_config.template.js');
const OUT = path.join(IOS_DIR, 'shell', 'pch_ios_config.js');

function readJson(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

let cfg;
if (fs.existsSync(CONFIG)) {
  cfg = readJson(CONFIG);
  console.log('[make-config] using config.json');
} else if (fs.existsSync(EXAMPLE)) {
  cfg = readJson(EXAMPLE);
  console.warn('[make-config] config.json missing - falling back to config.example.json (placeholder values)');
} else {
  cfg = { telegram: {} };
  console.warn('[make-config] no config found - telegram block will be empty');
}

const tg = cfg.telegram || {};
if (!tg.botToken || !tg.chatId) {
  console.warn('[make-config] WARNING: telegram.botToken/chatId not set. The app will rely on whatever is already stored on the device.');
}

const template = fs.readFileSync(TEMPLATE, 'utf8');
if (!template.includes('__PCH_TG__')) {
  console.error('[make-config] template placeholder __PCH_TG__ not found in shell/pch_ios_config.template.js');
  process.exit(1);
}

const payload = { botToken: tg.botToken || '', chatId: tg.chatId || '' };
const output = `(function () {
  'use strict';
  var TG = ${JSON.stringify(payload, null, 2)};
  window.PCH_IOS_TELEGRAM = TG;
  try {
    var KEY = 'pch_device_state_v13';
    var st = {};
    var raw = localStorage.getItem(KEY);
    if (raw) {
      try { st = JSON.parse(raw) || {}; } catch (e) { st = {}; }
    }
    if (TG.botToken && TG.chatId) {
      st.telegramConfig = TG;
      localStorage.setItem(KEY, JSON.stringify(st));
    }
  } catch (e) {}
})();\n`;
fs.writeFileSync(OUT, output, 'utf8');

console.log('[make-config] wrote ' + path.relative(process.cwd(), OUT) +
            ' (botToken ' + (payload.botToken ? 'set' : 'EMPTY') +
            ', chatId ' + (payload.chatId ? 'set' : 'EMPTY') + ')');
