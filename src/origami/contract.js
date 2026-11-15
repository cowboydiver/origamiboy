/**
 * Runtime check of the OrigamiModel contract (see ./types.js).
 *
 * Dependency-free so it runs in Node, in vitest and in the browser. The app
 * only loads it in development; `npm run check-model` runs it from the CLI.
 */
import { GUIDE_TYPES, STEP_KINDS } from './types.js';

/**
 * @typedef {Object} ContractReport
 * @property {boolean} ok          True when there are no errors.
 * @property {string[]} errors     Contract violations.
 * @property {string[]} warnings   Suspicious but not strictly forbidden.
 * @property {Object} stats        Sizes and timings, for the curious.
 */

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * @param {import('./types.js').OrigamiModel} model
 * @param {Object} [options]
 * @param {number} [options.samplesPerStep]       Poses sampled inside each step.
 * @param {number} [options.continuityTolerance]  Allowed gap between pose(k,1) and pose(k+1,0).
 * @param {number} [options.rigidityTolerance]    Allowed edge-length drift before warning.
 * @param {number} [options.poseBudgetMs]         Average pose() cost before warning.
 * @returns {ContractReport}
 */
export function checkModel(model, options = {}) {
  const {
    samplesPerStep = 5,
    continuityTolerance = 1e-6,
    rigidityTolerance = 2e-3,
    poseBudgetMs = 0.5,
  } = options;

  const errors = [];
  const warnings = [];
  const stats = {};
  const report = () => ({ ok: errors.length === 0, errors, warnings, stats });

  // --- shape of the object -------------------------------------------------
  if (!model || typeof model !== 'object') {
    errors.push('model is not an object');
    return report();
  }
  if (typeof model.name !== 'string' || !model.name) errors.push('name must be a non-empty string');
  if (typeof model.pose !== 'function') errors.push('pose must be a function');
  if (typeof model.guides !== 'function') errors.push('guides must be a function');

  const steps = model.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push('steps must be a non-empty array');
  } else {
    const seen = new Set();
    steps.forEach((step, i) => {
      const where = `steps[${i}]`;
      if (!step || typeof step !== 'object') return errors.push(`${where} is not an object`);
      if (typeof step.id !== 'string' || !step.id) errors.push(`${where}.id must be a non-empty string`);
      else if (seen.has(step.id)) errors.push(`${where}.id "${step.id}" is not unique`);
      else seen.add(step.id);
      if (typeof step.title !== 'string' || !step.title) errors.push(`${where}.title must be a non-empty string`);
      if (typeof step.description !== 'string') errors.push(`${where}.description must be a string`);
      if (!(Number.isFinite(step.duration) && step.duration > 0)) {
        errors.push(`${where}.duration must be a positive number of seconds`);
      }
      if (!STEP_KINDS.includes(step.kind)) errors.push(`${where}.kind "${step.kind}" is not a known kind`);
    });
  }

  const vertexCount = model.vertexCount;
  if (!(Number.isInteger(vertexCount) && vertexCount > 0)) errors.push('vertexCount must be a positive integer');

  const indices = model.indices;
  if (!(indices instanceof Uint32Array)) errors.push('indices must be a Uint32Array');
  else if (indices.length === 0 || indices.length % 3 !== 0) errors.push('indices length must be a positive multiple of 3');

  const uvs = model.uvs;
  if (!(uvs instanceof Float32Array)) errors.push('uvs must be a Float32Array');
  else if (Number.isInteger(vertexCount) && uvs.length !== 2 * vertexCount) {
    errors.push(`uvs length is ${uvs.length}, expected 2 * vertexCount = ${2 * vertexCount}`);
  }

  if (errors.length) return report();

  // --- static buffers ------------------------------------------------------
  const triangleCount = indices.length / 3;
  const used = new Uint8Array(vertexCount);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount) {
      errors.push(`indices[${i}] = ${indices[i]} is out of range (vertexCount ${vertexCount})`);
      return report();
    }
    used[indices[i]] = 1;
  }
  let unused = 0;
  for (let i = 0; i < vertexCount; i++) if (!used[i]) unused++;
  if (unused) warnings.push(`${unused} vertices are not referenced by any triangle`);

  for (let i = 0; i < uvs.length; i++) {
    if (!(uvs[i] >= -1e-6 && uvs[i] <= 1 + 1e-6)) {
      errors.push(`uvs[${i}] = ${uvs[i]} is outside [0, 1]`);
      break;
    }
  }

  // --- poses ---------------------------------------------------------------
  const stepCount = steps.length;
  const a = new Float32Array(3 * vertexCount);
  const b = new Float32Array(3 * vertexCount);
  let poseCalls = 0;
  let poseTime = 0;
  const pose = (k, t, out) => {
    out.fill(NaN);
    const start = now();
    model.pose(k, t, out);
    poseTime += now() - start;
    poseCalls++;
  };
  const firstBad = (buffer) => {
    for (let i = 0; i < buffer.length; i++) if (!Number.isFinite(buffer[i])) return i;
    return -1;
  };

  // Flat, centred start with the white side toward +Z.
  pose(0, 0, a);
  if (firstBad(a) >= 0) {
    errors.push(`pose(0, 0) left non-finite values (first at component ${firstBad(a)})`);
    return report();
  }
  let maxZ = 0;
  let maxUvDrift = 0;
  const min = [Infinity, Infinity];
  const max = [-Infinity, -Infinity];
  for (let v = 0; v < vertexCount; v++) {
    const x = a[3 * v];
    const y = a[3 * v + 1];
    maxZ = Math.max(maxZ, Math.abs(a[3 * v + 2]));
    min[0] = Math.min(min[0], x);
    min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x);
    max[1] = Math.max(max[1], y);
    maxUvDrift = Math.max(maxUvDrift, Math.abs(x - (uvs[2 * v] - 0.5)), Math.abs(y - (uvs[2 * v + 1] - 0.5)));
  }
  if (maxZ > 1e-6) errors.push(`pose(0, 0) is not flat in z = 0 (max |z| = ${maxZ.toExponential(2)})`);
  for (let axis = 0; axis < 2; axis++) {
    const name = axis === 0 ? 'x' : 'y';
    if (Math.abs(min[axis] + 0.5) > 1e-4 || Math.abs(max[axis] - 0.5) > 1e-4) {
      errors.push(`pose(0, 0) spans ${name} in [${min[axis].toFixed(4)}, ${max[axis].toFixed(4)}], expected [-0.5, 0.5]`);
    }
  }
  if (maxUvDrift > 1e-4) {
    warnings.push(`pose(0, 0) differs from uv - 0.5 by up to ${maxUvDrift.toExponential(2)}; uvs should be the unfolded position`);
  }

  // Winding and the rest lengths used by the rigidity check.
  const restLengths = new Float32Array(indices.length);
  let flipped = 0;
  let degenerate = 0;
  for (let tri = 0; tri < triangleCount; tri++) {
    const i0 = 3 * indices[3 * tri];
    const i1 = 3 * indices[3 * tri + 1];
    const i2 = 3 * indices[3 * tri + 2];
    const nz = (a[i1] - a[i0]) * (a[i2 + 1] - a[i0 + 1]) - (a[i1 + 1] - a[i0 + 1]) * (a[i2] - a[i0]);
    if (Math.abs(nz) < 1e-10) degenerate++;
    else if (nz < 0) flipped++;
    restLengths[3 * tri] = distance(a, i0, i1);
    restLengths[3 * tri + 1] = distance(a, i1, i2);
    restLengths[3 * tri + 2] = distance(a, i2, i0);
  }
  if (flipped) errors.push(`${flipped} of ${triangleCount} triangles are wound clockwise as seen from the white side (+Z at step 0)`);
  if (degenerate) warnings.push(`${degenerate} triangles have zero area`);

  // Finite everywhere, continuous across step boundaries, roughly rigid.
  let worstGap = 0;
  let worstStretch = 0;
  let worstStretchAt = '';
  for (let k = 0; k < stepCount; k++) {
    for (let s = 0; s <= samplesPerStep; s++) {
      const t = s / samplesPerStep;
      pose(k, t, a);
      const bad = firstBad(a);
      if (bad >= 0) {
        errors.push(`pose(${k}, ${t}) left a non-finite value at component ${bad}`);
        return report();
      }
      for (let tri = 0; tri < triangleCount; tri++) {
        const i0 = 3 * indices[3 * tri];
        const i1 = 3 * indices[3 * tri + 1];
        const i2 = 3 * indices[3 * tri + 2];
        const stretch = Math.max(
          Math.abs(distance(a, i0, i1) - restLengths[3 * tri]),
          Math.abs(distance(a, i1, i2) - restLengths[3 * tri + 1]),
          Math.abs(distance(a, i2, i0) - restLengths[3 * tri + 2]),
        );
        if (stretch > worstStretch) {
          worstStretch = stretch;
          worstStretchAt = `step ${k} ("${steps[k].id}") at t = ${t}`;
        }
      }
    }
    // `a` now holds pose(k, 1).
    if (k + 1 < stepCount) {
      pose(k + 1, 0, b);
      let gap = 0;
      for (let i = 0; i < a.length; i++) gap = Math.max(gap, Math.abs(a[i] - b[i]));
      worstGap = Math.max(worstGap, gap);
      if (!(gap <= continuityTolerance)) {
        errors.push(
          `pose(${k}, 1) and pose(${k + 1}, 0) differ by ${gap.toExponential(2)} ` +
            `(steps "${steps[k].id}" -> "${steps[k + 1].id}", tolerance ${continuityTolerance})`,
        );
      }
    }
  }
  if (worstStretch > rigidityTolerance) {
    warnings.push(`triangle edges change length by up to ${worstStretch.toExponential(2)} (${worstStretchAt}); faces should be rigid`);
  }

  // --- guides --------------------------------------------------------------
  let guideCount = 0;
  for (let k = 0; k < stepCount; k++) {
    let guides;
    try {
      guides = model.guides(k);
    } catch (error) {
      errors.push(`guides(${k}) threw: ${error.message}`);
      continue;
    }
    if (!Array.isArray(guides)) {
      errors.push(`guides(${k}) must return an array`);
      continue;
    }
    if (steps[k].kind === 'turn-over' && guides.length) {
      warnings.push(`guides(${k}) should be empty for a turn-over step`);
    }
    guides.forEach((guide, i) => {
      const where = `guides(${k})[${i}]`;
      if (!guide || !GUIDE_TYPES.includes(guide.type)) errors.push(`${where}.type must be 'valley' or 'mountain'`);
      for (const end of ['a', 'b']) {
        const p = guide && guide[end];
        if (!p || p.length !== 3 || ![p[0], p[1], p[2]].every(Number.isFinite)) {
          errors.push(`${where}.${end} must be three finite numbers`);
        }
      }
      guideCount++;
    });
  }

  // --- cost ----------------------------------------------------------------
  const poseMs = poseCalls ? poseTime / poseCalls : 0;
  if (poseMs > poseBudgetMs) {
    warnings.push(`pose() averages ${poseMs.toFixed(3)} ms per call; the budget is ${poseBudgetMs} ms`);
  }

  Object.assign(stats, {
    steps: stepCount,
    vertexCount,
    triangles: triangleCount,
    guides: guideCount,
    totalDuration: steps.reduce((sum, step) => sum + step.duration, 0),
    worstContinuityGap: worstGap,
    worstStretch,
    poseMs,
  });
  return report();
}

