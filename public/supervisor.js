/* ============================================================
 *  PCH SUPERVISOR — client-side controller
 *  Drop-in. No config. Wraps fetch, caches, rate-limits,
 *  circuit-breaks, sanitizes, monitors, and offloads to worker.
 * ============================================================ */
(function (global) {
  'use strict';

  const VERSION = '1.0.0';
  const CACHE_KEY = 'pch_supervisor_cache_v1';

  const CONFIG = {
    rateLimit: { capacity: 60, refillPerSec: 30 },
    retry: { attempts: 3, baseDelayMs: 300, maxDelayMs: 4000, jitterMs: 150, retryOn: [408, 429, 500, 502, 503, 504] },
    circuit: { failureThreshold: 5, resetTimeoutMs: 30000, halfOpenSuccesses: 1, windowMs: 60000 },
    cache: { defaultTTLMs: 60000, maxEntries: 250, persistToLocalStorage: true, cacheMethods: ['GET'] },
    security: {
      maxBodyBytes: 5 * 1024 * 1024,
      allowedProtocols: ['http:', 'https:'],
      blockedPatterns: [/<script\b/i, /javascript:/i, /onerror\s*=/i, /onload\s*=/i, /eval\s*\(/i, /document\.cookie/i, /\.\.\//, /%00/, /union\s+select/i]
    },
    timeout: { defaultMs: 20000 },
    health: { snapshotIntervalMs: 30000, keepSnapshots: 10 },
    worker: { url: 'worker.js', heartbeatIntervalMs: 15000, heartbeatTimeoutMs: 45000, maxRestarts: 10 },
    logging: { ringBufferSize: 250, consoleMinLevel: 'warn', telegramOnErrors: true, telegramBatchMs: 60000 }
  };

  // ── Logging ───────────────────────────────────────────────
  const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
  const logBuffer = [];
  const counters = { request: 0, error: 0, cacheHit: 0, cacheMiss: 0, circuitOpen: 0, retry: 0, workerRestart: 0, blocked: 0 };
  const startedAt = Date.now();
  let pendingErrorsForTelegram = [];

  function log(level, category, detail) {
    const entry = { t: new Date().toISOString(), level, cat: category, detail: detail && typeof detail === 'object' ? detail : { msg: String(detail || '') } };
    logBuffer.push(entry);
    if (logBuffer.length > CONFIG.logging.ringBufferSize) logBuffer.shift();
    if (LEVELS[level] >= LEVELS[CONFIG.logging.consoleMinLevel]) {
      try { (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)('[Supervisor:' + category + ']', detail); } catch (e) {}
    }
    if (level === 'error' && CONFIG.logging.telegramOnErrors) pendingErrorsForTelegram.push(entry);
  }

  // ── Circuit breaker (per host) ────────────────────────────
  const circuits = new Map();
  function getCircuit(host) {
    if (!circuits.has(host)) circuits.set(host, { state: 'closed', failures: [], openedAt: 0, successes: 0 });
    return circuits.get(host);
  }
  function circuitAllow(host) {
    const c = getCircuit(host);
    if (c.state === 'closed') return true;
    if (c.state === 'open') {
      if (Date.now() - c.openedAt >= CONFIG.circuit.resetTimeoutMs) { c.state = 'half-open'; c.successes = 0; return true; }
      return false;
    }
    return true;
  }
  function circuitSuccess(host) {
    const c = getCircuit(host);
    if (c.state === 'half-open') {
      c.successes++;
      if (c.successes >= CONFIG.circuit.halfOpenSuccesses) { c.state = 'closed'; c.failures = []; }
    }
  }
  function circuitFailure(host) {
    const c = getCircuit(host);
    const now = Date.now();
    c.failures = c.failures.filter(t => now - t < CONFIG.circuit.windowMs);
    c.failures.push(now);
    if (c.state === 'half-open' || c.failures.length >= CONFIG.circuit.failureThreshold) {
      c.state = 'open';
      c.openedAt = now;
      counters.circuitOpen++;
      log('warn', 'circuit', { host, state: 'open', failures: c.failures.length });
    }
  }

  // ── Rate limiter (token bucket per host) ──────────────────
  const buckets = new Map();
  function rateAllow(host) {
    if (!buckets.has(host)) buckets.set(host, { tokens: CONFIG.rateLimit.capacity, lastRefill: Date.now() });
    const b = buckets.get(host);
    const now = Date.now();
    b.tokens = Math.min(CONFIG.rateLimit.capacity, b.tokens + ((now - b.lastRefill) / 1000) * CONFIG.rateLimit.refillPerSec);
    b.lastRefill = now;
    if (b.tokens >= 1) { b.tokens -= 1; return true; }
    return false;
  }

  // ── LRU + TTL cache ───────────────────────────────────────
  const cache = new Map();
  function cacheKey(method, url, body) {
    let bodyHash = '';
    if (body) {
      let h = 0; const s = typeof body === 'string' ? body : JSON.stringify(body);
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
      bodyHash = h.toString(36);
    }
    return VERSION + '|' + method + '|' + url + '|' + bodyHash;
  }
  function cacheGet(key) {
    const e = cache.get(key);
    if (!e) return null;
    if (e.exp && e.exp < Date.now()) { cache.delete(key); return null; }
    cache.delete(key); cache.set(key, e);
    try { return e.value.clone ? e.value.clone() : e.value; } catch (err) { cache.delete(key); return null; }
  }
  function cacheSet(key, value, ttlMs) {
    if (cache.size >= CONFIG.cache.maxEntries) {
      const first = cache.keys().next().value;
      if (first !== undefined) cache.delete(first);
    }
    cache.set(key, { value, exp: ttlMs > 0 ? Date.now() + ttlMs : 0 });
    if (CONFIG.cache.persistToLocalStorage) persistCache();
  }
  function persistCache() {
    try {
      const now = Date.now(); const out = {};
      for (const [k, v] of cache) if (!v.exp || v.exp > now) out[k] = v;
      localStorage.setItem(CACHE_KEY, JSON.stringify(out));
    } catch (e) {
      try { localStorage.removeItem(CACHE_KEY); } catch (_) {}
      log('warn', 'cache', { msg: 'persist failed, memory only' });
    }
  }
  function restoreCache() {
    if (!CONFIG.cache.persistToLocalStorage) return;
    try {
      const raw = localStorage.getItem(CACHE_KEY); if (!raw) return;
      const parsed = JSON.parse(raw); const now = Date.now();
      for (const k of Object.keys(parsed)) {
        const v = parsed[k];
        if (v && (!v.exp || v.exp > now)) cache.set(k, v);
      }
    } catch (e) {}
  }

  // ── Sanitization ──────────────────────────────────────────
  function sanitizeUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, location.href);
      if (!CONFIG.security.allowedProtocols.includes(u.protocol)) return { ok: false, reason: 'protocol' };
      for (const pat of CONFIG.security.blockedPatterns) if (pat.test(u.href)) return { ok: false, reason: 'url-pattern' };
      return { ok: true, url: u.href, host: u.host };
    } catch (e) { return { ok: false, reason: 'invalid-url' }; }
  }
  function sanitizeBody(body) {
    if (body == null) return { ok: true };
    if (body instanceof FormData || body instanceof Blob) return { ok: true };
    const s = typeof body === 'string' ? body : JSON.stringify(body);
    if (s.length > CONFIG.security.maxBodyBytes) return { ok: false, reason: 'body-too-large' };
    for (const pat of CONFIG.security.blockedPatterns) if (pat.test(s)) return { ok: false, reason: 'body-pattern' };
    return { ok: true };
  }

  // ── Fetch wrapper ─────────────────────────────────────────
  const nativeFetch = global.fetch ? global.fetch.bind(global) : null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function supervisedFetch(input, init) {
    init = init || {}; counters.request++;
    const urlStr = typeof input === 'string' ? input : (input && input.url) || '';
    const uCheck = sanitizeUrl(urlStr);
    if (!uCheck.ok) { counters.blocked++; log('error', 'security', { msg: 'url blocked', reason: uCheck.reason, url: urlStr }); throw new Error('Supervisor: url blocked'); }
    const bCheck = sanitizeBody(init.body);
    if (!bCheck.ok) { counters.blocked++; log('error', 'security', { msg: 'body blocked', reason: bCheck.reason }); throw new Error('Supervisor: body blocked'); }
    const host = uCheck.host, method = (init.method || 'GET').toUpperCase();

    if (!rateAllow(host)) { counters.blocked++; log('warn', 'rate-limit', { host }); throw new Error('Supervisor: rate limit ' + host); }
    if (!circuitAllow(host)) { log('warn', 'circuit', { host, msg: 'fast fail' }); throw new Error('Supervisor: circuit open ' + host); }

    const cacheable = CONFIG.cache.cacheMethods.includes(method);
    const ckey = cacheable ? cacheKey(method, uCheck.url, init.body) : null;
    if (cacheable) {
      const hit = cacheGet(ckey);
      if (hit) { counters.cacheHit++; return hit; }
      counters.cacheMiss++;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), init.timeoutMs || CONFIG.timeout.defaultMs);
    if (init.signal) { try { init.signal.addEventListener('abort', () => controller.abort()); } catch (e) {} }
    const attemptInit = Object.assign({}, init, { signal: controller.signal });

    let lastErr = null;
    for (let attempt = 1; attempt <= CONFIG.retry.attempts; attempt++) {
      try {
        const res = await nativeFetch(uCheck.url, attemptInit);
        clearTimeout(timer);
        if (CONFIG.retry.retryOn.includes(res.status) && attempt < CONFIG.retry.attempts) {
          counters.retry++;
          const delay = Math.min(CONFIG.retry.maxDelayMs, CONFIG.retry.baseDelayMs * Math.pow(2, attempt - 1)) + Math.random() * CONFIG.retry.jitterMs;
          log('debug', 'retry', { host, status: res.status, attempt });
          await sleep(delay); continue;
        }
        if (!res.ok) { circuitFailure(host); counters.error++; } else circuitSuccess(host);
        if (cacheable && res.ok) { try { cacheSet(ckey, res.clone(), CONFIG.cache.defaultTTLMs); } catch (e) {} }
        return res;
      } catch (err) {
        clearTimeout(timer); lastErr = err;
        if (attempt < CONFIG.retry.attempts) {
          counters.retry++;
          const delay = Math.min(CONFIG.retry.maxDelayMs, CONFIG.retry.baseDelayMs * Math.pow(2, attempt - 1)) + Math.random() * CONFIG.retry.jitterMs;
          log('debug', 'retry', { host, attempt, err: String(err) });
          await sleep(delay); continue;
        }
        circuitFailure(host); counters.error++;
        log('error', 'fetch', { host, err: String(err) });
        throw err;
      }
    }
    throw lastErr || new Error('Supervisor: fetch failed');
  }
  if (nativeFetch) { try { global.fetch = supervisedFetch; } catch (e) {} }

  // ── Web Worker management ─────────────────────────────────
  const workerState = { instance: null, ready: false, pending: new Map(), jobCounter: 0, heartbeats: 0, lastHeartbeat: 0, restarts: 0 };

  function spawnWorker() {
    if (workerState.restarts >= CONFIG.worker.maxRestarts) { log('error', 'worker', { msg: 'max restarts' }); return; }
    if (workerState.instance) { try { workerState.instance.terminate(); } catch (e) {} workerState.instance = null; }
    try {
      workerState.instance = new Worker(CONFIG.worker.url);
      workerState.instance.onmessage = (ev) => {
        const msg = ev.data || {};
        if (msg.type === 'heartbeat') { workerState.lastHeartbeat = Date.now(); workerState.heartbeats++; return; }
        if (msg.type === 'ready') { workerState.ready = true; log('info', 'worker', { msg: 'ready' }); return; }
        const job = workerState.pending.get(msg.id); if (!job) return;
        workerState.pending.delete(msg.id); if (job.timer) clearTimeout(job.timer);
        msg.ok ? job.resolve(msg.data) : job.reject(new Error(msg.error || 'Worker error'));
      };
      workerState.instance.onerror = (ev) => {
        log('error', 'worker', { msg: 'onerror', err: ev.message || String(ev) });
        workerState.restarts++; counters.workerRestart++;
        for (const [, job] of workerState.pending) { if (job.timer) clearTimeout(job.timer); job.reject(new Error('Worker crashed')); }
        workerState.pending.clear();
        setTimeout(spawnWorker, 1000);
      };
      const watchdog = setInterval(() => {
        if (!workerState.instance) { clearInterval(watchdog); return; }
        if (workerState.lastHeartbeat && Date.now() - workerState.lastHeartbeat > CONFIG.worker.heartbeatTimeoutMs) {
          clearInterval(watchdog);
          log('error', 'worker', { msg: 'heartbeat timeout' });
          workerState.restarts++; counters.workerRestart++;
          try { workerState.instance.terminate(); } catch (e) {}
          workerState.instance = null;
          setTimeout(spawnWorker, 1000);
        }
      }, CONFIG.worker.heartbeatIntervalMs);
      workerState.instance.postMessage({ type: 'init', version: VERSION });
      workerState.lastHeartbeat = Date.now();
    } catch (err) { log('error', 'worker', { msg: 'spawn failed', err: String(err) }); }
  }

  function workerRun(task, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!workerState.instance) { reject(new Error('Worker not available')); return; }
      const id = ++workerState.jobCounter;
      const timer = setTimeout(() => { workerState.pending.delete(id); reject(new Error('Worker timeout: ' + task)); }, timeoutMs || 30000);
      workerState.pending.set(id, { resolve, reject, timer });
      try { workerState.instance.postMessage({ type: 'run', id, task, payload }); }
      catch (err) { workerState.pending.delete(id); clearTimeout(timer); reject(err); }
    });
  }

  // ── Health snapshots ──────────────────────────────────────
  const healthSnapshots = [];
  function takeHealthSnapshot() {
    let memMB = null;
    try { if (performance.memory) memMB = Math.round(performance.memory.usedJSHeapSize / 1048576); } catch (e) {}
    const snap = {
      t: Date.now(), uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      counters: Object.assign({}, counters),
      circuits: Array.from(circuits.entries()).map(([host, c]) => ({ host, state: c.state, failures: c.failures.length })),
      cacheSize: cache.size, logSize: logBuffer.length,
      worker: { ready: workerState.ready, restarts: workerState.restarts, heartbeats: workerState.heartbeats, pending: workerState.pending.size, lastHeartbeatAgo: workerState.lastHeartbeat ? Date.now() - workerState.lastHeartbeat : null },
      memMB
    };
    healthSnapshots.push(snap);
    if (healthSnapshots.length > CONFIG.health.keepSnapshots) healthSnapshots.shift();
    return snap;
  }
  setInterval(takeHealthSnapshot, CONFIG.health.snapshotIntervalMs);
  takeHealthSnapshot();

  // ── Global error capture ──────────────────────────────────
  global.addEventListener('error', (ev) => {
    counters.error++;
    log('error', 'global-error', { message: ev.message, source: ev.filename, lineno: ev.lineno, stack: ev.error && ev.error.stack ? String(ev.error.stack).split('\n').slice(0, 4).join(' | ') : null });
  });
  global.addEventListener('unhandledrejection', (ev) => {
    counters.error++;
    const r = ev.reason;
    log('error', 'unhandled-rejection', { reason: r && r.message ? r.message : String(r), stack: r && r.stack ? String(r.stack).split('\n').slice(0, 4).join(' | ') : null });
  });
  global.addEventListener('securitypolicyviolation', (ev) => {
    counters.blocked++;
    log('warn', 'csp', { directive: ev.violatedDirective, blocked: ev.blockedURI });
  });

  // ── Telegram error batch (uses native fetch to avoid recursion) ──
  function flushTelegramErrors() {
    if (!CONFIG.logging.telegramOnErrors || pendingErrorsForTelegram.length === 0) return;
    let cfg = null;
    try { const st = JSON.parse(localStorage.getItem('pch_device_state_v13') || '{}'); cfg = st.telegramConfig || null; } catch (e) {}
    if (!cfg || !cfg.botToken || !cfg.chatId) { pendingErrorsForTelegram = []; return; }
    const batch = pendingErrorsForTelegram.splice(0, 20);
    const lines = batch.map(e => '• [' + e.cat + '] ' + (e.detail.msg || e.detail.message || e.detail.reason || '') + ' @ ' + e.t).join('\n');
    const msg = '⚠️ <b>SUPERVISOR ERROR BATCH (' + batch.length + ')</b>\n' + (lines.length > 3500 ? lines.slice(0, 3500) + '\n…' : lines);
    if (!nativeFetch) return;
    try {
      const fd = new FormData();
      fd.append('chat_id', cfg.chatId); fd.append('text', msg); fd.append('parse_mode', 'HTML');
      nativeFetch('https://api.telegram.org/bot' + cfg.botToken + '/sendMessage', { method: 'POST', body: fd }).catch(() => {});
    } catch (e) {}
  }
  setInterval(flushTelegramErrors, CONFIG.logging.telegramBatchMs);

  // ── Public API ────────────────────────────────────────────
  global.Supervisor = {
    version: VERSION, config: CONFIG, log,
    health: () => ({
      current: takeHealthSnapshot(),
      history: healthSnapshots.slice(-5),
      circuits: Array.from(circuits.entries()).map(([host, c]) => ({ host, state: c.state, failures: c.failures.length })),
      counters: Object.assign({}, counters),
      worker: { spawned: !!workerState.instance, ready: workerState.ready, restarts: workerState.restarts, pending: workerState.pending.size }
    }),
    cache: { get: cacheGet, set: cacheSet, clear: () => { cache.clear(); try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }, size: () => cache.size },
    worker: { run: workerRun, ready: () => !!workerState.instance && workerState.ready, restart: spawnWorker },
    fetch: supervisedFetch, logs: () => logBuffer.slice(-100), flush: flushTelegramErrors
  };

  // ── Auto-init ─────────────────────────────────────────────
  restoreCache();
  log('info', 'boot', { version: VERSION });
  try { spawnWorker(); } catch (e) {}

})(typeof window !== 'undefined' ? window : this);