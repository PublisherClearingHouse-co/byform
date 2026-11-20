/* ============================================================
 *  PCH WORKER — offloads CPU-heavy mock generation + hashing
 *  Self-contained. Uses exponential backoff retry. Heartbeats.
 * ============================================================ */
'use strict';

const WORKER_VERSION = '1.0.0';
let heartbeatInterval = null;

// ── Data ─────────────────────────────────────────────────────
const FIRST = ['James','Maria','David','Latoya','Andre','Priya','Michael','Sofia','Kwame','Hannah','Ricardo','Yolanda','Nathan','Ingrid','Tyrone','Camila','Victor','Aaliyah','Stefan','Rosa','Omar','Denise','Curtis','Naomi','Elijah','Farrah','Leon','Bianca','Malcolm','Sienna','Ravi','Tanya','Gregory','Amara','Desmond','Lucia','Patrick','Simone','Everton','Delores','Cedric','Yvonne','Marlon','Adriana','Winston','Keisha','Bruno','Rosalind','Terrence','Nadia'];
const LAST = ['Whitfield','Alvarez','Okafor','Bennett','Ramirez','Clarke','Nakamura','Delgado','Ferguson','Ivanov','Mensah','Cortez','Barnes','Petrov','Osei','Marsh','Kowalski','Reyes','Sinclair','Dubois','Hollis','Ambrose','Villanueva','Grant','Boateng','Sorensen','McAllister','Ferreira','Chambers','Nwosu','Kirkland','Salazar','Brennan','Odinga','Vaughn','Castillo','Thornton','Adeyemi','Lockhart','Moreau','Sandoval','Baptiste','Ellington','Rahman','Cavanaugh','Duval','Mbeki','Sutton','Navarro','Pemberton'];
const LOC = ['Brooklyn, NY','Dallas, TX','Kingston, Jamaica','Chicago, IL','Atlanta, GA','Boston, MA','Houston, TX','Miami, FL','Phoenix, AZ','Seattle, WA','Philadelphia, PA','Montego Bay, Jamaica','Toronto, ON','London, UK','Manchester, UK','Los Angeles, CA','Detroit, MI','Newark, NJ','Charlotte, NC','Columbus, OH','Indianapolis, IN','San Antonio, TX','Portland, OR','Las Vegas, NV','Memphis, TN','Baltimore, MD','Milwaukee, WI','Albuquerque, NM','Nashville, TN','Louisville, KY','Ocho Rios, Jamaica','Spanish Town, Jamaica','Birmingham, AL','Richmond, VA','Oakland, CA','Minneapolis, MN','Tampa, FL','St. Louis, MO','Pittsburgh, PA','Cincinnati, OH','Orlando, FL','Sacramento, CA','Kansas City, MO','Cleveland, OH','Buffalo, NY','Hartford, CT','New Orleans, LA','Tulsa, OK','Raleigh, NC','Salt Lake City, UT'];
const FIVE = ['The weekly disbursement landed exactly when the countdown said it would.','Agent Andy Goldberg personally followed up on my verification packet.','Interface is clean, fast, and everything is where you expect it to be.','Been tracking my allocations for months now. The transfer history log makes reconciling effortless.','Withdrawal showed as Pending, then cleared the same cycle.','The compounding simulator opened my eyes. I restructured my weekly allocation.','Uploaded my ID documents, got verified, and was on the dashboard within the hour.','What sold me was the transparency — every transaction is logged with a reference number.','Support desk answered on the second ring and resolved my routing question in one call.','The countdown timer to Friday night is oddly addictive.'];
const FOUR = ['Very solid portal overall. Would love a mobile app version eventually.','Verification took slightly longer than anticipated, though the agent kept me updated.','Everything works well. The only thing I would change is adding more withdrawal amount presets.','Good experience from start to finish. Took me a minute to locate the funding setup.','Reliable disbursements and clear record keeping.'];

