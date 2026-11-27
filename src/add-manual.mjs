// Used by the "oran-gir" workflow: parses a GitHub issue-form body, appends
// the entry to data/manual-rates.json (replacing the same bank + term range +
// insurance), then re-merges manual offers into data/rates.json.
// Usage: node src/add-manual.mjs <issue-body-file> <entered_at ISO>
// Prints a Turkish result line; exits 1 on invalid input.
import { readFileSync, writeFileSync } from 'node:fs';
import { mergeInto, readManual, validate } from './manual.mjs';

const MANUAL = 'data/manual-rates.json';
const RATES = 'data/rates.json';
const [bodyFile, enteredAt] = process.argv.slice(2);
const body = readFileSync(bodyFile, 'utf8').replace(/\r/g, '');

// Issue forms render as "### Label\n\nvalue" blocks.
const field = (label) => {
  const m = body.match(new RegExp(`###\\s*${label}[^\\n]*\\n+([\\s\\S]*?)(?=\\n###|$)`));
  const v = m ? m[1].trim() : '';
  return v === '_No response_' ? '' : v;
};
const entry = {
  bank_name: field('Banka'),
  rate_monthly_pct: field('Aylık faiz oranı').replace('%', '').replace(',', '.').trim(),
  term_min: parseInt(field('En kısa vade'), 10),
  term_max: parseInt(field('En uzun vade'), 10),
  insurance_required: /evet/i.test(field('Sigorta şartlı mı')),
  source_url: field('Bankanın sayfa bağlantısı'),
  note: field('Not'),
  entered_at: enteredAt,
};
const seen = /\[x\]/i.test(field('Onay'));

const err = !seen ? 'oranı bankanın kendi sayfasında gördüğünüzü onaylamadınız' : validate(entry);
if (err) { console.log(`HATA: ${err}. Oran eklenmedi.`); process.exit(1); }

const entries = readManual(MANUAL).filter(e => !(e.bank_name === entry.bank_name &&
  e.term_min === entry.term_min && e.term_max === entry.term_max &&
  !!e.insurance_required === entry.insurance_required));
entries.push(entry);
writeFileSync(MANUAL, JSON.stringify({ entries }, null, 1));

const rates = JSON.parse(readFileSync(RATES, 'utf8'));
writeFileSync(RATES, JSON.stringify(mergeInto(rates, entries), null, 1));
console.log(`Eklendi: ${entry.bank_name} %${entry.rate_monthly_pct.replace('.', ',')} · ${entry.term_min}–${entry.term_max} ay${entry.insurance_required ? ' · sigorta şartlı' : ''}. Tüm telefonlara birkaç dakika içinde ulaşır; 24 saat güncel sayılır, 72 saat sonra kullanılmaz.`);
