// Akbank: public konut kredisi calculator (robots.txt allows /basvuru/).
// Reads the quoted monthly rate (excl. taxes) for every term 1..maxTerm,
// insured and uninsured, and verifies amount-independence on a few amounts.
import { groupTerms, normalizeRate, offer, parseTl } from '../common.mjs';

export const meta = {
  bankId: 'akbank',
  bankName: 'Akbank',
  url: 'https://www.akbank.com/basvuru/konut-kredisi',
};

// At the slider ends the min/max label ("1 Ay") is repeated after the value.
const RESULT_RE = /Vade (\d+) Ay(?: \d+ Ay)* Aylık Taksit Tutarı ([\d.,\s]+) TL Faiz Oranı % ?([\d.,]+)/;

export async function collect(browser, { maxTerm = 120, amounts = [500000, 2000000, 5000000] } = {}) {
  const page = await (await browser.newContext({ locale: 'tr-TR' })).newPage();
  await page.goto(meta.url, { waitUntil: 'networkidle', timeout: 60000 });
  const read = async () => {
    const t = (await page.innerText('body')).replace(/\s+/g, ' ');
    const m = t.match(RESULT_RE);
    if (!m) {
      const i = t.indexOf('Vade');
      throw new Error(`result block not found: "${t.slice(Math.max(0, i - 80), i + 220)}"`);
    }
    return { term: Number(m[1]), installment: m[2].replace(/\s/g, ''), rate: normalizeRate(m[3]) };
  };
  // Wait until the shown term is the expected one AND the installment changed,
  // then require the whole result (term, installment, rate) to stay identical
  // across two reads 600 ms apart. The page can update term/installment
  // before the rate (seen on GitHub runners: term 1 showed the 120-month
  // rate), so a single read is never trusted.
  let previous = null;
  const same = (a, b) => a.term === b.term && a.installment === b.installment && a.rate === b.rate;
  const readFor = async (term) => {
    for (let i = 0; i < 40; i++) {
      const r = await read();
      if (r.term === term && r.installment !== previous) {
        await page.waitForTimeout(600);
        const r2 = await read();
        if (same(r, r2)) { previous = r.installment; return r; }
        continue;
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`calculator did not settle for term ${term}`);
  };
  const setAmount = async (a) => {
    const el = page.locator('input[name=creditAmount]');
    await el.click({ clickCount: 3 });
    await el.fill('');
    await el.type(String(a), { delay: 15 });
    await el.press('Tab');
    await page.waitForTimeout(900);
    const shown = parseTl(await el.inputValue());
    if (shown !== a) throw new Error(`amount ${a} shown as ${shown}`);
  };
  const setInsurance = async (flag) => {
    await page.locator(`input[name=insurenceFlag][value=${flag}]`).check({ force: true });
    await page.waitForTimeout(700);
  };
  const thumb = page.locator('[role=slider][aria-label=Vade]').first();
  const sweep = async () => {
    await thumb.focus();
    previous = null;
    await page.keyboard.press('Home');
    await page.waitForTimeout(1500);
    const readings = [];
    for (let term = 1; term <= maxTerm; term++) {
      if (term > 1) {
        await thumb.focus();
        await page.keyboard.press('ArrowRight');
      }
      const r = await readFor(term);
      readings.push({ term, rate: r.rate });
    }
    return groupTerms(readings);
  };

  const retrievedAt = new Date().toISOString();
  const offers = [];
  const evidence = {};
  for (const flag of ['E', 'H']) {
    // Full term sweep at the middle amount, then spot-check other amounts.
    await setAmount(amounts[1]);
    await setInsurance(flag);
    const groups = await sweep();
    evidence[flag] = { sweepAmount: amounts[1], groups };
    let amountMin = amounts[1], amountMax = amounts[1];
    for (const a of amounts) {
      if (a === amounts[1]) continue;
      await setAmount(a);
      await setInsurance(flag);
      const g = await sweep();
      const same = JSON.stringify(g) === JSON.stringify(groups);
      evidence[flag][`amount_${a}`] = same ? 'same' : g;
      if (same) { amountMin = Math.min(amountMin, a); amountMax = Math.max(amountMax, a); }
    }
    for (const g of groups) {
      offers.push(offer({
        bankId: meta.bankId, bankName: meta.bankName, rate: g.rate,
        termMin: g.termMin, termMax: g.termMax, amountMin, amountMax,
        insurance: flag === 'E', sourceUrl: meta.url, retrievedAt,
        conditions: flag === 'E' ? 'Hayat sigortalı oran (banka hesaplama aracı)' : 'Sigortasız oran (banka hesaplama aracı)',
      }));
    }
  }
  await page.context().close();
  return { offers, evidence };
}
