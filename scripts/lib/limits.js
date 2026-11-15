/**
 * Hard limits on the metrics of analyseModel(), shared by the CLI validator
 * and the regression tests so the two can never disagree.
 */
export const LIMITS = Object.freeze({
  /** Worst relative change of a triangle edge length: faces are rigid. */
  strain: 0.02,
  /** Worst gap between pose(k, 1) and pose(k + 1, 0). */
  continuity: 1e-6,
  /** Interpenetrating triangle pairs allowed in a pose at a step boundary. */
  boundaryInterpenetrations: 0,
  /** Near-coplanar overlapping pairs (closer than 0.0008) allowed at a step boundary or inside a step. */
  zFightPairs: 0,
  /** Layer-order violations (taco-tortilla, taco-taco, sheet through a fold) allowed in a flat state. */
  layerOrderViolations: 0,
  /** Parallel overlapping pairs allowed to swap order between samples. */
  orderFlips: 0,
  /** Substantial interpenetrations (longer than 0.02 and deeper than 0.004) allowed inside a step. */
  substantialInterpenetrations: 0,
  /** Stacked layers must stay at least this far apart in a flat state. */
  minLayerSeparation: 0.0015,
});

/**
 * @param {ReturnType<typeof import('./metrics.js').analyseModel>} report
 * @returns {{ failures: string[], notes: string[] }}
 */
export function verdict(report) {
  const failures = [];
  const notes = [];
  if (report.problems.length) failures.push(...report.problems);
  if (report.contMax > LIMITS.continuity) failures.push(`continuity ${report.contMax.toExponential(2)} > ${LIMITS.continuity}`);
  for (const s of report.steps) {
    const at = `step ${s.k + 1} "${s.id}"`;
    if (s.nan) failures.push(`${at}: ${s.nan} non-finite coordinates`);
    if (s.strain > LIMITS.strain) failures.push(`${at}: strain ${s.strain.toExponential(2)} > ${LIMITS.strain}`);
    for (const [where, b] of [['start', s.start], ['end', s.end]]) {
      if (b.ipAny > LIMITS.boundaryInterpenetrations) failures.push(`${at}: ${b.ipAny} interpenetrating pairs at its ${where}`);
      if (b.zf > LIMITS.zFightPairs) failures.push(`${at}: ${b.zf} z-fighting pairs at its ${where}`);
      if (b.flat) {
        const bad = b.flat.tacoTortilla + b.flat.tacoTaco + b.flat.tortThroughTaco;
        if (bad > LIMITS.layerOrderViolations) failures.push(`${at}: ${bad} layer-order violations at its ${where} (${b.flat.examples.join('; ')})`);
        if (b.flat.minSep < LIMITS.minLayerSeparation) failures.push(`${at}: layers only ${b.flat.minSep.toFixed(5)} apart at its ${where}`);
      } else if (b.flatExpected) {
        failures.push(`${at}: not flat at its ${where} (${b.nonflat.toExponential(1)})`);
      }
    }
    for (const m of s.midFlat || []) {
      if (m.TT + m.TC + m.TT2 > LIMITS.layerOrderViolations) failures.push(`${at}: layer-order violation in the flat state at t = ${m.t.toFixed(3)}`);
    }
    if (s.zfMax > LIMITS.zFightPairs) failures.push(`${at}: ${s.zfMax} z-fighting pairs at t = ${s.zfWorstT.toFixed(2)}`);
    if (s.flips > LIMITS.orderFlips) failures.push(`${at}: ${s.flips} layer-order flips`);
    if (s.ipSubMax > LIMITS.substantialInterpenetrations) failures.push(`${at}: ${s.ipSubMax} substantial interpenetrations at t = ${s.ipWorstT.toFixed(2)}`);
    else if (s.ipAnyMax) {
      notes.push(
        `${at}: up to ${s.ipAnyMax} grazing triangle pairs inside the step (longest ${s.ipMaxL.toFixed(3)}, deepest ${s.ipMaxDepth.toFixed(4)}, ` +
          `in ${s.ipAnySamples} of ${report.N - 2} samples, worst at t = ${s.ipWorstT.toFixed(2)})`,
      );
    }
  }
  return { failures, notes };
}
