// Runs every adapter in isolation and writes out/rates.json + out/health.json.
// One failing bank never stops the others (TEST 11).
// Usage: node src/run.mjs [bankId ...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launchBrowser, sleep } from './common.mjs';
import { manualOffers, readManual } from './manual.mjs';
import * as akbank from './adapters/akbank.mjs';
import * as teb from './adapters/teb.mjs';
import * as sekerbank from './adapters/sekerbank.mjs';
import * as anadolubank from './adapters/anadolubank.mjs';
// DenizBank adapter kept for reference but DISABLED: owner decision 2026-11-27
// ("deniz bankı kullanma") — its calculator only covers up to 1.000.000 TL.

const ADAPTERS = [akbank, teb, sekerbank, anadolubank];
const only = process.argv.slice(2);
const selected = ADAPTERS.filter(a => !only.length || only.includes(a.meta.bankId));

// Sanity bounds for a monthly konut kredisi rate (%). Anything outside is
// rejected as malformed (TEST 18). EVDS-based bounds to be added.
const MIN_RATE = 0.5, MAX_RATE = 10;

const browser = await launchBrowser();
const offers = [];
const health = {};
for (const a of selected) {
  const started = Date.now();
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { offers: got, evidence } = await a.collect(browser);
      const bad = got.filter(o => +o.rate_monthly_pct < MIN_RATE || +o.rate_monthly_pct > MAX_RATE);
      if (bad.length) throw new Error(`rates outside ${MIN_RATE}-${MAX_RATE}%: ${bad.map(b => b.rate_monthly_pct)}`);
      if (!got.length) throw new Error('no offers parsed');
      offers.push(...got);
      health[a.meta.bankId] = { status: 'ok', offers: got.length, seconds: Math.round((Date.now() - started) / 1000), attempt, evidence };
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      await sleep(3000);
    }
  }
  if (lastErr) health[a.meta.bankId] = { status: 'failed', error: String(lastErr.message || lastErr) };
  console.log(`${a.meta.bankId}: ${health[a.meta.bankId].status}`);
}
await browser.close();

// A bank that failed this run keeps its previous offers WITH their original
// retrieved_at, so the app's freshness rules (24 h fresh, 72 h max) still
// apply honestly. Offers older than 72 h are dropped here as well.
const previousPath = process.env.PREVIOUS_RATES;
if (previousPath && existsSync(previousPath)) {
  try {
    const prev = JSON.parse(readFileSync(previousPath, 'utf8'));
    const limit = Date.now() - 72 * 3600 * 1000;
    for (const [bankId, h] of Object.entries(health)) {
      if (h.status !== 'failed') continue;
      const kept = (prev.offers || []).filter(o =>
        o.bank_id === bankId && o.rate_type !== 'manualVerified' &&
        Date.parse(o.retrieved_at) > limit);
      offers.push(...kept);
      h.carried_over = kept.length;
    }
  } catch (e) {
    console.log(`previous rates unreadable: ${e.message}`);
  }
}

// Owner-entered rates (GitHub issue form) are added on every run.
const manual = manualOffers(readManual(process.env.MANUAL_RATES));
offers.push(...manual);
health.manual = { entries: manual.length };

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
const generatedAt = new Date().toISOString();
writeFileSync(new URL('../out/rates.json', import.meta.url),
  JSON.stringify({ schema: 1, generated_at: generatedAt, offers }, null, 1));
writeFileSync(new URL('../out/health.json', import.meta.url),
  JSON.stringify({ generated_at: generatedAt, banks: health }, null, 1));
console.log(`offers: ${offers.length}`);
