/**
 * Exact flat-fold state engine.
 *
 * The square is a set of convex faces in paper coordinates (centred on the
 * origin, white side toward +Z at the start). Every face carries a 2D isometry
 * M (paper -> folded plane) and a layer key (a bigger key is nearer the viewer,
 * +Z). Folding is done by the caller: split faces along a line, then give the
 * moving ones a new M and key. `snap()` records the state so that a sequence
 * of flat states, and the face partition that serves all of them, comes out at
 * the end.
 *
 * Pure ESM, no dependencies.
 */
import { ID2, ap2, centroid, det2, inv2, overlap, side, splitPoly } from './geom.js';

/**
 * @typedef {Object} SheetFace
 * @property {number[][]} poly  convex outline in paper coordinates, counter-clockwise
 * @property {number[]} M       current paper -> folded-plane isometry
 * @property {number} key       current layer key
 * @property {Object} tags      free-form labels set by the sequence
 * @property {{ M: number[], key: number }[]} hist  one entry per snapshot
 * @property {number[]} grp     rigid group of this face in each motion, by motion id
 */

export class Sheet {
  constructor() {
    /** @type {SheetFace[]} */
    this.faces = [
      { poly: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], M: ID2, key: 0, tags: {}, hist: [], grp: [] },
    ];
    /** Layer keys above `mid` belong to the front half of the model. */
    this.mid = -0.5;
    this.mids = [];
  }

  folded(f) {
    return f.poly.map((p) => ap2(f.M, p));
  }

  cen(f) {
    return centroid(this.folded(f));
  }

  /** Splits every face accepted by `pred` along the folded-space line a -> b. */
  split(a, b, pred = () => true) {
    const out = [];
    for (const f of this.faces) {
      if (!pred(f)) {
        out.push(f);
        continue;
      }
      const inv = inv2(f.M);
      const [L, R] = splitPoly(f.poly, ap2(inv, a), ap2(inv, b));
      if (!L || !R) {
        out.push(f);
        continue;
      }
      for (const poly of [L, R]) {
        out.push({ poly, M: f.M, key: f.key, tags: { ...f.tags }, hist: f.hist.slice(), grp: f.grp.slice() });
      }
    }
    this.faces = out;
  }

  /** Records the current state; returns its snapshot index. */
  snap() {
    for (const f of this.faces) f.hist.push({ M: f.M, key: f.key });
    this.mids.push(this.mid);
    return this.mids.length - 1;
  }

  restore(i) {
    for (const f of this.faces) {
      f.M = f.hist[i].M;
      f.key = f.hist[i].key;
    }
    this.mid = this.mids[i];
  }

  maxKey() {
    return Math.max(...this.faces.map((f) => f.key));
  }

  minGap() {
    return Math.min(...this.faces.map((f) => Math.abs(f.key - this.mid)));
  }

  /** The smallest difference between two distinct layer keys. */
  keyStep() {
    const keys = [...new Set(this.faces.map((f) => f.key))].sort((a, b) => a - b);
    let step = Infinity;
    for (let i = 1; i < keys.length; i++) step = Math.min(step, keys[i] - keys[i - 1]);
    return step;
  }
}

/**
 * Pairs of faces that share a paper edge segment of positive length.
 * @param {SheetFace[]} faces
 * @returns {[number, number, number[], number[]][]}  [i, j, p, q] with p, q the shared segment in paper coordinates
 */
export function paperAdjacency(faces) {
  const res = [];
  const E = 1e-9;
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const A = faces[i].poly;
      const B = faces[j].poly;
      let found = null;
      for (let a = 0; a < A.length && !found; a++) {
        const a0 = A[a];
        const a1 = A[(a + 1) % A.length];
        const la = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]);
        const ux = (a1[0] - a0[0]) / la;
        const uy = (a1[1] - a0[1]) / la;
        for (let b = 0; b < B.length; b++) {
          const b0 = B[b];
          const b1 = B[(b + 1) % B.length];
          if (Math.abs(side(a0, a1, b0)) > E || Math.abs(side(a0, a1, b1)) > E) continue;
          const s0 = (b0[0] - a0[0]) * ux + (b0[1] - a0[1]) * uy;
          const s1 = (b1[0] - a0[0]) * ux + (b1[1] - a0[1]) * uy;
          const lo = Math.max(0, Math.min(s0, s1));
          const hi = Math.min(la, Math.max(s0, s1));
          if (hi - lo > 1e-7) {
            found = [i, j, [a0[0] + ux * lo, a0[1] + uy * lo], [a0[0] + ux * hi, a0[1] + uy * hi]];
            break;
          }
        }
      }
      if (found) res.push(found);
    }
  }
  return res;
}

