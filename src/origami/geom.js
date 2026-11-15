/**
 * Small 2D and 3D helpers shared by the flat-fold engine and the models built
 * on it. Pure functions on plain arrays; no dependencies.
 *
 * 2D affine map:      [a, b, c, d, tx, ty]   x' = a x + b y + tx,  y' = c x + d y + ty
 * 3D rigid transform: { R: [9 numbers, row-major], t: [3] }
 */

// ---- 2D -------------------------------------------------------------------

export const ID2 = Object.freeze([1, 0, 0, 1, 0, 0]);

export const ap2 = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[4], M[2] * p[0] + M[3] * p[1] + M[5]];

/** A after B. */
export const mul2 = (A, B) => [
  A[0] * B[0] + A[1] * B[2],
  A[0] * B[1] + A[1] * B[3],
  A[2] * B[0] + A[3] * B[2],
  A[2] * B[1] + A[3] * B[3],
  A[0] * B[4] + A[1] * B[5] + A[4],
  A[2] * B[4] + A[3] * B[5] + A[5],
];

export const det2 = (M) => M[0] * M[3] - M[1] * M[2];

/** Inverse of an isometry (rotation or reflection plus translation). */
export const inv2 = (M) => [
  M[0],
  M[2],
  M[1],
  M[3],
  -(M[0] * M[4] + M[2] * M[5]),
  -(M[1] * M[4] + M[3] * M[5]),
];

/** Signed distance of p from the directed line a -> b (positive on the left). */
export function side(a, b, p) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / Math.hypot(dx, dy);
}

export function centroid(poly) {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
  }
  return [x / poly.length, y / poly.length];
}

/** Signed area: positive when the polygon is counter-clockwise. */
export function area(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** Splits a convex polygon by the directed line a -> b: [left part or null, right part or null]. */
export function splitPoly(poly, a, b, eps = 1e-9) {
  const d = poly.map((p) => side(a, b, p));
  if (d.every((v) => v >= -eps)) return [poly, null];
  if (d.every((v) => v <= eps)) return [null, poly];
  const L = [];
  const R = [];
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const p = poly[i];
    const q = poly[j];
    const dp = d[i];
    const dq = d[j];
    if (dp >= -eps) L.push(p);
    if (dp <= eps) R.push(p);
    if ((dp > eps && dq < -eps) || (dp < -eps && dq > eps)) {
      const s = dp / (dp - dq);
      const x = [p[0] + s * (q[0] - p[0]), p[1] + s * (q[1] - p[1])];
      L.push(x);
      R.push(x);
    }
  }
  return [Math.abs(area(L)) > 1e-12 ? L : null, Math.abs(area(R)) > 1e-12 ? R : null];
}

/** Do two convex polygons overlap with positive area? (Separating axes, with a tolerance.) */
export function overlap(P, Q, tol = 1e-7) {
  for (const poly of [P, Q]) {
    const sgn = area(poly) >= 0 ? 1 : -1;
    const other = poly === P ? Q : P;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      let mx = -Infinity;
      for (const p of other) mx = Math.max(mx, sgn * side(a, b, p));
      if (mx <= tol) return false; // the other polygon lies entirely outside this edge
    }
  }
  return true;
}

/**
 * The part of the segment a -> b that lies inside a convex polygon, as a
 * parameter interval [t0, t1] within [0, 1], or null when there is none.
 */
export function clipSegment(poly, a, b) {
  const sgn = area(poly) >= 0 ? 1 : -1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    // Inward normal of the edge p -> q.
    const nx = -sgn * (q[1] - p[1]);
    const ny = sgn * (q[0] - p[0]);
    const s0 = nx * (a[0] - p[0]) + ny * (a[1] - p[1]);
    const ds = nx * dx + ny * dy;
    if (Math.abs(ds) < 1e-14) {
      if (s0 < 0) return null;
      continue;
    }
    const t = -s0 / ds;
    if (ds > 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t1 <= t0) return null;
  }
  return [t0, t1];
}

/** Is p strictly inside a convex polygon (further than `margin` from every edge)? */
export function insideConvex(poly, p, margin = 0) {
  const sgn = area(poly) >= 0 ? 1 : -1;
  for (let i = 0; i < poly.length; i++) {
    if (sgn * side(poly[i], poly[(i + 1) % poly.length], p) <= margin) return false;
  }
  return true;
}

// ---- 3D -------------------------------------------------------------------

/**
 * The identity transform. Treat as read-only. Deliberately not frozen: its
 * arrays are read in the per-face loop of pose(), and V8 reads frozen arrays
 * there about nine times slower.
 */
export const I3 = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };

export const mv = (R, v) => [
  R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
  R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
  R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
];

export function mm(A, B) {
  const C = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
  }
  return C;
}

export const apT = (G, p) => {
  const q = mv(G.R, p);
  return [q[0] + G.t[0], q[1] + G.t[1], q[2] + G.t[2]];
};

/** A after B. */
export const compose = (A, B) => ({ R: mm(A.R, B.R), t: apT(A, B.t) });

export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Rotation by `th` (right-hand rule) about the axis through point `a` along `u`. */
export function rotAxis(a, u, th) {
  const [x, y, z] = norm(u);
  const c = Math.cos(th);
  const s = Math.sin(th);
  const C = 1 - c;
  const R = [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
  const Ra = mv(R, a);
  return { R, t: [a[0] - Ra[0], a[1] - Ra[1], a[2] - Ra[2]] };
}

/** The rigid transform taking the triangle p0 p1 p2 onto the congruent triangle q0 q1 q2. */
export function frame3(p0, p1, p2, q0, q1, q2) {
  const fr = (a, b, c) => {
    const e1 = norm(sub(b, a));
    const e3 = norm(cross(e1, sub(c, a)));
    return [e1, cross(e3, e1), e3];
  };
  const P = fr(p0, p1, p2);
  const Q = fr(q0, q1, q2);
  const R = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) R[3 * i + j] = Q[0][i] * P[0][j] + Q[1][i] * P[1][j] + Q[2][i] * P[2][j];
  }
  return { R, t: sub(q0, mv(R, p0)) };
}

/** Mirrors a rigid transform in the plane x = 0 (S G S). An optional pivot basis B rides along. */
export function mirrorX(G) {
  const R = G.R;
  return {
    R: [R[0], -R[1], -R[2], -R[3], R[4], R[5], -R[6], R[7], R[8]],
    t: [-G.t[0], G.t[1], G.t[2]],
    B: G.B ? [-G.B[0], G.B[1], G.B[2]] : undefined,
  };
}
