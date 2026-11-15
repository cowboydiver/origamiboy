/**
 * Fold guides in the classic diagram convention: valley folds as dashes,
 * mountain folds as dash-dot. They are shown for the active step, strongest
 * at its start, and fade out as the fold proceeds.
 *
 * The dash patterns are laid out as real geometry (wide screen-space lines),
 * scaled a little per crease so every line begins and ends on a full dash.
 *
 * A model says where its guides are at the start of the step. From there on
 * every dash end rides with the piece of paper it was drawn on, so a guide
 * stays on its crease while the paper moves instead of hanging in the air
 * where the paper used to be.
 */
import { DynamicDrawUsage, Group } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { GUIDE_FADE_END } from '../origami/types.js';

const INK = 0x1d1a17;
const LINE_WIDTH = 2.25; // CSS pixels

// Lengths in world units (the sheet is 1 unit wide).
const DASH = 0.042;
const GAP = 0.026;
const LONG_DASH = 0.06;
const DOT = 0.009;
const DOT_GAP = 0.02;
/** A short crease gets a smaller pattern rather than a single bar, down to this scale. */
const MIN_SCALE = 0.4;
/** Below that, one dash-dot-dash with at least this much dot and gap, if it fits. */
const MIN_DOT = 0.0035;
const MIN_GAP = 0.004;

/**
 * The guides of the step that comes next fade in over the last moments of the
 * step before it (seconds at 1x), when the paper has all but come to rest, so
 * that they do not pop in at the boundary.
 */
const LEAD_IN = 0.22;

/** How far from a triangle (in the plane of the sheet) a dash end may be and still ride on it. */
const ANCHOR_REACH = 2e-3;
/** How far along its dash an end is probed for the paper under it (fraction of the dash). */
const PROBE_IN = 0.2;

/**
 * Appends the dashes for one crease to `out` as xyz pairs.
 * @param {import('../origami/types.js').FoldGuide} guide
 * @param {number[]} out
 */
export function layOutDashes(guide, out) {
  const [ax, ay, az] = guide.a;
  const dx = guide.b[0] - ax;
  const dy = guide.b[1] - ay;
  const dz = guide.b[2] - az;
  const length = Math.hypot(dx, dy, dz);
  if (!(length > 1e-6)) return out;

  const push = (from, to) => {
    const u = Math.max(0, from / length);
    const v = Math.min(1, to / length);
    out.push(ax + dx * u, ay + dy * u, az + dz * u, ax + dx * v, ay + dy * v, az + dz * v);
  };

  // One cycle, as [start, end] marks measured from the start of the cycle.
  const mountain = guide.type === 'mountain';
  const lead = mountain ? LONG_DASH : DASH;
  const marks = mountain ? [[0, LONG_DASH], [LONG_DASH + DOT_GAP, LONG_DASH + DOT_GAP + DOT]] : [[0, DASH]];
  const cycle = mountain ? LONG_DASH + 2 * DOT_GAP + DOT : DASH + GAP;

  // n whole cycles plus one closing dash, stretched to fit the crease exactly.
  // A crease too short for two cycles at full size gets a smaller pattern, so
  // that it can still be told apart: a single bar could be either kind of fold.
  let cycles = Math.max(0, Math.round((length - lead) / cycle));
  if (cycles < 2) cycles = length / (2 * cycle + lead) >= MIN_SCALE ? 2 : 0;
  if (cycles > 0) {
    const scale = length / (cycles * cycle + lead);
    for (let i = 0; i < cycles; i++) {
      for (const [from, to] of marks) push((i * cycle + from) * scale, (i * cycle + to) * scale);
    }
    push(cycles * cycle * scale, length);
    return out;
  }

  // Shorter still: one cycle with the dot and the gaps kept large enough to see.
  const scale = length / (cycle + lead);
  const gap = Math.max(MIN_GAP, (mountain ? DOT_GAP : GAP) * scale);
  const dot = mountain ? Math.max(MIN_DOT, DOT * scale) : 0;
  const dash = mountain ? (length - 2 * gap - dot) / 2 : (length - gap) / 2;
  if (dash >= (mountain ? 1.5 * dot : 1.5 * gap)) {
    push(0, dash);
    if (mountain) push(dash + gap, dash + gap + dot);
    push(length - dash, length);
  } else {
    push(0, length); // too short for any pattern: a single dash
  }
  return out;
}

