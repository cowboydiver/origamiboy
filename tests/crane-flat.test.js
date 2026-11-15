/**
 * The crane's exact flat-fold states and its zero-thickness kinematics,
 * checked below the level of the model contract: every flat state must be a
 * valid flat folding of the square, land on the expected silhouette, and every
 * motion must keep all hinges closed.
 */
import { describe, expect, it } from 'vitest';
import { ap2, apT, det2, overlap, side } from '../src/origami/geom.js';
import { PETAL, petalAngles } from '../src/models/crane/motions.js';
import { buildCrane } from '../src/models/crane/sequence.js';

const core = buildCrane();
const { faces, adj, steps, nSnap } = core;
const R2 = Math.SQRT2;
const nearP = (p, q, e = 1e-9) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= e;
const sameM = (A, B) => A.every((v, k) => Math.abs(v - B[k]) < 1e-9);

/** Human-readable name of a snapshot, for failure messages. */
function snapName(s) {
  let name = 'start';
  for (const st of steps) {
    for (const ph of st.phases) if ((ph.rev ? ph.snapEnd : ph.end) === s) name = st.id + (ph.rev ? ' (unfolded)' : ' (folded)');
  }
  return name;
}

describe('crane flat states: geometry', () => {
  it('maps every face by an isometry in every state, and the faces tile the square', () => {
    let worst = 0;
    let area = 0;
    for (const f of faces) {
      let a = 0;
      for (let i = 0; i < f.poly.length; i++) {
        const p = f.poly[i];
        const q = f.poly[(i + 1) % f.poly.length];
        a += p[0] * q[1] - q[0] * p[1];
      }
      expect(a).toBeGreaterThan(0); // counter-clockwise, seen from the white side
      area += a / 2;
      for (const h of f.hist) {
        const M = h.M;
        worst = Math.max(
          worst,
          Math.abs(M[0] * M[0] + M[2] * M[2] - 1),
          Math.abs(M[1] * M[1] + M[3] * M[3] - 1),
          Math.abs(M[0] * M[1] + M[2] * M[3]),
          Math.abs(Math.abs(det2(M)) - 1),
        );
      }
    }
    expect(worst).toBeLessThan(1e-12);
    expect(area).toBeCloseTo(1, 12);
  });

  it('keeps faces that share a paper edge joined along it in every state', () => {
    let worst = 0;
    for (let s = 0; s < nSnap; s++) {
      for (const [i, j, p, q] of adj) {
        for (const x of [p, q]) {
          const a = ap2(faces[i].hist[s].M, x);
          const b = ap2(faces[j].hist[s].M, x);
          worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
        }
      }
    }
    expect(worst).toBeLessThan(1e-9);
  });

  it('has no T-junctions: every shared crease is a whole edge of both faces (the viewer relies on it)', () => {
    const isEdge = (poly, p, q) =>
      poly.some((a, i) => {
        const b = poly[(i + 1) % poly.length];
        return (nearP(a, p) && nearP(b, q)) || (nearP(a, q) && nearP(b, p));
      });
    for (const [i, j, p, q] of adj) {
      expect(isEdge(faces[i].poly, p, q) && isEdge(faces[j].poly, p, q)).toBe(true);
    }
  });
});

