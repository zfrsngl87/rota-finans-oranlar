// Şekerbank: konut kredisi page calculator (robots.txt allows the page).
// The calculator defaults to "Bireysel İhtiyaç Kredisi" → the credit type is
// switched to "Konut Kredisi" (MUI select, data-value 0) and VERIFIED before
// every reading. Terms come from the "Diğer" menu (every month 3..120).
import { groupTerms, normalizeRate, offer, parseTl } from '../common.mjs';

export const meta = {
  bankId: 'sekerbank',
  bankName: 'Şekerbank',
  url: 'https://www.sekerbank.com.tr/bireysel/bireysel-krediler/konut-kredisi',
};

const RESULT_RE = /([\d.]+) TL tutarındaki (\d+) Ay geri ödemeli krediniz için hesaplamanız; Aylık Taksit Tutarı ([\d.,]+) TL Faiz Oranı % ?([\d,.]+)/;

export async function collect(browser, { maxTerm = 120, amounts = [500000, 2000000, 5000000], spotTerms = [12, 48, 120] } = {}) {
  const page = await (await browser.newContext({ locale: 'tr-TR' })).newPage();
  await page.goto(meta.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('#kType-select').waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);

  const sel = page.locator('#kType-select');
  await sel.scrollIntoViewIfNeeded();
  const box = await sel.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up();
  await page.locator('[role=option][data-value="0"]').click();
  await page.waitForTimeout(1500);

  const read = async () => {
    const kind = (await sel.innerText()).trim();
    if (!/Konut Kredisi/.test(kind)) throw new Error(`credit type is "${kind}", not Konut Kredisi`);
    const t = (await page.innerText('body')).replace(/\s+/g, ' ');
    const m = t.match(RESULT_RE);
    // The result block disappears while the calculator recomputes → "not yet".
    if (!m) return null;
    const ins = await page.evaluate(() => document.querySelector('input[name=info][value="1"]')?.checked ? 'E'
      : document.querySelector('input[name=info][value="0"]')?.checked ? 'H' : null);
    return { amount: parseTl(m[1]), term: Number(m[2]), installment: m[3], rate: normalizeRate(m[4]), ins };
  };
  const same = (a, b) => a.term === b.term && a.installment === b.installment && a.rate === b.rate && a.amount === b.amount;
  let previous = null;
  const settled = async (expect) => {
    for (let i = 0; i < 60; i++) {
      const r = await read();
      if (r && r.term === expect.term && r.amount === expect.amount && r.ins === expect.ins && r.installment !== previous) {
        await page.waitForTimeout(700);
        const r2 = await read();
        if (r2 && same(r, r2)) { previous = r.installment; return r; }
        continue;
      }
      await page.waitForTimeout(250);
    }
    throw new Error(`calculator did not settle for ${JSON.stringify(expect)}`);
  };

  const setAmount = async (a) => {
    const el = page.locator('#sekerinput_kAmount');
    await el.click({ clickCount: 3 });
    await el.press('Control+A');
    await el.press('Backspace');
    await el.type(String(a), { delay: 20 });
    await el.press('Tab');
    await page.waitForTimeout(1200);
    const shown = parseTl(await el.inputValue());
    if (shown !== a) throw new Error(`amount ${a} shown as ${shown}`);
  };
  const setInsurance = async (ins) => {
    await page.locator(ins === 'E' ? 'label#sigortali' : 'label#sigortasiz').click();
    await page.waitForTimeout(900);
  };
  const setTerm = async (term) => {
    await page.locator('button[aria-label="diğer vadeler"]').click();
    const item = page.locator(`[role=menuitem][aria-label="${term} Ay ay vade seç"]`);
    await item.scrollIntoViewIfNeeded();
    await item.click();
  };

  // Which terms does the menu offer?
  await page.locator('button[aria-label="diğer vadeler"]').click();
  const terms = (await page.$$eval('[role=menuitem]', els => els.map(e => parseInt(e.innerText, 10))))
    .filter(n => Number.isInteger(n) && n >= 1 && n <= 120).filter(n => n <= maxTerm).sort((a, b) => a - b);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  if (!terms.length) throw new Error('no term options');

  const retrievedAt = new Date().toISOString();
  const offers = [];
  const evidence = { terms: `${terms[0]}..${terms[terms.length - 1]} (${terms.length})` };
  for (const ins of ['E', 'H']) {
    await setAmount(amounts[1]);
    await setInsurance(ins);
    previous = null;
    const readings = [];
    for (const term of terms) {
      await setTerm(term);
      const r = await settled({ term, amount: amounts[1], ins });
      readings.push({ term, rate: r.rate });
    }
    const byTerm = Object.fromEntries(readings.map(r => [r.term, r.rate]));
    const groups = groupTerms(readings);
    evidence[ins] = { sweepAmount: amounts[1], groups };
    // Spot-check other amounts on a few terms.
    let amountMin = amounts[1], amountMax = amounts[1];
    for (const a of amounts) {
      if (a === amounts[1]) continue;
      await setAmount(a);
      previous = null;
      const diffs = [];
      for (const term of spotTerms.filter(t => byTerm[t])) {
        await setTerm(term);
        const r = await settled({ term, amount: a, ins });
        if (r.rate !== byTerm[term]) diffs.push({ term, rate: r.rate });
      }
      evidence[ins][`amount_${a}`] = diffs.length ? diffs : 'same';
      if (!diffs.length) { amountMin = Math.min(amountMin, a); amountMax = Math.max(amountMax, a); }
    }
    for (const g of groups) {
      offers.push(offer({
        bankId: meta.bankId, bankName: meta.bankName, rate: g.rate,
        termMin: g.termMin, termMax: g.termMax, amountMin, amountMax,
        insurance: ins === 'E', sourceUrl: meta.url, retrievedAt,
        conditions: (ins === 'E' ? 'Sigortalı oran' : 'Sigortasız oran') + ' (banka hesaplama aracı)',
      }));
    }
  }
  await page.context().close();
  return { offers, evidence };
}
