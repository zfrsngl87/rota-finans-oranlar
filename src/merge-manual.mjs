// Re-merges data/manual-rates.json into data/rates.json (used right before
// publishing, so a rate entered while a long collection was running is kept).
import { readFileSync, writeFileSync } from 'node:fs';
import { mergeInto, readManual } from './manual.mjs';

const RATES = 'data/rates.json';
const rates = JSON.parse(readFileSync(RATES, 'utf8'));
writeFileSync(RATES, JSON.stringify(mergeInto(rates, readManual('data/manual-rates.json')), null, 1));
