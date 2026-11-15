/**
 * Fold guides derived from the motion itself, so a label can never drift away
 * from what the animation does.
 *
 * For the motion of a step, every crease (a pair of faces that are neighbours
 * on the paper) has a signed fold angle before and after: 0 when flat, +pi
 * when folded flat as a valley of the WHITE side, -pi as a mountain. Before
 * the motion it is read off the flat state the step starts from (same map =
 * flat; otherwise the layer order says which way it is folded). After it, off
 * the flat state the motion ends in, or off the motion's own end transforms
 * when it does not end flat (the wings).
 *
 * A crease gets a guide when the motion
 * - folds it from flat, and it lies on the surface visible from +Z: the part
 *   of it not buried under higher layers is drawn; or
 * - turns it inside out (the spine of a reverse fold): drawn in full along
 *   the edge, on top of the layers that sit over it.
 * Creases that merely open and close again during the motion, and creases that
 * unfold, get none. The type is the sense of the change as seen from +Z:
 * the white-side sign, flipped where the coloured side faces the viewer.
 *
 * Collinear pieces of one type that touch are merged into whole lines.
 */
import { sameMap } from '../../origami/flatSheet.js';
import { ap2, centroid, clipSegment, det2, dot, insideConvex, mv } from '../../origami/geom.js';

/** Fold angle (radians) below which a crease does not count as folded by the motion. */
const MIN_FOLD = 0.35;
/** Sideways offset of the probes that decide what covers a crease. */
const PROBE = 1e-4;
/** Pieces shorter than this are numerical crumbs. */
const MIN_PIECE = 1e-3;
/** Pieces of a line closer than this are joined. */
const JOIN = 2e-4;

/**
 * @param {ReturnType<typeof import('./sequence.js').buildCrane>} core
 * @param {number} stepIndex
 * @param {number} lift  how far above the surface the guides sit
 * @returns {import('../../origami/types.js').FoldGuide[]}
 */
export function deriveGuides(core, stepIndex, lift) {
  const step = core.steps[stepIndex];
  if (step.kind === 'turn-over') return [];
  const pieces = creasePieces(core, step.phases[0]);
  const [cx, cy] = core.centers[step.phases[0].start];
  return mergePieces(pieces).map((line) => ({
    type: line.type,
    a: [line.a[0] - cx, line.a[1] - cy, line.z + lift],
    b: [line.b[0] - cx, line.b[1] - cy, line.z + lift],
  }));
}

/**
 * Signed fold angles of every paper-adjacent face pair before and after a
 * motion, with respect to the white side.
 * @returns {{ i: number, j: number, a: number[], b: number[], before: number, after: number }[]}
 *          a, b: the crease in the folded plane of the motion's start state
 */
function creaseAngles(core, ph) {
  const { faces, adj } = core;
  const start = faces.map((f) => f.hist[ph.start]);
  const end = ph.flat ? faces.map((f) => f.hist[ph.end]) : null;
  const G1 = ph.flat ? null : ph.motion(1);
  const polys = faces.map((f, i) => f.poly.map((p) => ap2(start[i].M, p)));
  const flatAngle = (state, i, j) =>
    sameMap(state[i].M, state[j].M) ? 0 : Math.PI * Math.sign(det2(state[i].M) * (state[j].key - state[i].key));

  return adj.map(([i, j, p, q]) => {
    const a = ap2(start[i].M, p);
    const b = ap2(start[i].M, q);
    const before = flatAngle(start, i, j);
    let after;
    if (end) {
      after = flatAngle(end, i, j);
    } else {
      const gi = faces[i].grp[ph.id];
      const gj = faces[j].grp[ph.id];
      if (gi === gj) {
        after = before;
      } else {
        // In-plane unit vectors pointing from the crease into each face, carried by the motion.
        const inward = (poly) => {
          const c = centroid(poly);
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const l = Math.hypot(dx, dy);
          const s = Math.sign(dx * (c[1] - a[1]) - dy * (c[0] - a[0]));
          return [(-dy / l) * s, (dx / l) * s, 0];
        };
        const Ui = mv(G1[gi].R, inward(polys[i]));
        const Uj = mv(G1[gj].R, inward(polys[j]));
        const ni = mv(G1[gi].R, [0, 0, Math.sign(det2(start[i].M))]);
        after = Math.atan2(dot(ni, Uj), -dot(Ui, Uj));
      }
    }
    return { i, j, a, b, before, after };
  });
}

