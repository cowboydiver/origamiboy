/**
 * Placeholder model: five rigid faces and five steps, small enough to read in
 * one sitting but a genuine implementation of the contract in
 * ../origami/types.js. It exercises every part of the viewer: a valley fold, a
 * mountain fold-unfold, a turn-over, a single-layer fold, and a 3D shaping step.
 *
 * Pure ESM with no dependencies beyond the contract module, so it runs
 * unchanged in Node and the browser.
 *
 * How it works: every face carries a rigid transform. A step rotates some faces
 * about a hinge line and may shift the whole model to keep it centred. The
 * transforms at the start of each step are baked once, so pose() is a handful
 * of matrix products.
 */
import { GUIDE_FADE_END } from '../origami/types.js';

/** Gap between stacked layers. */
const LAYER = 0.003;
/** How far guides sit above the surface they are drawn on. */
const LIFT = 0.002;
const PI = Math.PI;

// --- crease pattern --------------------------------------------------------
// Outlines in paper coordinates (the unfolded square, centred on the origin),
// counter-clockwise as seen from the white side.
const CORNER = 0; // top half, the corner that gets folded down
const INNER = 1; //  top half, the rest of that quadrant
const TOP = 2; //    top half, the other quadrant
const LOW_A = 3; //  bottom half
const LOW_B = 4; //  bottom half
const OUTLINES = [
  [[-0.5, 0], [0, 0.5], [-0.5, 0.5]],
  [[-0.5, 0], [0, 0], [0, 0.5]],
  [[0, 0], [0.5, 0], [0.5, 0.5], [0, 0.5]],
  [[-0.5, -0.5], [0, -0.5], [0, 0], [-0.5, 0]],
  [[0, -0.5], [0.5, -0.5], [0.5, 0], [0, 0]],
];
const ALL = OUTLINES.map((_, face) => face);

// --- folding sequence ------------------------------------------------------
// Hinge points and guides are in world coordinates at the start of their step.
// A positive angle turns counter-clockwise about `axis` (right-hand rule).
const SEQUENCE = [
  {
    id: 'half',
    title: 'Fold in half',
    description:
      'Valley-fold the bottom edge up to meet the top edge. The white side ends up hidden inside.',
    duration: 2.6,
    kind: 'fold',
    turn: { faces: [LOW_A, LOW_B], point: [0, 0, LAYER / 2], axis: [1, 0, 0], angle: -PI },
    shift: [0, -0.25, 0],
    guides: [{ type: 'valley', a: [-0.5, 0, LIFT], b: [0.5, 0, LIFT] }],
  },
  {
    id: 'centre-crease',
    title: 'Crease the centre line',
    description:
      'Mountain-fold the right half behind, press it flat, then unfold. This leaves a crease down the middle.',
    duration: 3.2,
    kind: 'fold-unfold',
    turn: { faces: [TOP, LOW_B], point: [0, 0, -LAYER / 2], axis: [0, 1, 0], angle: PI },
    thereAndBack: true,
    guides: [{ type: 'mountain', a: [0, -0.25, LAYER + LIFT], b: [0, 0.25, LAYER + LIFT] }],
  },
  {
    id: 'turn-over',
    title: 'Turn the paper over',
    description: 'Flip the whole model over from side to side, keeping the folded edge at the bottom.',
    duration: 1.8,
    kind: 'turn-over',
    turn: { faces: ALL, point: [0, 0, LAYER / 2], axis: [0, 1, 0], angle: PI },
    guides: [],
  },
  {
    id: 'corner',
    title: 'Fold the corner down',
    description:
      'Valley-fold the top right corner of the front layer down to the middle of the bottom edge.',
    duration: 2.4,
    kind: 'fold',
    turn: {
      faces: [CORNER],
      point: [0, 0.25, 1.5 * LAYER],
      axis: [Math.SQRT1_2, -Math.SQRT1_2, 0],
      angle: PI,
    },
    guides: [{ type: 'valley', a: [0, 0.25, LAYER + LIFT], b: [0.5, -0.25, LAYER + LIFT] }],
  },
  {
    id: 'stand',
    title: 'Open it to stand',
    description:
      'Swing the back layer down until it lies flat, at a right angle to the front. The model now stands on its own.',
    duration: 2.8,
    kind: 'shape',
    turn: { faces: [LOW_A, LOW_B], point: [0, -0.25, LAYER / 2], axis: [1, 0, 0], angle: -PI / 2 },
    shift: [0, 0, 0.25],
    guides: [],
  },
];

// --- 3x4 rigid transforms, row-major ---------------------------------------
const identity = () => new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

