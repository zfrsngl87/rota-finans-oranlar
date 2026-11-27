// TEB: public loan calculator, "Konut Kredisi" tab (robots.txt: Allow /).
// The calculator only offers discrete terms (12, 15, …, 36, 42, 48, 60, …, 120),
// so offers are recorded per offered term; contiguous offered terms with the
// same rate are merged only when no term in between is missing.
// "İlk Evim" (first-home) is checked by default → it is UNCHECKED before every
// reading so first-home-only pricing is never recorded.
import { normalizeRate, offer, parseTl } from '../common.mjs';

export const meta = {
  bankId: 'teb',
  bankName: 'TEB',
  url: 'https://www.teb.com.tr/kredi-hesaplama/',
};

export async function collect(browser, { amounts = [500000, 2000000, 5000000] } = {}) {
  const page = await (await browser.newContext({ locale: 'tr-TR' })).newPage();
  await page.goto(meta.url, { waitUntil: 'networkidle', timeout: 60000 });
  const tab = page.locator('a', { hasText: 'Konut Kredisi' });
  let clicked = false;
  for (let i = 0; i < await tab.count() && !clicked; i++) {
    const el = tab.nth(i);
    if (await el.isVisible()) { await el.click(); clicked = true; }
  }
  if (!clicked) throw new Error('Konut Kredisi tab not found');
  await page.waitForTimeout(1500);

  const read = async () => {
    const s = await page.evaluate(() => ({
      term: document.querySelector('#vmVade1')?.value,
      rate: document.querySelector('#loanInterest1')?.value,
      amount: document.querySelector('#amount1')?.value,
      ins: document.querySelector('#chkSigortaliYes')?.checked ? 'E'
        : document.querySelector('#chkSigortaliNo')?.checked ? 'H' : null,
      firstHome: document.querySelector('#chkIlkEvim')?.checked,
    }));
    const text = (await page.innerText('body')).replace(/\s+/g, ' ');
    const m = text.match(/Aylık Taksit Tutarı ([\d.,]+)/);
    if (!m || !s.rate) throw new Error('result not found');
    return { ...s, installment: m[1], rate: normalizeRate(s.rate) };
  };
  const same = (a, b) => a.term === b.term && a.rate === b.rate && a.installment === b.installment;
  let previous = null;
  const settled = async (expect) => {
    for (let i = 0; i < 40; i++) {
      const r = await read();
      if (r.term === String(expect.term) && r.ins === expect.ins && r.firstHome === false &&
          parseTl(r.amount) === expect.amount && r.installment !== previous) {
        await page.waitForTimeout(600);
        const r2 = await read();
        if (same(r, r2)) { previous = r.installment; return r; }
        continue;
      }
      await page.waitForTimeout(200);
    }
    throw new Error(`calculator did not settle for ${JSON.stringify(expect)}`);
  };

  const setAmount = async (a) => {
    const el = page.locator('#amount1');
    await el.fill('');
    await el.type(String(a), { delay: 15 });
    await el.press('Tab');
    await page.waitForTimeout(900);
    const shown = parseTl(await el.inputValue());
    if (shown !== a) throw new Error(`amount ${a} shown as ${shown}`);
  };
  const terms = (await page.$$eval('#vmVade1 option', os => os.map(o => Number(o.value))))
    .filter(n => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  if (!terms.length) throw new Error('no term options');

  const sweep = async (amount, ins) => {
    await setAmount(amount);
    await page.uncheck('#chkIlkEvim', { force: true });
    await page.check(ins === 'E' ? '#chkSigortaliYes' : '#chkSigortaliNo', { force: true });
    await page.waitForTimeout(700);
    previous = null;
    const out = {};
    for (const term of terms) {
      await page.selectOption('#vmVade1', String(term));
      out[term] = (await settled({ term, ins, amount })).rate;
    }
    return out;
  };

  // Merge offered terms into ranges only across adjacent OFFERED terms with
  // no gap (e.g. 12,15,18 are not contiguous months → kept separate unless
  // the gap is covered). Terms not offered by TEB are never claimed.
  const toGroups = (byTerm) => terms.map(t => ({ termMin: t, termMax: t, rate: byTerm[t] }));

  const retrievedAt = new Date().toISOString();
  const offers = [];
  const evidence = { terms };
  for (const ins of ['E', 'H']) {
    const base = await sweep(amounts[1], ins);
    evidence[ins] = { sweepAmount: amounts[1], rates: base };
    let amountMin = amounts[1], amountMax = amounts[1];
    for (const a of amounts) {
      if (a === amounts[1]) continue;
      const other = await sweep(a, ins);
      const equal = JSON.stringify(other) === JSON.stringify(base);
      evidence[ins][`amount_${a}`] = equal ? 'same' : other;
      if (equal) { amountMin = Math.min(amountMin, a); amountMax = Math.max(amountMax, a); }
    }
    for (const g of toGroups(base)) {
      offers.push(offer({
        bankId: meta.bankId, bankName: meta.bankName, rate: g.rate,
        termMin: g.termMin, termMax: g.termMax, amountMin, amountMax,
        insurance: ins === 'E', sourceUrl: meta.url, retrievedAt,
        conditions: (ins === 'E' ? 'Hayat sigortalı oran' : 'Sigortasız oran') +
          ' (banka hesaplama aracı, İlk Evim seçilmeden)',
      }));
    }
  }
  await page.context().close();
  return { offers, evidence };
}