describe('crane flat states: layer order', () => {
  const bad = { dup: [], tortilla: [], taco: [] };
  for (let s = 0; s < nSnap; s++) {
    const P = faces.map((f) => f.poly.map((p) => ap2(f.hist[s].M, p)));
    const K = faces.map((f) => f.hist[s].key);
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        if (K[i] === K[j] && overlap(P[i], P[j], 1e-7)) bad.dup.push(`f${i}/f${j} @${snapName(s)}`);
      }
    }
    const folded = adj
      .filter(([i, j]) => !sameM(faces[i].hist[s].M, faces[j].hist[s].M))
      .map(([i, j, p, q]) => ({ i, j, a: ap2(faces[i].hist[s].M, p), b: ap2(faces[i].hist[s].M, q) }));
    const inside = (poly, x) => {
      let sg = 0;
      for (let e = 0; e < poly.length; e++) {
        const d = side(poly[e], poly[(e + 1) % poly.length], x);
        if (Math.abs(d) < 1e-6) return false;
        if (!sg) sg = Math.sign(d);
        else if (Math.sign(d) !== sg) return false;
      }
      return true;
    };
    for (const cr of folded) {
      const lo = Math.min(K[cr.i], K[cr.j]);
      const hi = Math.max(K[cr.i], K[cr.j]);
      for (const u of [0.2, 0.5, 0.8]) {
        const x = [cr.a[0] + u * (cr.b[0] - cr.a[0]), cr.a[1] + u * (cr.b[1] - cr.a[1])];
        for (let k = 0; k < faces.length; k++) {
          if (k !== cr.i && k !== cr.j && K[k] > lo && K[k] < hi && inside(P[k], x)) {
            bad.tortilla.push(`face f${k} cuts crease f${cr.i}/f${cr.j} @${snapName(s)}`);
          }
        }
      }
    }
    const cen = (i) => {
      const q = P[i];
      return [q.reduce((t, v) => t + v[0], 0) / q.length, q.reduce((t, v) => t + v[1], 0) / q.length];
    };
    for (let x = 0; x < folded.length; x++) {
      for (let y = x + 1; y < folded.length; y++) {
        const A = folded[x];
        const B = folded[y];
        if (Math.abs(side(A.a, A.b, B.a)) > 1e-7 || Math.abs(side(A.a, A.b, B.b)) > 1e-7) continue;
        const L = Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]);
        const ux = (A.b[0] - A.a[0]) / L;
        const uy = (A.b[1] - A.a[1]) / L;
        const s0 = (B.a[0] - A.a[0]) * ux + (B.a[1] - A.a[1]) * uy;
        const s1 = (B.b[0] - A.a[0]) * ux + (B.b[1] - A.a[1]) * uy;
        if (Math.min(L, Math.max(s0, s1)) - Math.max(0, Math.min(s0, s1)) < 1e-6) continue;
        if (Math.sign(side(A.a, A.b, cen(A.i))) !== Math.sign(side(A.a, A.b, cen(B.i)))) continue; // flaps on opposite sides
        const a0 = Math.min(K[A.i], K[A.j]);
        const a1 = Math.max(K[A.i], K[A.j]);
        const b0 = Math.min(K[B.i], K[B.j]);
        const b1 = Math.max(K[B.i], K[B.j]);
        if ((a0 < b0 && b0 < a1 && a1 < b1) || (b0 < a0 && a0 < b1 && b1 < a1)) {
          bad.taco.push(`interleaved folds f${A.i}/f${A.j} x f${B.i}/f${B.j} @${snapName(s)}`);
        }
      }
    }
  }

  it('never gives overlapping faces the same layer key', () => {
    expect(bad.dup).toEqual([]);
  });
  it('never passes a face through a folded crease (taco-tortilla)', () => {
    expect(bad.tortilla).toEqual([]);
  });
  it('nests coincident folds instead of interleaving them (taco-taco)', () => {
    expect(bad.taco).toEqual([]);
  });
});

describe('crane flat states: Kawasaki and Maekawa at every folded interior vertex', () => {
  const verts = [];
  for (const f of faces) {
    for (const p of f.poly) {
      if (Math.abs(p[0]) < 0.5 - 1e-9 && Math.abs(p[1]) < 0.5 - 1e-9 && !verts.some((v) => nearP(v, p))) verts.push(p);
    }
  }
  let worstKawasaki = 0;
  let checked = 0;
  const open = [];
  const maekawa = [];
  for (let s = 0; s < nSnap; s++) {
    for (const v of verts) {
      const sect = []; // sectors around v: [start angle, sweep, face]
      faces.forEach((f, fi) => {
        const n = f.poly.length;
        for (let e = 0; e < n; e++) {
          const p = f.poly[e];
          const prev = f.poly[(e + n - 1) % n];
          const next = f.poly[(e + 1) % n];
          if (nearP(p, v)) {
            const a0 = Math.atan2(next[1] - v[1], next[0] - v[0]);
            const a1 = Math.atan2(prev[1] - v[1], prev[0] - v[0]);
            sect.push([a0, (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), fi]);
          } else if (
            Math.abs(side(p, next, v)) < 1e-9 &&
            (v[0] - p[0]) * (next[0] - p[0]) + (v[1] - p[1]) * (next[1] - p[1]) > 1e-9 &&
            (v[0] - next[0]) * (p[0] - next[0]) + (v[1] - next[1]) * (p[1] - next[1]) > 1e-9
          ) {
            sect.push([Math.atan2(next[1] - v[1], next[0] - v[0]), Math.PI, fi]);
          }
        }
      });
      sect.sort((a, b) => a[0] - b[0]);
      const total = sect.reduce((t, x) => t + x[1], 0);
      if (Math.abs(total - 2 * Math.PI) > 1e-7) {
        open.push(`sectors do not close around (${v}) @${snapName(s)}`);
        continue;
      }
      // Merge sectors across unfolded creases: [start, sweep, first face, last face], counter-clockwise.
      const H = (fi) => faces[fi].hist[s];
      const m = [];
      for (const x of sect) {
        const last = m[m.length - 1];
        if (last && sameM(H(last[3]).M, H(x[2]).M)) {
          last[1] += x[1];
          last[3] = x[2];
        } else m.push([x[0], x[1], x[2], x[2]]);
      }
      if (m.length > 1 && sameM(H(m[0][2]).M, H(m[m.length - 1][3]).M)) {
        const l = m.pop();
        m[0][1] += l[1];
        m[0][2] = l[2];
      }
      if (m.length < 2) continue; // the vertex is not folded in this state
      checked++;
      let alt = 0;
      m.forEach((x, k) => {
        alt += (k % 2 ? -1 : 1) * x[1];
      });
      worstKawasaki = Math.max(worstKawasaki, m.length % 2 ? 9 : Math.abs(alt));
      // Crease between merged sectors k and k + 1: the far face lies above (+) or below (-) the near
      // one; with the near face's orientation that makes it a mountain or a valley.
      let mv = 0;
      m.forEach((x, k) => {
        const y = m[(k + 1) % m.length];
        mv += Math.sign(H(y[2]).key - H(x[3]).key) * Math.sign(det2(H(x[3]).M));
      });
      if (Math.abs(mv) !== 2) maekawa.push(`M - V = ${mv} at (${v.map((t) => t.toFixed(3))}) @${snapName(s)}`);
    }
  }

  it('finds the sectors closing around every vertex', () => {
    expect(open).toEqual([]);
    expect(checked).toBeGreaterThan(500);
  });
  it('Kawasaki: alternating sector angles sum to zero', () => {
    expect(worstKawasaki).toBeLessThan(1e-9);
  });
  it('Maekawa: mountains and valleys differ by two', () => {
    expect(maekawa).toEqual([]);
  });
});

