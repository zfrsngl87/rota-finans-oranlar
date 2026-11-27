// Anadolubank: "Hesaplama Araçları" → Konut Kredisi tab (robots.txt: Allow /).
// Discrete terms (12, 24, …, 120); no insured/uninsured choice on the tool,
// so the offer is recorded as not insurance-conditional.
// Each reading is validated: Geri Ödenecek Tutar must equal installment × term
// (±1 kuruş per month), which proves the result belongs to the selected term.
import { normalizeRate, offer, parseTl } from '../common.mjs';

export const meta = {
  bankId: 'anadolubank',
  bankName: 'Anadolubank',
  url: 'https://www.anadolubank.com.tr/hesaplama-araclari',
};

const RESULT_RE = /Taksit Tutarı ([\d.,]+) TL Faiz Oranı ([\d,.]+)% Geri Ödenecek Tutar ([\d.,]+) TL/;
const tl = (s) => Number(s.replace(/\./g, '').replace(',', '.'));

export async function collect(browser, { amounts = [500000, 2000000, 5000000] } = {}) {
  const page = await (await browser.newContext({ locale: 'tr-TR' })).newPage();
  await page.goto(meta.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('label', { hasText: 'Konut Kredisi' }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.locator('label', { hasText: 'Konut Kredisi' }).first().click();
  await page.waitForTimeout(1500);
  const terms = (await page.$$eval('#kk-due option', os => os.map(o => Number(o.value))))
    .filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!terms.length) throw new Error('no term options');

  let previous = null;
  const calc = async (amount, term) => {
    const el = page.locator('#kk-amount');
    await el.fill('');
    await el.type(String(amount), { delay: 15 });
    await el.press('Tab');
    const shown = parseTl(await el.inputValue());
    if (shown !== amount) throw new Error(`amount ${amount} shown as ${shown}`);
    await page.selectOption('#kk-due', String(term));
    await page.locator('button', { hasText: 'Hesapla' }).filter({ visible: true }).first().click();
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(300);
      const t = (await page.innerText('body')).replace(/\s+/g, ' ');
      const m = t.match(RESULT_RE);
      if (!m) continue;
      const inst = tl(m[1]), total = tl(m[3]);
      const consistent = Math.abs(inst * term - total) <= 0.01 * term + 0.01;
      if (!consistent || m[1] === previous) continue;
      await page.waitForTimeout(600);
      const m2 = (await page.innerText('body')).replace(/\s+/g, ' ').match(RESULT_RE);
      if (!m2 || m2[0] !== m[0]) continue;
      previous = m[1];
      return normalizeRate(m[2]);
    }
    throw new Error(`no consistent result for ${amount} TL / ${term} ay`);
  };

  const sweep = async (amount) => {
    previous = null;
    const out = {};
    for (const term of terms) out[term] = await calc(amount, term);
    return out;
  };
  const base = await sweep(amounts[1]);
  const evidence = { terms, sweepAmount: amounts[1], rates: base };
  let amountMin = amounts[1], amountMax = amounts[1];
  for (const a of amounts) {
    if (a === amounts[1]) continue;
    const other = await sweep(a);
    const equal = JSON.stringify(other) === JSON.stringify(base);
    evidence[`amount_${a}`] = equal ? 'same' : other;
    if (equal) { amountMin = Math.min(amountMin, a); amountMax = Math.max(amountMax, a); }
  }
  const retrievedAt = new Date().toISOString();
  const offers = terms.map(t => offer({
    bankId: meta.bankId, bankName: meta.bankName, rate: base[t],
    termMin: t, termMax: t, amountMin, amountMax, insurance: false,
    sourceUrl: meta.url, retrievedAt,
    conditions: 'Banka hesaplama aracı (sigorta seçeneği yok)',
  }));
  await page.context().close();
  return { offers, evidence };
}
