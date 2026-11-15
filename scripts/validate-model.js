#!/usr/bin/env node
/**
 * Physical-validity report for the wired-in model, measured through the public
 * contract only (see scripts/lib/metrics.js for what each column means).
 *
 * Usage: node scripts/validate-model.js [--model=crane|demo] [--samples=81] [--quiet]
 * Exits 1 when a hard limit is broken.
 */
import { createModel } from '../src/models/index.js';
import { analyseModel, printReport } from './lib/metrics.js';
import { verdict } from './lib/limits.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const name = opt('model', undefined);
const start = performance.now();
const model = createModel(name);
const buildMs = performance.now() - start;
const report = analyseModel(model, { N: +opt('samples', 81), model2: createModel(name) });
if (!args.includes('--quiet')) printReport(report);
console.log(`\nbuild ${buildMs.toFixed(1)} ms`);
const { failures, notes } = verdict(report);
for (const note of notes) console.log(`note: ${note}`);
for (const failure of failures) console.log(`FAIL: ${failure}`);
console.log(failures.length ? 'RESULT: FAIL' : 'RESULT: PASS');
process.exit(failures.length ? 1 : 0);