describe('crane flat states: expected silhouettes', () => {
  const stateAfter = (id) => {
    const st = steps.find((x) => x.id === id);
    const ph = st.phases[st.phases.length - 1];
    return ph.rev ? ph.snapEnd : ph.end;
  };
  /** Where the paper point p ends up in state s. */
  const img = (s, p) => {
    const f = faces.find((face) => {
      let sg = 0;
      for (let e = 0; e < face.poly.length; e++) {
        const d = side(face.poly[e], face.poly[(e + 1) % face.poly.length], p);
        if (Math.abs(d) < 1e-12) continue;
        if (!sg) sg = Math.sign(d);
        else if (Math.sign(d) !== sg) return false;
      }
      return true;
    });
    return ap2(f.hist[s].M, p);
  };
  const pts = (s) => faces.flatMap((f) => f.poly.map((p) => ap2(f.hist[s].M, p)));
  const bbox = (s) => {
    const q = pts(s);
    return [Math.min(...q.map((p) => p[0])), Math.max(...q.map((p) => p[0])), Math.min(...q.map((p) => p[1])), Math.max(...q.map((p) => p[1]))];
  };
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  const mids = [[0.5, 0], [0, 0.5], [-0.5, 0], [0, -0.5]];
  const Pp = (R2 - 1) / 2;

  it('pre-creases leave the sheet flat and unmoved', () => {
    for (const id of ['book-1', 'book-2', 'diagonal-1', 'diagonal-2']) {
      const s = stateAfter(id);
      const turned = id.startsWith('diagonal'); // after the turn-over x is mirrored
      for (const c of corners) expect(nearP(img(s, c), [turned ? -c[0] : c[0], c[1]])).toBe(true);
    }
  });

  it('preliminary base: a diamond of side 1/2, four layers on each half', () => {
    const s = stateAfter('preliminary-base');
    const b = bbox(s);
    expect(corners.every((k) => nearP(img(s, k), [0, 0]))).toBe(true); // all four corners at the open point
    expect(nearP(img(s, [0, 0]), [0, R2 / 2])).toBe(true); // paper centre at the closed top
    for (const k of mids) {
      expect(Math.abs(img(s, k)[0])).toBeCloseTo(R2 / 4, 9);
      expect(img(s, k)[1]).toBeCloseTo(R2 / 4, 9);
    }
    expect(mids.filter((k) => img(s, k)[0] > 0).length).toBe(2);
    expect(b[0]).toBeCloseTo(-R2 / 4, 9);
    expect(b[1]).toBeCloseTo(R2 / 4, 9);
    expect(b[2]).toBeCloseTo(0, 9);
    expect(b[3]).toBeCloseTo(R2 / 2, 9);
    expect(new Set(faces.map((f) => f.hist[s].key)).size).toBe(4);
  });

  it('preliminary base: the coloured side is outside', () => {
    const s = stateAfter('preliminary-base');
    const keys = faces.map((f) => f.hist[s].key);
    const top = Math.max(...keys);
    const bottom = Math.min(...keys);
    faces.forEach((f, i) => {
      // White faces +Z where the map preserves orientation: the top layer must show colour to +Z, the bottom to -Z.
      if (keys[i] === top) expect(det2(f.hist[s].M)).toBeLessThan(0);
      if (keys[i] === bottom) expect(det2(f.hist[s].M)).toBeGreaterThan(0);
    });
  });

  it('petal folds: one corner lifted, then the bird base', () => {
    let s = stateAfter('petal-fold-1');
    expect(corners.filter((k) => nearP(img(s, k), [0, 1])).length).toBe(1);
    expect(corners.filter((k) => nearP(img(s, k), [0, 0])).length).toBe(3);
    s = stateAfter('petal-fold-2');
    const b = bbox(s);
    expect(b[0]).toBeCloseTo(-Pp, 9);
    expect(b[1]).toBeCloseTo(Pp, 9);
    expect(b[2]).toBeCloseTo(0, 9);
    expect(b[3]).toBeCloseTo(1, 9);
    for (const p of pts(s).filter((q) => Math.abs(Math.abs(q[0]) - Pp) < 1e-9)) expect(p[1]).toBeCloseTo(0.5, 9); // widest at y = 1/2
    expect(corners.filter((k) => nearP(img(s, k), [0, 1])).length).toBe(2); // wing tips
    expect(corners.filter((k) => nearP(img(s, k), [0, 0])).length).toBe(2); // legs
    expect(nearP(img(s, [0, 0]), [0, R2 / 2])).toBe(true); // paper centre hidden inside
    expect((Math.atan2(PETAL.P[0], PETAL.P[1]) * 180) / Math.PI).toBeCloseTo(22.5, 9);
  });

  it('narrowed legs, then neck, tail and head above the body', () => {
    let s = stateAfter('narrow-2');
    let b = bbox(s);
    const yq = (2 * Pp) / (Math.tan(Math.PI / 16) + 2 * Pp);
    const xq = yq * Math.tan(Math.PI / 16);
    expect(b[1]).toBeCloseTo(xq, 9);
    expect(b[0]).toBeCloseTo(-xq, 9);
    s = stateAfter('head');
    b = bbox(s);
    expect(b[3]).toBeLessThanOrEqual(1 + 1e-9);
    expect(b[2]).toBeGreaterThan(0.3); // the legs are gone from below the body
    const reach = Math.max(...pts(s).filter((p) => Math.abs(p[0]) > 0.15).map((p) => p[1]));
    expect(reach).toBeGreaterThan(0.7); // neck and tail rise beside it
  });
});

