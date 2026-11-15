/**
 * The global time axis: all step durations laid end to end.
 *
 * Everything here is pure, so scrubbing and playback share exactly the same
 * mapping from a time in seconds to (step index, local progress).
 */

/**
 * Ease-in-out applied by the viewer to each step's local progress.
 * Smoothstep: zero velocity at both ends, peak speed 1.5x in the middle.
 * @param {number} t in [0, 1]
 */
export function easeStep(t) {
  const x = t <= 0 ? 0 : t >= 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}

/** How far into a step "previous" still means "the step before" (seconds). */
const PREVIOUS_GRACE = 0.25;

/**
 * @param {ReadonlyArray<{ duration: number }>} steps
 */
export function createClock(steps) {
  const stepCount = steps.length;
  if (stepCount === 0) throw new Error('createClock: at least one step is required');

  /** starts[i] is the time step i begins; starts[stepCount] is the total. */
  const starts = new Float64Array(stepCount + 1);
  for (let i = 0; i < stepCount; i++) {
    const duration = steps[i].duration;
    if (!(duration > 0)) throw new Error(`createClock: step ${i} has no positive duration`);
    starts[i + 1] = starts[i] + duration;
  }
  const total = starts[stepCount];

  const clamp = (time) => (time > 0 ? (time < total ? time : total) : 0);

  /**
   * Index of the step that owns `time`. A boundary belongs to the step that
   * starts there; the very end belongs to the last step.
   */
  function indexAt(time) {
    const x = clamp(time);
    if (x >= total) return stepCount - 1;
    let lo = 0;
    let hi = stepCount - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= x) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Maps a time to its step and linear local progress.
   * Pass `out` to avoid allocating in per-frame code.
   * @param {number} time
   * @param {{ index: number, t: number }} [out]
   */
  function locate(time, out = { index: 0, t: 0 }) {
    const x = clamp(time);
    const index = indexAt(x);
    const t = (x - starts[index]) / (starts[index + 1] - starts[index]);
    out.index = index;
    out.t = t < 0 ? 0 : t > 1 ? 1 : t;
    return out;
  }

  /** The time at local progress `t` of step `index`. */
  function timeAt(index, t = 0) {
    const i = Math.max(0, Math.min(stepCount - 1, Math.trunc(index)));
    const local = t <= 0 ? 0 : t >= 1 ? 1 : t;
    return starts[i] + local * (starts[i + 1] - starts[i]);
  }

  /** Where "previous step" should land: the start of this step, or of the one before. */
  function previousStepTime(time) {
    const x = clamp(time);
    const index = indexAt(x);
    if (x - starts[index] > PREVIOUS_GRACE || index === 0) return starts[index];
    return starts[index - 1];
  }

  /** Where "next step" should land: the start of the next step, or the very end. */
  function nextStepTime(time) {
    const index = indexAt(time);
    return index + 1 < stepCount ? starts[index + 1] : total;
  }

  return {
    stepCount,
    total,
    starts,
    clamp,
    indexAt,
    locate,
    timeAt,
    stepStart: (index) => timeAt(index, 0),
    stepEnd: (index) => timeAt(index, 1),
    previousStepTime,
    nextStepTime,
  };
}

/** Formats seconds as m:ss for the transport read-out. */
export function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds + 1e-6));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
