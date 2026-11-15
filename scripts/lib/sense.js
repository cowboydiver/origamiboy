/**
 * Contract-only probes of fold sense (development and tests): which way every
 * crease folds in every step, whether pre-creases are made in the sense that
 * later steps use them, and whether each fold guide's valley / mountain label
 * agrees with what the motion then does.
 *
 * Only steps, vertexCount, indices, uvs, pose() and guides() are used. Faces
 * are the connected components of the index buffer; a hinge is a pair of face
 * boundary edges that coincide on the unfolded square.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** A hinge counts as folded flat beyond this angle (radians), and as flat below FLAT. */
const FOLDED = 3.0;
const FLAT = 0.3;

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 */
export function createHingeProbe(model) {
  const V = model.vertexCount;
  const idx = model.indices;
  const uv = model.uvs;
  const T = idx.length / 3;

  const parent = Array.from({ length: V }, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  for (let t = 0; t < T; t++) {
    const a = find(idx[3 * t]);
    parent[find(idx[3 * t + 1])] = a;
    parent[find(idx[3 * t + 2])] = a;
  }
  const roots = new Map();
  const vFace = new Int32Array(V);
  for (let v = 0; v < V; v++) {
    const r = find(v);
    if (!roots.has(r)) roots.set(r, roots.size);
    vFace[v] = roots.get(r);
  }
  const F = roots.size;
  const faceTri = new Int32Array(F);
  for (let t = 0; t < T; t++) faceTri[vFace[idx[3 * t]]] = t;

  // Face boundary edges: used by exactly one triangle.
  const edgeUse = new Map();
  for (let t = 0; t < T; t++) {
    for (let e = 0; e < 3; e++) {
      const a = idx[3 * t + e];
      const b = idx[3 * t + ((e + 1) % 3)];
      const k = a < b ? a * V + b : b * V + a;
      edgeUse.set(k, (edgeUse.get(k) || 0) + 1);
    }
  }
  const boundary = [];
  for (const [k, c] of edgeUse) {
    if (c === 1) {
      const a = Math.floor(k / V);
      boundary.push({ a, b: k % V, f: vFace[a] });
    }
  }

  /**
   * @type {{ fa: number, fb: number, a0: number, a1: number, len: number, leftIsA: boolean, mid: number[], dir: number[] }[]}
   * a0 -> a1 is the edge on face fa; leftIsA says whether fa lies to its left on the unfolded square.
   */
  const hinges = [];
  for (let i = 0; i < boundary.length; i++) {
    for (let j = i + 1; j < boundary.length; j++) {
      const A = boundary[i];
      const B = boundary[j];
      if (A.f === B.f) continue;
      const ax = uv[2 * A.a];
      const ay = uv[2 * A.a + 1];
      const dx = uv[2 * A.b] - ax;
      const dy = uv[2 * A.b + 1] - ay;
      const L = Math.hypot(dx, dy);
      const ux = dx / L;
      const uy = dy / L;
      const c0 = (uv[2 * B.a] - ax) * uy - (uv[2 * B.a + 1] - ay) * ux;
      const c1 = (uv[2 * B.b] - ax) * uy - (uv[2 * B.b + 1] - ay) * ux;
      if (Math.abs(c0) > 1e-7 || Math.abs(c1) > 1e-7) continue;
      const p0 = (uv[2 * B.a] - ax) * ux + (uv[2 * B.a + 1] - ay) * uy;
      const p1 = (uv[2 * B.b] - ax) * ux + (uv[2 * B.b + 1] - ay) * uy;
      const lo = Math.max(0, Math.min(p0, p1));
      const hi = Math.min(L, Math.max(p0, p1));
      if (hi - lo < 1e-6) continue;
      const tA = faceTri[A.f];
      let cx = 0;
      let cy = 0;
      for (let e = 0; e < 3; e++) {
        cx += uv[2 * idx[3 * tA + e]] / 3;
        cy += uv[2 * idx[3 * tA + e] + 1] / 3;
      }
      const leftIsA = ux * (cy - ay) - uy * (cx - ax) > 0;
      hinges.push({ fa: A.f, fb: B.f, a0: A.a, a1: A.b, len: hi - lo, leftIsA, mid: [ax + (ux * (lo + hi)) / 2, ay + (uy * (lo + hi)) / 2], dir: [ux, uy] });
    }
  }

  const P = new Float32Array(3 * V);
  const vtx = (i) => [P[3 * i], P[3 * i + 1], P[3 * i + 2]];
  /** Unit normal of a face in the current pose; it points to the white side. */
  const faceNormal = (f) => {
    const t = faceTri[f];
    const a = vtx(idx[3 * t]);
    const n = cross(sub(vtx(idx[3 * t + 1]), a), sub(vtx(idx[3 * t + 2]), a));
    const l = Math.hypot(...n);
    return n.map((c) => c / l);
  };
  /**
   * Signed fold angle of every hinge in the current pose, in (-pi, pi]:
   * positive is a valley of the WHITE side (the white faces close on each other).
   * The sign is meaningless at exactly 0 and at exactly +-pi.
   */
  const foldAngles = () =>
    hinges.map((h) => {
      const nL = faceNormal(h.leftIsA ? h.fa : h.fb);
      const nR = faceNormal(h.leftIsA ? h.fb : h.fa);
      let e = sub(vtx(h.a1), vtx(h.a0));
      const l = Math.hypot(...e);
      e = e.map((c) => c / l);
      // Flat sheet, white up, hinge along +y: lifting the left face toward the viewer gives (nL x nR) . e < 0.
      return -Math.atan2(dot(cross(nL, nR), e), dot(nL, nR));
    });

  return {
    hinges,
    faceCount: F,
    positions: P,
    /** Poses the model and leaves the result in `positions`. */
    pose(k, t) {
      model.pose(k, t, P);
      return P;
    },
    foldAngles,
    faceNormal,
    vtx,
  };
}

/**
 * The fold sense of every hinge through the whole sequence.
 *
 * For each step: the hinges it folds hard (beyond 150 degrees at some moment,
 * which covers fold-and-unfold steps), how many of them were last folded hard
 * the OTHER way (`reversals`), and how many had never been folded (`fresh`).
 * A hinge that the step leaves folded flat counts in the sense it closed in,
 * so the spine of a reverse fold (opened one way, closed the other) is a
 * reversal however the step is timed.
 *
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 * @param {number} [samples]
 */
export function creaseSenseHistory(model, samples = 80) {
  const probe = createHingeProbe(model);
  const { hinges } = probe;
  /** Per hinge: the last hard fold, { k, s } with s = +1 valley / -1 mountain of the white side. */
  const last = hinges.map(() => null);
  const rows = [];
  model.steps.forEach((step, k) => {
    const peak = hinges.map(() => 0);
    const most = hinges.map(() => 0);
    const latest = hinges.map(() => 0);
    const final = hinges.map(() => 0);
    for (let i = 0; i <= samples; i++) {
      probe.pose(k, i / samples);
      probe.foldAngles().forEach((a, q) => {
        const m = Math.abs(a);
        if (m > most[q]) most[q] = m;
        if (m > 0.5 && m < FOLDED) {
          if (m >= Math.abs(peak[q])) peak[q] = a;
          latest[q] = a;
        }
        final[q] = m;
      });
    }
    const row = { k, id: step.id, kind: step.kind, folded: 0, reversals: 0, reversalLength: 0, fresh: 0, examples: [] };
    if (step.kind !== 'turn-over') {
      hinges.forEach((h, q) => {
        if (!(most[q] > 2.6 && Math.abs(peak[q]) > 2.0)) return;
        // The sense the step leaves the hinge in: for a hinge that ends folded flat, the way it
        // closed (a reverse fold opens a spine one way and closes it the other); for a fold that
        // is undone again, the way it was folded.
        const s = Math.sign(final[q] > 2.6 ? latest[q] : peak[q]);
        row.folded++;
        if (!last[q]) row.fresh++;
        else if (last[q].s !== s) {
          row.reversals++;
          row.reversalLength += h.len;
          if (row.examples.length < 3) {
            row.examples.push(`uv(${h.mid.map((x) => x.toFixed(2))}) was ${last[q].s > 0 ? 'valley' : 'mountain'} of the white side in "${model.steps[last[q].k].id}"`);
          }
        }
        last[q] = { k, s };
      });
    }
    rows.push(row);
  });
  return rows;
}

/**
 * Checks every fold guide against the motion of its step.
 *
 * Each guide is sampled at a few points. Under each point the hinges that lie
 * along the guide in pose(k, 0) are found. If one of them starts flat, the
 * topmost such hinge must then fold, and fold the way the guide says as seen
 * from +Z. Otherwise a hinge that starts folded flat must be turned inside out
 * by the step (the spine of a reverse fold), ending in the sense the guide
 * gives, read on the paper side that faced +Z.
 *
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 * @param {Object} [options]
 * @param {number[]} [options.fractions]  where along each guide to sample
 * @param {number} [options.samples]      poses per step
 * @returns {{ k: number, id: string, guide: number, type: string, at: number, verdict: string, actual?: string }[]}
 *          verdict: 'ok' | 'ok-reversal' | 'wrong' | 'static' | 'no-hinge'
 */
export function guideSense(model, { fractions = [0.1, 0.3, 0.5, 0.7, 0.9], samples = 100 } = {}) {
  const probe = createHingeProbe(model);
  const { hinges } = probe;
  const results = [];
  model.steps.forEach((step, k) => {
    const guides = model.guides(k);
    if (!guides.length) return;
    probe.pose(k, 0);
    const a0 = probe.foldAngles();
    const nz0 = hinges.map((h) => probe.faceNormal(h.fa)[2]);
    const seg0 = hinges.map((h) => [probe.vtx(h.a0), probe.vtx(h.a1)]);
    // Trajectories: first and last unambiguous sign, and whether it ends folded flat.
    const firstFold = hinges.map(() => 0); // first angle beyond FLAT, for hinges that start flat
    const firstOpen = hinges.map(() => 0); // sign when a folded hinge first opens
    const lastOpen = hinges.map(() => 0); //  sign the last time it was open
    let end = a0;
    for (let i = 1; i <= samples; i++) {
      probe.pose(k, i / samples);
      end = probe.foldAngles();
      end.forEach((a, q) => {
        const m = Math.abs(a);
        if (Math.abs(a0[q]) < FLAT) {
          if (!firstFold[q] && m > FLAT && m < FOLDED) firstFold[q] = a;
        } else if (m > FLAT && m < FOLDED) {
          if (!firstOpen[q]) firstOpen[q] = Math.sign(a);
          lastOpen[q] = Math.sign(a);
        }
      });
    }
    const endFolded = end.map((a) => Math.abs(a) > FOLDED);
    guides.forEach((g, gi) => {
      const dx = g.b[0] - g.a[0];
      const dy = g.b[1] - g.a[1];
      const L = Math.hypot(dx, dy);
      for (const fr of fractions) {
        const point = [g.a[0] + dx * fr, g.a[1] + dy * fr];
        let flatBest = -1;
        let flatZ = -Infinity;
        const folded = [];
        hinges.forEach((h, q) => {
          const [A, B] = seg0[q];
          const ex = B[0] - A[0];
          const ey = B[1] - A[1];
          const el = Math.hypot(ex, ey);
          if (el < 1e-9) return;
          if (Math.abs(ex * dy - ey * dx) / (el * L) > 1e-3) return; // not parallel
          const tt = ((point[0] - A[0]) * ex + (point[1] - A[1]) * ey) / (el * el);
          if (tt < -1e-6 || tt > 1 + 1e-6) return;
          if (Math.hypot(A[0] + ex * tt - point[0], A[1] + ey * tt - point[1]) > 1e-4) return; // not on it
          const z = A[2] + (B[2] - A[2]) * tt;
          if (Math.abs(a0[q]) < FLAT) {
            if (z > flatZ) {
              flatZ = z;
              flatBest = q;
            }
          } else if (Math.abs(a0[q]) > FOLDED) {
            folded.push(q);
          }
        });
        const record = (verdict, actual) => results.push({ k, id: step.id, guide: gi, type: g.type, at: fr, verdict, actual });
        if (flatBest >= 0) {
          if (!firstFold[flatBest]) {
            record('static');
            continue;
          }
          // Both faces of a flat hinge face the same way; the white normal's z says which side the viewer sees.
          const actual = Math.sign(firstFold[flatBest]) * Math.sign(nz0[flatBest]) > 0 ? 'valley' : 'mountain';
          record(actual === g.type ? 'ok' : 'wrong', actual);
          continue;
        }
        const reversed = folded.filter((q) => firstOpen[q] && lastOpen[q] && firstOpen[q] !== lastOpen[q] && endFolded[q]);
        if (!reversed.length) {
          record('no-hinge');
          continue;
        }
        // A pair folded flat shows the viewer the outer side of its upper face, and seen from
        // outside a folded edge is always a mountain. Turned inside out, the same paper side
        // sees a valley, whichever colour it is.
        const actual = 'valley';
        record(actual === g.type ? 'ok-reversal' : 'wrong', actual);
      }
    });
  });
  return results;
}