describe('crane kinematics without thickness', () => {
  const seen = new Set();
  for (const st of steps) {
    for (const ph of st.phases) {
      if (seen.has(ph.id)) continue;
      seen.add(ph.id);
      it(`${st.id}: hinges stay closed through the motion and it ends on its flat state`, () => {
        let worst = 0;
        let worstFlat = 0;
        for (let n = 0; n <= 40; n++) {
          const G = ph.motion(n / 40);
          for (const [i, j, p, q] of adj) {
            for (const x of [p, q]) {
              const a = ap2(faces[i].hist[ph.start].M, x);
              const b = ap2(faces[j].hist[ph.start].M, x);
              const A = apT(G[faces[i].grp[ph.id]], [a[0], a[1], 0]);
              const B = apT(G[faces[j].grp[ph.id]], [b[0], b[1], 0]);
              worst = Math.max(worst, Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]));
              if (n === 40 && ph.flat) worstFlat = Math.max(worstFlat, Math.abs(A[2]), Math.abs(B[2]));
            }
          }
        }
        expect(worstFlat).toBeLessThan(1e-9);
        if (st.id === 'head') {
          // A designed approximation: the tip opens about its own spine while the neck below stays
          // closed, so the short head crease gapes mid-fold. Rigid faces, exact at both ends.
          expect(worst).toBeLessThan(0.05);
        } else {
          expect(worst).toBeLessThan(1e-9);
        }
      });
      it(`${st.id}: the motion starts from rest position (identity at tau = 0)`, () => {
        for (const G of ph.motion(0)) {
          const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
          G.R.forEach((v, k) => expect(Math.abs(v - I[k])).toBeLessThan(1e-12));
          G.t.forEach((v) => expect(Math.abs(v)).toBeLessThan(1e-12));
        }
      });
    }
  }

  it('petal fold: the side-flap angle rises monotonically from 0 to pi', () => {
    let prev = -1;
    for (let n = 0; n <= 100; n++) {
      const { rho } = petalAngles((Math.PI * n) / 100);
      expect(rho).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = rho;
    }
    expect(prev).toBeCloseTo(Math.PI, 9);
  });
});