/**
 * Ties every dash end to the triangle of the sheet it lies on in `positions`.
 *
 * Returns, per dash end, the triangle and the point's coordinates in that
 * triangle's own frame (two edge coordinates and a height along the normal),
 * from which `placeDashes` finds the point again in any later pose. Each end
 * is tied on its own, so a dash that crosses from one face to the next (over
 * a vertex where several creases meet, say) keeps both ends on the paper. An
 * end with no paper under it gets triangle -1 and stays where it was drawn.
 *
 * @param {ArrayLike<number>} dashes     xyz pairs from layOutDashes
 * @param {ArrayLike<number>} positions  the pose the guides were drawn for
 * @param {ArrayLike<number>} indices    the model's triangle list
 * @returns {{ triangle: Int32Array, frame: Float32Array }}  per dash end: a triangle; u, v, h
 */
export function anchorDashes(dashes, positions, indices) {
  const endCount = dashes.length / 3;
  const triangle = new Int32Array(endCount).fill(-1);
  const frame = new Float32Array(3 * endCount);

  for (let end = 0; end < endCount; end++) {
    const other = end ^ 1;
    // Probe a little way in from the end, so that an end lying exactly on a
    // corner picks the face the dash itself runs over.
    const mx = dashes[3 * end] + PROBE_IN * (dashes[3 * other] - dashes[3 * end]);
    const my = dashes[3 * end + 1] + PROBE_IN * (dashes[3 * other + 1] - dashes[3 * end + 1]);
    const mz = dashes[3 * end + 2] + PROBE_IN * (dashes[3 * other + 2] - dashes[3 * end + 2]);

    // The surface seen from +Z under the probe: the highest triangle below it
    // that it lies on (or within reach of, for a guide drawn along an edge).
    let best = -1;
    let bestZ = -Infinity;
    let bestOutside = Infinity;
    for (let t = 0; t < indices.length; t += 3) {
      const a = 3 * indices[t];
      const b = 3 * indices[t + 1];
      const c = 3 * indices[t + 2];
      const ux = positions[b] - positions[a];
      const uy = positions[b + 1] - positions[a + 1];
      const vx = positions[c] - positions[a];
      const vy = positions[c + 1] - positions[a + 1];
      const det = ux * vy - uy * vx;
      if (Math.abs(det) < 1e-9) continue; // edge-on from +Z
      const px = mx - positions[a];
      const py = my - positions[a + 1];
      const u = (px * vy - py * vx) / det;
      const v = (ux * py - uy * px) / det;
      const z = positions[a + 2] + u * (positions[b + 2] - positions[a + 2]) + v * (positions[c + 2] - positions[a + 2]);
      if (z > mz + 1e-4) continue; // above the guide
      const outside = distanceOutside(px, py, ux, uy, vx, vy, u, v);
      if (outside > ANCHOR_REACH) continue;
      // Highest first; among equals, the one the dash lies on most squarely.
      if (z > bestZ + 1e-6 || (z > bestZ - 1e-6 && outside < bestOutside - 1e-9)) {
        best = t / 3;
        bestZ = Math.max(bestZ, z);
        bestOutside = outside;
      }
    }
    triangle[end] = best;
    if (best < 0) continue;

    const a = 3 * indices[3 * best];
    const b = 3 * indices[3 * best + 1];
    const c = 3 * indices[3 * best + 2];
    const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
    const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
    const n = unitCross(e1, e2);
    const g11 = dot3(e1, e1);
    const g12 = dot3(e1, e2);
    const g22 = dot3(e2, e2);
    const gram = g11 * g22 - g12 * g12;
    const p = [dashes[3 * end] - positions[a], dashes[3 * end + 1] - positions[a + 1], dashes[3 * end + 2] - positions[a + 2]];
    const p1 = dot3(p, e1);
    const p2 = dot3(p, e2);
    frame[3 * end] = (p1 * g22 - p2 * g12) / gram;
    frame[3 * end + 1] = (p2 * g11 - p1 * g12) / gram;
    frame[3 * end + 2] = dot3(p, n);
  }
  return { triangle, frame };
}

/**
 * Writes where the anchored dash ends are in the pose `positions`.
 * @param {{ triangle: Int32Array, frame: Float32Array }} anchors  from anchorDashes
 * @param {ArrayLike<number>} positions
 * @param {ArrayLike<number>} indices
 * @param {Float32Array|number[]} out  xyz pairs; ends without an anchor are left untouched
 */
export function placeDashes(anchors, positions, indices, out) {
  const { triangle, frame } = anchors;
  for (let end = 0; end < triangle.length; end++) {
    const t = triangle[end];
    if (t < 0) continue;
    const a = 3 * indices[3 * t];
    const b = 3 * indices[3 * t + 1];
    const c = 3 * indices[3 * t + 2];
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    const i = 3 * end;
    const u = frame[i];
    const v = frame[i + 1];
    const h = frame[i + 2];
    out[i] = positions[a] + u * e1x + v * e2x + h * nx;
    out[i + 1] = positions[a + 1] + u * e1y + v * e2y + h * ny;
    out[i + 2] = positions[a + 2] + u * e1z + v * e2z + h * nz;
  }
  return out;
}

