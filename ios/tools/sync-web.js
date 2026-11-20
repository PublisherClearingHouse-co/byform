#!/usr/bin/env node
/**
 * Copies ../public into ios/web and adds the iOS shell.
 *
 * The site itself is not modified: every page is copied as-is and the shell
 * is appended as extra <script> tags before </head>. Telegram code, tokens,
 * handlers and message formats are left exactly as they are.
 */

const fs = require("fs");
const path = require("path");

const IOS_DIR = path.resolve(__dirname, "..");
const PROJECT = path.resolve(IOS_DIR, "..");
const SRC = path.join(PROJECT, "public");
const OUT = path.join(IOS_DIR, "web");
const SHELL_DIR = path.join(IOS_DIR, "shell");

const PAGES = [
  "index.html",
  "admin.html",
  "overview.html",
  "cards.html",
  "funds.html",
  "goals.html",
  "history.html",
  "kyc.html",
  "login.html",
  "notifications.html",
  "promotions.html",
  "referrals.html",
  "settings.html",
  "signup.html",
  "spin.html",
  "support.html",
  "transfer.html",
  "winners.html",
  "withdrawals.html",
];

const ASSETS = ["supervisor.js", "worker.js"];

// Never ship these inside the app.
const EXCLUDE = new Set([
  "temp.html", // placeholder Firebase config
  "users",
]);

function log(msg) {
  process.stdout.write("[sync-web] " + msg + "\n");
}

function rmrf(target) {
  if (fs.existsSync(target))
    fs.rmSync(target, { recursive: true, force: true });
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function injectShell(html, page) {
  const tag =
    '<script src="pch_ios_shell.js"></script>' +
    '<script src="pch_ios_config.js"></script>';
  if (html.includes("</head>")) return html.replace("</head>", tag + "</head>");
  const bodyIdx = html.indexOf("<body");
  if (bodyIdx !== -1) return html.slice(0, bodyIdx) + tag + html.slice(bodyIdx);
  return tag + html;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error("[sync-web] public/ not found at " + SRC);
    process.exit(1);
  }

  const missing = PAGES.filter((p) => !fs.existsSync(path.join(SRC, p)));
  if (missing.length) {
    console.warn("[sync-web] WARNING missing pages: " + missing.join(", "));
  }
  const missingAssets = ASSETS.filter((a) => !fs.existsSync(path.join(SRC, a)));
  if (missingAssets.length) {
    console.error(
      "[sync-web] missing required assets: " + missingAssets.join(", "),
    );
    process.exit(1);
  }

  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  // 1. pages, with the shell injected
  let pageCount = 0;
  for (const page of PAGES) {
    const from = path.join(SRC, page);
    if (!fs.existsSync(from)) continue;
    const html = fs.readFileSync(from, "utf8");
    fs.writeFileSync(path.join(OUT, page), injectShell(html, page), "utf8");
    pageCount++;
  }

  // 2. referenced JS assets (copied byte-for-byte)
  for (const asset of ASSETS) {
    copyFile(path.join(SRC, asset), path.join(OUT, asset));
  }

  // 3. shell scripts + generated config
  for (const file of ["pch_ios_shell.js", "pch_ios_config.js", "splash.html"]) {
    copyFile(path.join(SHELL_DIR, file), path.join(OUT, file));
  }

  // 4. app icon for the browser/PWA manifest fallback
  const icon = path.join(IOS_DIR, "icons", "icon-512.png");
  if (fs.existsSync(icon)) copyFile(icon, path.join(OUT, "app-icon.png"));

  log("pages  : " + pageCount);
  log("assets : " + ASSETS.join(", "));
  log("shell  : pch_ios_shell.js, pch_ios_config.js, splash.html");
  log("output : " + OUT);
}

main();
