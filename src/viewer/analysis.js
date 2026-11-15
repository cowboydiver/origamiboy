/**
 * One pass over the whole animation at load time. It records, at evenly spaced
 * moments of every step:
 * - the bounding box of the model (what the camera frames), and
 * - its lowest point (where the ground sits, so the paper never dips through
 *   its own shadow).
 *
 * Other modules can piggy-back on the same pass through `observe`.
 */
import { easeStep } from '../core/clock.js';

/**
 * @param {import('../origami/types.js').OrigamiModel} model
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} clock
 * @param {Object} [options]
 * @param {number} [options.samples]  Intervals per step.
 * @param {(positions: Float32Array, time: number) => void} [options.observe]
 */
export function analyseModel(model, clock, { samples = 32, observe } = {}) {
  const stepCount = clock.stepCount;
  const vertexCount = model.vertexCount;
  const scratch = new Float32Array(3 * vertexCount);
  const box = new Float32Array(6);

  // Samples run along the whole timeline: sample `samples * k + s` is moment
  // s / samples of step k, and the end of a step is the start of the next.
  const count = stepCount * samples + 1;
  /** Six numbers per sample: min xyz, max xyz of the pose at that moment. */
  const exact = new Float32Array(6 * count);

  const measure = () => {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < scratch.length; i += 3) {
      const x = scratch[i];
      const y = scratch[i + 1];
      const z = scratch[i + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    box[0] = minX; box[1] = minY; box[2] = minZ;
    box[3] = maxX; box[4] = maxY; box[5] = maxZ;
  };

  for (let k = 0; k < stepCount; k++) {
    for (let s = 0; s <= samples; s++) {
      const linear = s / samples;
      model.pose(k, easeStep(linear), scratch);
      measure();
      if (s < samples || k === stepCount - 1) exact.set(box, 6 * (k * samples + s));
      observe?.(scratch, clock.timeAt(k, linear));
    }
  }

  // Between two samples the model is somewhere between the two poses, so each
  // sample also takes in its neighbours: interpolating between these wider
  // boxes covers both ends of the interval all the way across it.
  const reach = new Float32Array(6 * count);
  for (let g = 0; g < count; g++) {
    for (let i = 0; i < 6; i++) {
      let value = exact[6 * g + i];
      for (const n of [g - 1, g + 1]) {
        if (n < 0 || n >= count) continue;
        const other = exact[6 * n + i];
        value = i < 3 ? Math.min(value, other) : Math.max(value, other);
      }
      reach[6 * g + i] = value;
    }
  }

  /** The exact box at every step boundary: six numbers per boundary, stepCount + 1 of them. */
  const boxes = new Float32Array(6 * (stepCount + 1));
  for (let k = 0; k <= stepCount; k++) boxes.set(exact.subarray(6 * k * samples, 6 * k * samples + 6), 6 * k);

  /** Splits linear progress through a step into a sample index and the fraction past it. */
  const locate = (index, linear) => {
    const x = Math.min(1, Math.max(0, linear)) * samples;
    const s = Math.min(samples - 1, Math.floor(x));
    return { base: index * samples + s, part: x - s };
  };

  return {
    samples,
    boxes,
    /**
     * The box the camera should frame at linear progress `linear` of a step.
     *
     * It starts from a blend of the boxes at the step's two ends, which keeps
     * the camera still through a fold-and-unfold and moves it evenly when the
     * shape changes for good, and widens that by whatever the pose needs right
     * now: a flap standing up toward the viewer half way through a fold, a
     * point swinging out past both end shapes.
     * @param {number} index
     * @param {number} linear
     * @param {Float32Array|number[]} out  six numbers
     */
    boxAt(index, linear, out) {
      const from = 6 * index * samples;
      const to = from + 6 * samples;
      const eased = easeStep(linear);
      const { base, part } = locate(index, linear);
      for (let i = 0; i < 6; i++) {
        const ends = exact[from + i] + (exact[to + i] - exact[from + i]) * eased;
        const now = reach[6 * base + i] + (reach[6 * base + 6 + i] - reach[6 * base + i]) * part;
        out[i] = i < 3 ? Math.min(ends, now) : Math.max(ends, now);
      }
      return out;
    },
    /**
     * Lowest point of the model at linear progress `linear` of a step.
     * @param {number} index
     * @param {number} linear
     */
    floorAt(index, linear) {
      const { base, part } = locate(index, linear);
      return exact[6 * base + 1] + (exact[6 * base + 7] - exact[6 * base + 1]) * part;
    },
  };
}