/** Rotation by `angle` about the line through `p` along unit vector `d`, then a translation. */
function hinge(out, p, d, angle, shift, shiftAmount) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  const [x, y, z] = d;
  const r00 = c + x * x * k;
  const r01 = x * y * k - z * s;
  const r02 = x * z * k + y * s;
  const r10 = y * x * k + z * s;
  const r11 = c + y * y * k;
  const r12 = y * z * k - x * s;
  const r20 = z * x * k - y * s;
  const r21 = z * y * k + x * s;
  const r22 = c + z * z * k;
  out[0] = r00; out[1] = r01; out[2] = r02;
  out[3] = p[0] - (r00 * p[0] + r01 * p[1] + r02 * p[2]) + shift[0] * shiftAmount;
  out[4] = r10; out[5] = r11; out[6] = r12;
  out[7] = p[1] - (r10 * p[0] + r11 * p[1] + r12 * p[2]) + shift[1] * shiftAmount;
  out[8] = r20; out[9] = r21; out[10] = r22;
  out[11] = p[2] - (r20 * p[0] + r21 * p[1] + r22 * p[2]) + shift[2] * shiftAmount;
  return out;
}

/** out = a after b */
function compose(out, a, b) {
  for (let row = 0; row < 3; row++) {
    const a0 = a[4 * row];
    const a1 = a[4 * row + 1];
    const a2 = a[4 * row + 2];
    out[4 * row] = a0 * b[0] + a1 * b[4] + a2 * b[8];
    out[4 * row + 1] = a0 * b[1] + a1 * b[5] + a2 * b[9];
    out[4 * row + 2] = a0 * b[2] + a1 * b[6] + a2 * b[10];
    out[4 * row + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a[4 * row + 3];
  }
  return out;
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const NO_SHIFT = [0, 0, 0];
const ORIGIN = [0, 0, 0];
const X_AXIS = [1, 0, 0];

/**
 * @returns {import('../origami/types.js').OrigamiModel}
 */
export function createDemoModel() {
  // Faces own their vertices: nothing is shared across a crease.
  const faceStart = [];
  const rest = [];
  const uv = [];
  const index = [];
  for (const outline of OUTLINES) {
    const first = rest.length / 2;
    faceStart.push(first);
    for (const [x, y] of outline) {
      rest.push(x, y);
      uv.push(x + 0.5, y + 0.5);
    }
    for (let i = 1; i + 1 < outline.length; i++) index.push(first, first + i, first + i + 1);
  }
  const vertexCount = rest.length / 2;
  faceStart.push(vertexCount);

  const faceCount = OUTLINES.length;
  const stepCount = SEQUENCE.length;
  const moving = SEQUENCE.map((step) => {
    const set = new Uint8Array(faceCount);
    for (const face of step.turn.faces) set[face] = 1;
    return set;
  });

  const scratchMove = identity();
  const scratchStill = identity();
  const scratchFace = identity();

  /** Transform of `face` at progress t of step k, given its transform at the start of that step. */
  function faceTransform(out, k, t, face, startOfStep) {
    const step = SEQUENCE[k];
    const shift = step.shift ?? NO_SHIFT;
    // The model stays put while the guide lines are still visible, then re-centres.
    const shiftAmount = smoothstep(GUIDE_FADE_END, 1, t);
    // The viewer eases the ends of the step; a fold-and-unfold only has to rest in the middle.
    const progress = step.thereAndBack ? (t >= 1 ? 0 : Math.sin(PI * t)) : t;
    const motion = moving[k][face]
      ? hinge(scratchMove, step.turn.point, step.turn.axis, step.turn.angle * progress, shift, shiftAmount)
      : hinge(scratchStill, ORIGIN, X_AXIS, 0, shift, shiftAmount);
    return compose(out, motion, startOfStep);
  }

  // Bake the transform of every face at the start of every step. Because the
  // start of step k + 1 is computed by the very code that evaluates pose(k, 1),
  // the two agree exactly.
  const baked = [OUTLINES.map(identity)];
  for (let k = 0; k < stepCount; k++) {
    baked.push(OUTLINES.map((_, face) => faceTransform(identity(), k, 1, face, baked[k][face])));
  }

  function pose(stepIndex, t, out) {
    const k = Math.min(stepCount - 1, Math.max(0, Math.trunc(stepIndex)));
    const progress = t <= 0 ? 0 : t >= 1 ? 1 : t;
    for (let face = 0; face < faceCount; face++) {
      const m = faceTransform(scratchFace, k, progress, face, baked[k][face]);
      for (let v = faceStart[face]; v < faceStart[face + 1]; v++) {
        const x = rest[2 * v];
        const y = rest[2 * v + 1];
        out[3 * v] = m[0] * x + m[1] * y + m[3];
        out[3 * v + 1] = m[4] * x + m[5] * y + m[7];
        out[3 * v + 2] = m[8] * x + m[9] * y + m[11];
      }
    }
  }

  function guides(stepIndex) {
    const step = SEQUENCE[stepIndex];
    if (!step) return [];
    return step.guides.map((guide) => ({ type: guide.type, a: [...guide.a], b: [...guide.b] }));
  }

  return {
    name: 'Practice folds',
    steps: SEQUENCE.map(({ id, title, description, duration, kind }) => ({ id, title, description, duration, kind })),
    vertexCount,
    indices: Uint32Array.from(index),
    uvs: Float32Array.from(uv),
    pose,
    guides,
  };
}
