/**
 * Contract-only look at how a step moves (development and tests): the speed of
 * the fastest vertex over the step, so that kinks, snaps and residual speed at
 * the ends show up as numbers.
 */

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 * @param {number} k                         step index
 * @param {Object} [options]
 * @param {number} [options.samples]         intervals over the step
 * @param {(t: number) => number} [options.timing]  maps linear progress to the t given to pose()
 *                                           (pass the viewer's easeStep to see what is displayed)
 * @returns {{ speed: Float64Array, peak: number, peakAt: number, mean: number, start: number, end: number,
 *             maxJump: number, maxJumpAt: number }}
 *          speeds are world units per unit of step progress; maxJump is the
 *          largest change of speed between neighbouring intervals
 */
export function speedProfile(model, k, { samples = 200, timing = (t) => t } = {}) {
  const nv = model.vertexCount;
  const a = new Float32Array(3 * nv);
  const b = new Float32Array(3 * nv);
  const speed = new Float64Array(samples);
  model.pose(k, timing(0), a);
  let peak = 0;
  let peakAt = 0;
  let sum = 0;
  for (let i = 1; i <= samples; i++) {
    model.pose(k, timing(i / samples), b);
    let most = 0;
    for (let v = 0; v < nv; v++) {
      const d = Math.hypot(b[3 * v] - a[3 * v], b[3 * v + 1] - a[3 * v + 1], b[3 * v + 2] - a[3 * v + 2]);
      if (d > most) most = d;
    }
    const s = most * samples;
    speed[i - 1] = s;
    sum += s;
    if (s > peak) {
      peak = s;
      peakAt = (i - 0.5) / samples;
    }
    a.set(b);
  }
  let maxJump = 0;
  let maxJumpAt = 0;
  for (let i = 1; i < samples; i++) {
    const j = Math.abs(speed[i] - speed[i - 1]);
    if (j > maxJump) {
      maxJump = j;
      maxJumpAt = i / samples;
    }
  }
  return { speed, peak, peakAt, mean: sum / samples, start: speed[0], end: speed[samples - 1], maxJump, maxJumpAt };
}

/**
 * How far the fastest vertex moves over the last (or first) `h` of a step.
 * For a motion with a finite end speed this shrinks in proportion to h; a
 * square-root singularity (a fold that snaps shut) shrinks only like sqrt(h).
 */
export function endTravel(model, k, h, atStart = false) {
  const nv = model.vertexCount;
  const a = new Float32Array(3 * nv);
  const b = new Float32Array(3 * nv);
  model.pose(k, atStart ? 0 : 1, a);
  model.pose(k, atStart ? h : 1 - h, b);
  let most = 0;
  for (let v = 0; v < nv; v++) {
    most = Math.max(most, Math.hypot(b[3 * v] - a[3 * v], b[3 * v + 1] - a[3 * v + 1], b[3 * v + 2] - a[3 * v + 2]));
  }
  return most;
}