/**
 * Throws when the model violates the contract. Returns the report otherwise.
 * @param {import('./types.js').OrigamiModel} model
 * @param {Parameters<typeof checkModel>[1]} [options]
 */
export function assertModel(model, options) {
  const result = checkModel(model, options);
  if (!result.ok) {
    throw new Error(`Origami model "${model?.name ?? '?'}" violates the contract:\n- ${result.errors.join('\n- ')}`);
  }
  return result;
}

/**
 * Development helper: logs the report to the console instead of throwing, so a
 * model that is still being built can be looked at while its problems are listed.
 * @param {import('./types.js').OrigamiModel} model
 * @param {Parameters<typeof checkModel>[1]} [options]
 */
export function reportModel(model, options) {
  const result = checkModel(model, options);
  const label = `[origami] model "${model?.name ?? '?'}"`;
  if (result.ok && result.warnings.length === 0) {
    console.info(`${label} conforms to the contract`, result.stats);
  } else {
    for (const message of result.errors) console.error(`${label}: ${message}`);
    for (const message of result.warnings) console.warn(`${label}: ${message}`);
  }
  return result;
}

function distance(buffer, i, j) {
  return Math.hypot(buffer[i] - buffer[j], buffer[i + 1] - buffer[j + 1], buffer[i + 2] - buffer[j + 2]);
}
