// Shared helpers for bank adapters. Output records follow the RateOffer JSON
// schema of packages/rota_engine (lib/src/rate_offer.dart).
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

export const USER_AGENT_NOTE = 'RotaFinansRateCollector/0.1 (internal pricing reference, low frequency)';

export async function launchBrowser() {
  const exe = [
    process.env.CHROME_PATH,
    `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find(existsSync);
  return chromium.launch({ executablePath: exe, headless: true });
}

/** Parses "3.05", "3,05", "%3.05" → "3.05" (string, no float rounding). */
export function normalizeRate(s) {
  const t = String(s).replace('%', '').trim().replace(',', '.');
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(t)) throw new Error(`bad rate "${s}"`);
  return t;
}

/** Parses "2.000.000 TL" → 2000000 */
export function parseTl(s) {
  return Number(String(s).replace(/[^\d,]/g, '').split(',')[0]);
}

/**
 * Groups per-term readings [{term, rate}] (rate as string) into contiguous
 * ranges with the same rate: [{termMin, termMax, rate}].
 */
export function groupTerms(readings) {
  const sorted = [...readings].sort((a, b) => a.term - b.term);
  const out = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && last.rate === r.rate && last.termMax === r.term - 1) last.termMax = r.term;
    else out.push({ termMin: r.term, termMax: r.term, rate: r.rate });
  }
  return out;
}

export function offer({ bankId, bankName, rate, termMin, termMax, amountMin, amountMax,
  insurance, sourceUrl, retrievedAt, conditions }) {
  return {
    bank_id: bankId,
    bank_name: bankName,
    product: 'konut_kredisi',
    rate_monthly_pct: rate,
    rate_type: 'campaign',
    term_min: termMin,
    term_max: termMax,
    amount_min: amountMin == null ? null : String(amountMin),
    amount_max: amountMax == null ? null : String(amountMax),
    insurance_required: !!insurance,
    cross_sell_required: false,
    first_home_only: false,
    participation_bank: false,
    conditions_text: conditions || '',
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    published_at: null,
    verification_status: 'verified',
  };
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