/** The visible pieces of every crease the motion folds or turns inside out. */
function creasePieces(core, ph) {
  const { faces } = core;
  const h = core.H[ph.start];
  const start = faces.map((f) => f.hist[ph.start]);
  const polys = faces.map((f, i) => f.poly.map((p) => ap2(start[i].M, p)));
  const whiteUp = (i) => det2(start[i].M) > 0;
  const pieces = [];

  for (const { i, j, a, b, before, after } of creaseAngles(core, ph)) {
    const folds = before === 0 && Math.abs(after) > MIN_FOLD;
    const reverses = before !== 0 && after !== 0 && Math.sign(after) !== Math.sign(before) && Math.abs(after) > Math.PI - 1e-9;
    if (!folds && !reverses) continue;

    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const nx = (-dy / length) * PROBE;
    const ny = (dx / length) * PROBE;
    const at = (t, sgn) => [a[0] + dx * t + sgn * nx, a[1] + dy * t + sgn * ny];
    /** Height of the surface seen from +Z next to the crease at parameter t. */
    const surface = (t) => {
      let z = -Infinity;
      for (const sgn of [1, -1]) {
        const p = at(t, sgn);
        polys.forEach((poly, f) => {
          if (h[f] > z && insideConvex(poly, p)) z = h[f];
        });
      }
      return z;
    };

    // The paper side facing +Z on the upper of the two faces decides how the fold reads from the viewer.
    const upper = h[i] >= h[j] ? i : j;
    const type = Math.sign(after) * (whiteUp(upper) ? 1 : -1) > 0 ? 'valley' : 'mountain';

    let visible = [[0, 1]];
    if (folds) {
      // Hidden where higher layers cover the paper on BOTH sides of the crease.
      const level = Math.max(h[i], h[j]) + 1e-9;
      const covered = [1, -1].map((sgn) => {
        const list = [];
        polys.forEach((poly, f) => {
          if (f === i || f === j || !(h[f] > level)) return;
          const hit = clipSegment(poly, at(0, sgn), at(1, sgn));
          if (hit) list.push(hit);
        });
        return union(list);
      });
      visible = subtract([0, 1], intersect(covered[0], covered[1]));
    }
    for (const [t0, t1] of visible) {
      if ((t1 - t0) * length < MIN_PIECE) continue;
      pieces.push({
        type,
        a: [a[0] + dx * t0, a[1] + dy * t0],
        b: [a[0] + dx * t1, a[1] + dy * t1],
        z: surface((t0 + t1) / 2),
      });
    }
  }
  return pieces;
}

/** Joins collinear, touching pieces of one type into whole lines. */
function mergePieces(pieces) {
  const lines = [];
  for (const piece of pieces) {
    let dx = piece.b[0] - piece.a[0];
    let dy = piece.b[1] - piece.a[1];
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    if (dx < -1e-9 || (Math.abs(dx) <= 1e-9 && dy < 0)) {
      dx = -dx;
      dy = -dy;
    }
    const offset = dx * piece.a[1] - dy * piece.a[0];
    const s0 = dx * piece.a[0] + dy * piece.a[1];
    const s1 = dx * piece.b[0] + dy * piece.b[1];
    let line = lines.find(
      (x) => x.type === piece.type && Math.abs(x.dx * dy - x.dy * dx) < 1e-7 && Math.abs(x.offset - offset) < 1e-6,
    );
    if (!line) lines.push((line = { type: piece.type, dx, dy, offset, spans: [] }));
    line.spans.push([Math.min(s0, s1), Math.max(s0, s1), piece.z]);
  }
  const out = [];
  for (const line of lines) {
    line.spans.sort((p, q) => p[0] - q[0]);
    let current = null;
    for (const span of line.spans) {
      if (current && span[0] <= current[1] + JOIN) {
        current[1] = Math.max(current[1], span[1]);
        current[2] = Math.max(current[2], span[2]);
      } else {
        current = span.slice();
        out.push({ line, span: current });
      }
    }
  }
  return out.map(({ line, span }) => {
    // Point on the line at position s: s * d + offset * n, with n = (-dy, dx).
    const point = (s) => [s * line.dx - line.offset * line.dy, s * line.dy + line.offset * line.dx];
    return { type: line.type, a: point(span[0]), b: point(span[1]), z: span[2] };
  });
}

// ---- interval sets on [0, 1], as sorted lists of [from, to] -----------------

function union(list) {
  const sorted = list.slice().sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [from, to] of sorted) {
    const last = out[out.length - 1];
    if (last && from <= last[1] + 1e-9) last[1] = Math.max(last[1], to);
    else out.push([from, to]);
  }
  return out;
}

function intersect(A, B) {
  const out = [];
  for (const [a0, a1] of A) {
    for (const [b0, b1] of B) {
      const from = Math.max(a0, b0);
      const to = Math.min(a1, b1);
      if (to > from) out.push([from, to]);
    }
  }
  return out;
}

function subtract([from, to], holes) {
  const out = [];
  let cursor = from;
  for (const [h0, h1] of holes) {
    if (h0 > cursor) out.push([cursor, Math.min(h0, to)]);
    cursor = Math.max(cursor, h1);
  }
  if (cursor < to) out.push([cursor, to]);
  return out;
}
