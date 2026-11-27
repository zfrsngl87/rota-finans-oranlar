// Owner-entered rates (data/manual-rates.json) merged into rates.json.
// Entries come only from the repo owner (GitHub issue form, checked by the
// workflow) and always carry the bank's own source URL and entry time.
// The app applies the usual freshness rules to entered_at (24 h fresh,
// 72 h max), so a manual rate must be re-confirmed regularly.
import { existsSync, readFileSync } from 'node:fs';

export const BANKS = {
  'Akbank': 'akbank', 'Alternatif Bank': 'alternatifbank', 'Anadolubank': 'anadolubank',
  'Garanti BBVA': 'garantibbva', 'Halkbank': 'halkbank', 'ING': 'ing',
  'İş Bankası': 'isbankasi', 'QNB': 'qnb', 'Şekerbank': 'sekerbank', 'TEB': 'teb',
  'VakıfBank': 'vakifbank', 'Yapı Kredi': 'yapikredi', 'Ziraat Bankası': 'ziraatbankasi',
};
const LIMIT_MS = 72 * 3600 * 1000;

/** Validates one entry; returns an error string or null. */
export function validate(e) {
  if (!BANKS[e.bank_name]) return `bilinmeyen banka "${e.bank_name}"`;
  if (!/^\d{1,2}(\.\d{1,4})?$/.test(String(e.rate_monthly_pct))) return 'oran biçimi hatalı';
  const r = Number(e.rate_monthly_pct);
  if (r < 0.5 || r > 10) return 'oran %0,5–%10 aralığında olmalı';
  if (!(Number.isInteger(e.term_min) && Number.isInteger(e.term_max) && e.term_min >= 1 && e.term_max <= 120 && e.term_min <= e.term_max)) return 'vade aralığı 1–120 ay olmalı';
  let u; try { u = new URL(e.source_url); } catch { return 'kaynak bağlantısı hatalı'; }
  if (u.protocol !== 'https:') return 'kaynak bağlantısı https:// ile başlamalı';
  if (Number.isNaN(Date.parse(e.entered_at))) return 'tarih hatalı';
  return null;
}

export function readManual(path) {
  if (!path || !existsSync(path)) return [];
  const j = JSON.parse(readFileSync(path, 'utf8'));
  return Array.isArray(j.entries) ? j.entries : [];
}

/** Converts valid, ≤72 h old manual entries into RateOffer JSON records. */
export function manualOffers(entries, now = Date.now()) {
  return entries
    .filter(e => !validate(e) && now - Date.parse(e.entered_at) <= LIMIT_MS)
    .map(e => ({
      bank_id: BANKS[e.bank_name],
      bank_name: e.bank_name,
      product: 'konut_kredisi',
      rate_monthly_pct: String(e.rate_monthly_pct),
      rate_type: 'manualVerified',
      term_min: e.term_min,
      term_max: e.term_max,
      amount_min: null,
      amount_max: null,
      insurance_required: !!e.insurance_required,
      cross_sell_required: false,
      first_home_only: false,
      participation_bank: false,
      conditions_text: 'Elle onaylandı (ROTA)' + (e.note ? ` · ${e.note}` : ''),
      source_url: e.source_url,
      retrieved_at: new Date(Date.parse(e.entered_at)).toISOString(),
      published_at: null,
      verification_status: 'verified',
    }));
}

/** Replaces all manual offers in a rates document with the current ones. */
export function mergeInto(ratesDoc, entries, now = Date.now()) {
  const auto = (ratesDoc.offers || []).filter(o => o.rate_type !== 'manualVerified');
  return { ...ratesDoc, offers: [...auto, ...manualOffers(entries, now)] };
}