export const sameMap = (A, B, tol = 1e-7) => A.every((v, k) => Math.abs(v - B[k]) < tol);

/**
 * Layer heights for snapshot `s`: locally compacted levels on each side of the
 * mid plane, `eps` apart. Faces that are joined by an unfolded crease and share
 * a key share a level, so a flat region never shows a step. A sheet with room
 * to spare lies against its coloured-side neighbour's far side (see below).
 * @param {SheetFace[]} faces
 * @param {ReturnType<typeof paperAdjacency>} adj
 * @param {number} s
 * @param {number} mid
 * @param {number} eps
 * @returns {Float64Array}
 */
export function heights(faces, adj, s, mid, eps) {
  const n = faces.length;
  const h = new Float64Array(n);
  const level = new Int32Array(n);
  const P = faces.map((f) => f.poly.map((p) => ap2(f.hist[s].M, p)));
  const bb = P.map((poly) => [
    Math.min(...poly.map((p) => p[0])),
    Math.min(...poly.map((p) => p[1])),
    Math.max(...poly.map((p) => p[0])),
    Math.max(...poly.map((p) => p[1])),
  ]);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [i, j] of adj) {
    if (faces[i].hist[s].key === faces[j].hist[s].key && sameMap(faces[i].hist[s].M, faces[j].hist[s].M)) {
      parent[find(i)] = find(j);
    }
  }
  for (const sgn of [1, -1]) {
    const ids = [];
    for (let i = 0; i < n; i++) if (sgn * (faces[i].hist[s].key - mid) > 0) ids.push(i);
    ids.sort((a, b) => sgn * (faces[a].hist[s].key - faces[b].hist[s].key));
    const placed = [];
    let k = 0;
    while (k < ids.length) {
      let e = k;
      while (e < ids.length && faces[ids[e]].hist[s].key === faces[ids[k]].hist[s].key) e++;
      const need = new Map();
      for (let q = k; q < e; q++) {
        const i = ids[q];
        let lv = 1;
        for (const j of placed) {
          if (level[j] < lv) continue;
          if (bb[i][0] > bb[j][2] - 1e-7 || bb[j][0] > bb[i][2] - 1e-7 || bb[i][1] > bb[j][3] - 1e-7 || bb[j][1] > bb[i][3] - 1e-7) continue;
          if (overlap(P[i], P[j])) lv = level[j] + 1;
        }
        const r = find(i);
        need.set(r, Math.max(need.get(r) || 0, lv));
      }
      for (let q = k; q < e; q++) {
        const i = ids[q];
        level[i] = need.get(find(i));
        placed.push(i);
      }
      k = e;
    }
    // Every sheet now sits as near the mid plane as it can. Where a sheet has room to spare
    // under the next one out, the spare gap is better left on its coloured side: a sheet whose
    // inner side is coloured moves out to lie against the sheet above it, so that the open
    // edges of the stack do not show a white slit. Outermost sheets first.
    const sheets = new Map();
    for (const i of ids) {
      const r = find(i);
      if (!sheets.has(r)) sheets.set(r, []);
      sheets.get(r).push(i);
    }
    const outerFirst = [...sheets.values()].sort((a, b) => level[b[0]] - level[a[0]]);
    for (const sheet of outerFirst) {
      if (sgn * det2(faces[sheet[0]].hist[s].M) <= 0) continue; // white inside: stay put
      let room = Infinity;
      for (const i of sheet) {
        for (const j of ids) {
          if (level[j] <= level[i] || level[j] - 1 >= room) continue;
          if (bb[i][0] > bb[j][2] - 1e-7 || bb[j][0] > bb[i][2] - 1e-7 || bb[i][1] > bb[j][3] - 1e-7 || bb[j][1] > bb[i][3] - 1e-7) continue;
          if (overlap(P[i], P[j])) room = level[j] - 1;
        }
      }
      if (room !== Infinity && room > level[sheet[0]]) for (const i of sheet) level[i] = room;
    }
    for (const i of ids) h[i] = sgn * (level[i] - 0.5) * eps;
  }
  if (h.every((v) => v === h[0])) h.fill(0); // a single unfolded layer lies exactly in the plane z = 0
  return h;
}
