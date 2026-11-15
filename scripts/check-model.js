#!/usr/bin/env node
/**
 * Runs the model wired into src/models/index.js through the contract check.
 * Usage: npm run check-model [-- --model=demo]   (exits 1 when the contract is violated)
 */
import { checkModel } from '../src/origami/contract.js';
import { createModel } from '../src/models/index.js';

const wanted = process.argv.slice(2).find((arg) => arg.startsWith('--model='));
const model = createModel(wanted ? wanted.slice('--model='.length) : undefined);
const { ok, errors, warnings, stats } = checkModel(model, { samplesPerStep: 8 });

console.log(`Model: ${model.name}`);
console.log(
  `  ${stats.steps ?? '?'} steps, ${stats.vertexCount ?? '?'} vertices, ${stats.triangles ?? '?'} triangles, ` +
    `${stats.guides ?? '?'} guide lines, ${stats.totalDuration?.toFixed(1) ?? '?'} s`,
);
if (stats.poseMs !== undefined) {
  console.log(
    `  pose(): ${stats.poseMs.toFixed(4)} ms average, worst boundary gap ${stats.worstContinuityGap.toExponential(2)}, ` +
      `worst edge stretch ${stats.worstStretch.toExponential(2)}`,
  );
}
for (const message of warnings) console.warn(`  warning: ${message}`);
for (const message of errors) console.error(`  error: ${message}`);
console.log(ok ? 'Contract: OK' : `Contract: ${errors.length} violation(s)`);
process.exit(ok ? 0 : 1);