const dot3 = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];

function unitCross(p, q) {
  const n = [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
  const length = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / length, n[1] / length, n[2] / length];
}

/**
 * How far the point p (relative to the triangle's first corner) lies outside
 * the triangle with edges u and v, in the xy plane; 0 when it is inside.
 * (s, t) are the point's coordinates along the two edges.
 */
function distanceOutside(px, py, ux, uy, vx, vy, s, t) {
  if (s >= 0 && t >= 0 && s + t <= 1) return 0;
  const toSegment = (ax, ay, bx, by) => {
    const ex = bx - ax;
    const ey = by - ay;
    const k = Math.min(1, Math.max(0, ((px - ax) * ex + (py - ay) * ey) / (ex * ex + ey * ey || 1)));
    return Math.hypot(px - ax - k * ex, py - ay - k * ey);
  };
  return Math.min(toSegment(0, 0, ux, uy), toSegment(0, 0, vx, vy), toSegment(ux, uy, vx, vy));
}

/**
 * How strongly the guides of a step show.
 * @param {number} eased  eased progress through the step
 */
export function guideOpacity(eased) {
  const x = Math.min(1, Math.max(0, eased / GUIDE_FADE_END));
  return 1 - x * x * (3 - 2 * x);
}

/**
 * Which step's guides to show and how strongly: those of the active step,
 * fading as it proceeds, or, in its last moments, those of the next step
 * fading in.
 * @param {number} stepIndex
 * @param {number} linear       linear progress through the step
 * @param {number} eased        eased progress through the step
 * @param {number} duration     the step's duration in seconds
 * @param {number} stepCount
 * @returns {{ step: number, opacity: number }}
 */
export function guideSchedule(stepIndex, linear, eased, duration, stepCount) {
  const lead = Math.min(LEAD_IN, 0.25 * duration);
  const left = (1 - linear) * duration;
  if (left < lead && stepIndex + 1 < stepCount) {
    const x = 1 - left / lead;
    return { step: stepIndex + 1, opacity: x * x * (3 - 2 * x) };
  }
  return { step: stepIndex, opacity: guideOpacity(eased) };
}

/**
 * @param {import('../origami/types.js').OrigamiModel} model
 */
export function createGuides(model) {
  const group = new Group();
  group.name = 'fold-guides';

  const material = new LineMaterial({
    color: INK,
    linewidth: LINE_WIDTH,
    transparent: true,
    depthWrite: false,
  });

  const stepCount = model.steps.length;
  const scratch = new Float32Array(3 * model.vertexCount);
  /** @type {Map<number, null | { lines: LineSegments2, positions: Float32Array, anchors: ReturnType<typeof anchorDashes> }>} */
  const cache = new Map();
  let current = null;

  function build(stepIndex) {
    const dashes = [];
    for (const guide of model.guides(stepIndex) ?? []) layOutDashes(guide, dashes);
    if (dashes.length === 0) return null;
    model.pose(stepIndex, 0, scratch);
    const positions = Float32Array.from(dashes);
    const anchors = anchorDashes(positions, scratch, model.indices);
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(positions); // adopts the array, no copy
    geometry.attributes.instanceStart.data.setUsage(DynamicDrawUsage);
    const lines = new LineSegments2(geometry, material);
    lines.frustumCulled = false;
    lines.renderOrder = 3;
    lines.visible = false;
    group.add(lines);
    return { lines, positions, anchors };
  }

  return {
    object: group,

    /**
     * @param {number} stepIndex  the active step
     * @param {number} linear     linear progress through it, in [0, 1]
     * @param {number} eased      eased progress through it, in [0, 1]
     * @param {Float32Array} positions  the paper's current pose
     */
    update(stepIndex, linear, eased, positions) {
      const { step, opacity } = guideSchedule(stepIndex, linear, eased, model.steps[stepIndex].duration, stepCount);
      if (!cache.has(step)) cache.set(step, build(step));
      const next = cache.get(step);
      if (next !== current) {
        if (current) current.lines.visible = false;
        current = next;
      }
      if (!current) return;
      material.opacity = opacity;
      current.lines.visible = opacity > 0.004;
      if (!current.lines.visible) return;
      placeDashes(current.anchors, positions, model.indices, current.positions);
      current.lines.geometry.attributes.instanceStart.data.needsUpdate = true;
    },

    dispose() {
      for (const entry of cache.values()) entry?.lines.geometry.dispose();
      material.dispose();
    },
  };
}