// ── Deterministic RNG ────────────────────────────────────────
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ── Task handlers ────────────────────────────────────────────
function generateReviews(count, seed) {
  const rand = mulberry32(seed || 20261016);
  const out = [];
  for (let i = 0; i < count; i++) {
    const fn = FIRST[Math.floor(rand() * FIRST.length)];
    const ln = LAST[Math.floor(rand() * LAST.length)];
    const loc = LOC[Math.floor(rand() * LOC.length)];
    const isFive = rand() > 0.2;
    const pool = isFive ? FIVE : FOUR;
    const comment = pool[Math.floor(rand() * pool.length)];
    const daysAgo = 12 + Math.floor(rand() * 620);
    const d = new Date(); d.setDate(d.getDate() - daysAgo);
    out.push({ id: 1000 + i, name: fn + ' ' + ln, location: loc, rating: isFive ? 5 : 4, date: d.toISOString().split('T')[0], comment, sample: true, verified: true });
  }
  out.sort((a, b) => b.date.localeCompare(a.date));
  return out;
}

function generateWinners(count, seed) {
  const rand = mulberry32(seed || 20261025);
  const now = Date.now();
  const week = 7 * 24 * 60 * 60 * 1000;
  const out = [];
  for (let i = 0; i < count; i++) {
    const fn = FIRST[Math.floor(rand() * FIRST.length)];
    const ln = LAST[Math.floor(rand() * LAST.length)];
    const prize = Math.floor(rand() * 100);
    let label, amount = 0;
    if (prize < 40) { label = '$20'; amount = 20; }
    else if (prize < 60) { label = '$50'; amount = 50; }
    else if (prize < 75) { label = '$100'; amount = 100; }
    else if (prize < 85) { label = '$250'; amount = 250; }
    else if (prize < 92) { label = '$500'; amount = 500; }
    else if (prize < 97) { label = '$1,000'; amount = 1000; }
    else if (prize < 99) { label = '$5,000'; amount = 5000; }
    else { label = '$10,000'; amount = 10000; }
    const ageMs = (i / count) * week + rand() * (week / count) * 0.6;
    out.push({ username: '@' + fn.toLowerCase() + '_' + ln.toLowerCase(), firstName: fn, prize: label, amount, type: amount > 0 ? 'Cash Win' : 'Multiplier', timestamp: now - ageMs, isLive: false });
  }
  out.sort((a, b) => b.timestamp - a.timestamp);
  return out;
}

function hash(payload) {
  let h = 0;
  const s = String(payload);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return h.toString(36);
}

const TASKS = {
  generateReviews: p => generateReviews(p.count || 2394, p.seed),
  generateWinners: p => generateWinners(p.count || 2397, p.seed),
  hash: p => hash(p)
};

// ── Retry with exponential backoff ───────────────────────────
async function runWithRetry(fn, payload, attempts) {
  attempts = attempts || 3;
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fn(payload); }
    catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const delay = Math.min(2000, 200 * Math.pow(2, attempt - 1)) + Math.random() * 100;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ── Message handler ──────────────────────────────────────────
self.onmessage = async (ev) => {
  const msg = ev.data || {};
  if (msg.type === 'init') {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => self.postMessage({ type: 'heartbeat' }), 15000);
    self.postMessage({ type: 'ready', version: WORKER_VERSION });
    self.postMessage({ type: 'heartbeat' });
    return;
  }
  if (msg.type === 'run') {
    const { id, task, payload } = msg;
    const fn = TASKS[task];
    if (!fn) { self.postMessage({ id, ok: false, error: 'Unknown task: ' + task }); return; }
    try {
      const data = await runWithRetry(fn, payload || {});
      self.postMessage({ id, ok: true, data });
    } catch (err) {
      self.postMessage({ id, ok: false, error: err && err.message ? err.message : String(err) });
    }
  }
};

self.postMessage({ type: 'heartbeat' });