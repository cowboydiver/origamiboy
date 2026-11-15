/**
 * The shared model contract. Every origami model (the placeholder in
 * src/models/demo.js and the real piece) is a plain object of this shape:
 * pure ESM, no runtime dependencies, runs unchanged in Node and the browser.
 *
 * Conventions
 * - The paper is a square of side 1 world unit. +Y is up, +Z points at the viewer.
 * - At step 0, t = 0 the paper is flat in the z = 0 plane, centred on the origin,
 *   WHITE side facing +Z. The coloured side ends up on the outside of the piece.
 * - Vertices are not shared between rigid faces.
 * - pose(k, 1) equals pose(k + 1, 0) to within 1e-6.
 * - Stacked layers are separated by the model itself (about 0.0015 - 0.004 per layer).
 * - Turning the paper over is its own step: a rigid 180 degree turn about the vertical axis.
 *
 * @typedef {'fold'|'fold-unfold'|'unfold'|'turn-over'|'compound'|'shape'} StepKind
 *
 * @typedef {Object} OrigamiStep
 * @property {string} id           Unique, stable identifier.
 * @property {string} title        Short imperative title.
 * @property {string} description  One or two sentences of instruction.
 * @property {number} duration     Seconds at 1x speed. Must be > 0.
 * @property {StepKind} kind
 *
 * @typedef {Object} FoldGuide
 * @property {'valley'|'mountain'} type
 * @property {[number, number, number]} a  One end of the crease.
 * @property {[number, number, number]} b  The other end.
 *
 * @typedef {Object} OrigamiModel
 * @property {string} name
 * @property {OrigamiStep[]} steps
 * @property {number} vertexCount
 * @property {Uint32Array} indices   Triangle list with fixed topology, wound
 *                                   counter-clockwise as seen from the WHITE side.
 * @property {Float32Array} uvs      2 * vertexCount. Position on the unfolded square in [0,1]^2.
 * @property {(stepIndex: number, t: number, out: Float32Array) => void} pose
 *           Writes xyz for every vertex into `out` (length 3 * vertexCount).
 *           `t` is linear progress through the step, in [0, 1]. Must be cheap.
 *           The viewer eases each step once and passes the eased value, so a
 *           model moves at an even pace in `t` and does not ease the ends of
 *           a step itself. A model may turn itself as a whole inside a step
 *           to show a fold from a better side, and re-centre itself on its
 *           new shape, once the guides have faded (t > GUIDE_FADE_END).
 * @property {(stepIndex: number) => FoldGuide[]} guides
 *           Crease lines about to be folded in this step, lying on the surface
 *           visible from +Z of pose(stepIndex, 0), nudged ~0.002 toward +Z.
 *           Empty for turn-over steps. The type is the sense in which the
 *           crease ends up folded, as seen from +Z at the start of the step;
 *           for a crease that the step turns inside out (the spine of a
 *           reverse fold, which may lie under the visible layer) it is the
 *           sense the crease ends in.
 */

/**
 * Progress through a step (the `t` handed to pose(), which the viewer has
 * already eased) by which the viewer has faded that step's fold guides out
 * completely. Until then a model keeps the paper where the guides were drawn,
 * apart from the fold itself: any re-centring or turning of the whole model
 * waits until after it.
 */
export const GUIDE_FADE_END = 0.35;

/** @type {readonly StepKind[]} */
export const STEP_KINDS = Object.freeze([
  'fold',
  'fold-unfold',
  'unfold',
  'turn-over',
  'compound',
  'shape',
]);

/** Human-readable label for each step kind. */
export const STEP_KIND_LABELS = Object.freeze({
  fold: 'Fold',
  'fold-unfold': 'Fold and unfold',
  unfold: 'Unfold',
  'turn-over': 'Turn over',
  compound: 'Compound fold',
  shape: 'Shape',
});

/** @type {readonly FoldGuide['type'][]} */
export const GUIDE_TYPES = Object.freeze(['valley', 'mountain']);
