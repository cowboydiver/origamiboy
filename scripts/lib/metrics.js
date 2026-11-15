/**
 * Contract-only validity metrics for an OrigamiModel (development and tests).
 *
 * Everything here is measured through the public contract alone: steps,
 * vertexCount, indices, uvs and pose(). Faces are the connected components of
 * the index buffer; hinges are face boundary edges that coincide on the
 * unfolded square.
 *
 * Per step, over N evenly spaced samples of t:
 * - strain        worst relative change of a triangle edge length
 * - rigid         worst change of a vertex-to-vertex distance inside a face
 * - hingeGap      worst distance between the two copies of a hinge end point
 * - excessGap     how far a hinge opens beyond its gap at the step's two ends
 * - ip*           proper triangle-triangle intersections between faces that
 *                 are not neighbours on the paper, with their length and depth
 *                 (ipSub: longer than 0.02 and deeper than 0.004; ipDeep:
 *                 longer than 0.05 and deeper than 0.02); ipNbr counts the
 *                 ones between paper neighbours (faces that share a crease or
 *                 a vertex on the paper), ipNbrL / ipNbrDepth their worst
 *                 length and depth
 * - zf*           near-coplanar overlapping pairs closer than 0.0008 (z-fighting)
 * - flips         parallel overlapping pairs that swap order between samples
 * - jump / fineJump / popJump / d2   largest vertex move between samples, at
 *                 dt = 1/fine, refined around the worst interval, and the
 *                 largest second difference: pops and kinks
 * At step boundaries the flat states get the layer-order checks: taco-tortilla
 * (TT), taco-taco (TC), a flat sheet through a fold (TT2), jogs across unfolded
 * creases, and the minimum separation of overlapping faces.
 */

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 * @param {Object} [options]
 * @param {number} [options.N]            samples per step
 * @param {number} [options.fine]         intervals per step for the smoothness scan
 * @param {number} [options.timingCalls]  pose() calls per step for the cost measurement (0 = skip)
 * @param {number} [options.whiteDirs]    view directions for the visible-white fraction
 * @param {import('../../src/origami/types.js').OrigamiModel} [options.model2]  a second instance, to check determinism against
 * @param {boolean} [options.selfTest]    also mutation-test the layer-order checker (slow)
 */
/**
 * The fraction of the model's silhouette that shows the white side of the
 * paper, by orthographic ray casting, averaged over the view directions.
 * @param {{ vertexCount: number, indices: ArrayLike<number> }} model
 * @param {ArrayLike<number>} p   positions, 3 * vertexCount
 * @param {number[][]} dirs       unit vectors from the model toward the viewer
 * @param {number} [res]          pixels along the longer side of the silhouette
 */
export function visibleWhiteFraction(model, p, dirs, res = 140) {
  const idx = model.indices;
  const T = idx.length / 3;
  const V = model.vertexCount;
  const used = new Uint8Array(V);
  for (let i = 0; i < idx.length; i++) used[idx[i]] = 1;
  let white = 0, tot = 0;
  for (const d of dirs) {
    let up = Math.abs(d[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];
    let r = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
    const rl = Math.hypot(...r); r = r.map((c) => c / rl);
    up = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
    const pr = new Float64Array(3 * V); const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (let v = 0; v < V; v++) {
      const x = p[3 * v], y = p[3 * v + 1], z = p[3 * v + 2];
      pr[3 * v] = x * r[0] + y * r[1] + z * r[2]; pr[3 * v + 1] = x * up[0] + y * up[1] + z * up[2]; pr[3 * v + 2] = x * d[0] + y * d[1] + z * d[2];
      if (!used[v]) continue;
      bb[0] = Math.min(bb[0], pr[3 * v]); bb[1] = Math.min(bb[1], pr[3 * v + 1]); bb[2] = Math.max(bb[2], pr[3 * v]); bb[3] = Math.max(bb[3], pr[3 * v + 1]);
    }
    const s = Math.max((bb[2] - bb[0]) / res, (bb[3] - bb[1]) / res); const nx = Math.max(1, Math.ceil((bb[2] - bb[0]) / s)), ny = Math.max(1, Math.ceil((bb[3] - bb[1]) / s));
    const depth = new Float64Array(nx * ny).fill(-Infinity), col = new Int8Array(nx * ny);
    for (let t = 0; t < T; t++) {
      const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
      const ax = pr[3 * a], ay = pr[3 * a + 1], bx = pr[3 * b], by = pr[3 * b + 1], cx = pr[3 * c], cy = pr[3 * c + 1];
      // Counter-clockwise on screen means the white side faces the viewer.
      const den = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay); if (Math.abs(den) < 1e-12) continue;
      const facing = den > 0 ? 1 : 2; // 1 white visible, 2 coloured
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - bb[0]) / s)), i1 = Math.min(nx - 1, Math.floor((Math.max(ax, bx, cx) - bb[0]) / s));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - bb[1]) / s)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - bb[1]) / s));
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const x = bb[0] + (i + 0.5) * s, y = bb[1] + (j + 0.5) * s;
        const w1 = ((x - ax) * (cy - ay) - (cx - ax) * (y - ay)) / den, w2 = ((bx - ax) * (y - ay) - (x - ax) * (by - ay)) / den; if (w1 < 0 || w2 < 0 || w1 + w2 > 1) continue;
        const z = pr[3 * a + 2] + w1 * (pr[3 * b + 2] - pr[3 * a + 2]) + w2 * (pr[3 * c + 2] - pr[3 * a + 2]);
        if (z > depth[i * ny + j]) { depth[i * ny + j] = z; col[i * ny + j] = facing; }
      }
    }
    for (let i = 0; i < nx * ny; i++) if (col[i]) { tot++; if (col[i] === 1) white++; }
  }
  return white / tot;
}

/** Direction from the model to the app's default camera: 20 degrees to the right, 12 degrees above. */
export const HOME_VIEW = [Math.sin((20 * Math.PI) / 180) * Math.cos((12 * Math.PI) / 180), Math.sin((12 * Math.PI) / 180), Math.cos((20 * Math.PI) / 180) * Math.cos((12 * Math.PI) / 180)];

export function analyseModel(model, { N = 81, fine = 4000, timingCalls = 2000, whiteDirs = 120, model2 = null, selfTest = true } = {}) {
  const V = model.vertexCount, idx = model.indices, uv = model.uvs, T = idx.length / 3, K = model.steps.length;
  const out = { name: model.name, N, V, T, K, problems: [] };
  const prob = (s) => { out.problems.push(s); };

  // ---------- static structure ----------
  if (uv.length !== 2 * V) prob('uvs length mismatch');
  let uvMin = Infinity, uvMax = -Infinity; for (const x of uv) { uvMin = Math.min(uvMin, x); uvMax = Math.max(uvMax, x); }
  out.uvRange = [uvMin, uvMax];
  // faces = connected components over shared vertex indices
  const par = Array.from({ length: V }, (_, i) => i);
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  for (let t = 0; t < T; t++) { const a = find(idx[3 * t]); par[find(idx[3 * t + 1])] = a; par[find(idx[3 * t + 2])] = a; }
  const faceOfRoot = new Map(); const vFace = new Int32Array(V).fill(-1);
  const used = new Uint8Array(V); for (const i of idx) used[i] = 1;
  for (let v = 0; v < V; v++) { if (!used[v]) continue; const r = find(v); if (!faceOfRoot.has(r)) faceOfRoot.set(r, faceOfRoot.size); vFace[v] = faceOfRoot.get(r); }
  const F = faceOfRoot.size; out.F = F; out.unusedVerts = V - used.reduce((a, b) => a + b, 0);
  const triFace = new Int32Array(T); for (let t = 0; t < T; t++) triFace[t] = vFace[idx[3 * t]];
  const faceVerts = Array.from({ length: F }, () => []); for (let v = 0; v < V; v++) if (vFace[v] >= 0) faceVerts[vFace[v]].push(v);
  // uv areas, winding
  let uvArea = 0, uvPos = 0, uvNeg = 0;
  const triUvArea = new Float64Array(T);
  for (let t = 0; t < T; t++) {
    const a = idx[3 * t], b = idx[3 * t + 1], c = idx[3 * t + 2];
    const s = 0.5 * ((uv[2 * b] - uv[2 * a]) * (uv[2 * c + 1] - uv[2 * a + 1]) - (uv[2 * c] - uv[2 * a]) * (uv[2 * b + 1] - uv[2 * a + 1]));
    triUvArea[t] = s; uvArea += Math.abs(s); if (s > 0) uvPos++; else uvNeg++;
  }
  out.uvAreaSum = uvArea; out.uvWinding = { pos: uvPos, neg: uvNeg };
  // face boundary edges (in exactly one triangle of the face)
  const edgeCount = new Map();
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) { const a = idx[3 * t + e], b = idx[3 * t + (e + 1) % 3]; const k = a < b ? a * V + b : b * V + a; edgeCount.set(k, (edgeCount.get(k) || 0) + 1); }
  const bEdges = []; // {a,b,f}
  for (const [k, c] of edgeCount) if (c === 1) { const a = Math.floor(k / V), b = k % V; bEdges.push({ a, b, f: vFace[a] }); }
  // hinges: collinear overlapping boundary edges of different faces
  const hinges = []; // {fa,fb, a0,a1,b0,b1, sA:[p,q], sB:[p,q], len}
  const adjE = Array.from({ length: F }, () => new Uint8Array(F)), adjV = Array.from({ length: F }, () => new Uint8Array(F));
  for (let i = 0; i < bEdges.length; i++) for (let j = i + 1; j < bEdges.length; j++) {
    const A = bEdges[i], B = bEdges[j]; if (A.f === B.f) continue;
    const ax = uv[2 * A.a], ay = uv[2 * A.a + 1], dx = uv[2 * A.b] - ax, dy = uv[2 * A.b + 1] - ay, L = Math.hypot(dx, dy);
    const ux = dx / L, uy = dy / L;
    const c0 = (uv[2 * B.a] - ax) * uy - (uv[2 * B.a + 1] - ay) * ux, c1 = (uv[2 * B.b] - ax) * uy - (uv[2 * B.b + 1] - ay) * ux;
    if (Math.abs(c0) > 1e-7 || Math.abs(c1) > 1e-7) continue;
    const p0 = ((uv[2 * B.a] - ax) * ux + (uv[2 * B.a + 1] - ay) * uy), p1 = ((uv[2 * B.b] - ax) * ux + (uv[2 * B.b + 1] - ay) * uy);
    const lo = Math.max(0, Math.min(p0, p1)), hi = Math.min(L, Math.max(p0, p1));
    if (hi - lo < 1e-6) continue;
    hinges.push({ fa: A.f, fb: B.f, a0: A.a, a1: A.b, b0: B.a, b1: B.b, sA: [lo / L, hi / L], sB: [(lo - p0) / (p1 - p0), (hi - p0) / (p1 - p0)], len: hi - lo });
    adjE[A.f][B.f] = adjE[B.f][A.f] = 1;
  }
  out.hingeCount = hinges.length;
  for (let a = 0; a < V; a++) for (let b = a + 1; b < V; b++) { if (vFace[a] < 0 || vFace[b] < 0 || vFace[a] === vFace[b]) continue; if (Math.abs(uv[2 * a] - uv[2 * b]) < 1e-7 && Math.abs(uv[2 * a + 1] - uv[2 * b + 1]) < 1e-7) adjV[vFace[a]][vFace[b]] = adjV[vFace[b]][vFace[a]] = 1; }
  for (let a = 0; a < F; a++) for (let b = 0; b < F; b++) if (adjE[a][b]) adjV[a][b] = 1;
  // coincident-uv vertex pairs
  const coinc = [];
  for (let a = 0; a < V; a++) for (let b = a + 1; b < V; b++) { if (vFace[a] < 0 || vFace[b] < 0 || vFace[a] === vFace[b]) continue; if (Math.abs(uv[2 * a] - uv[2 * b]) < 1e-7 && Math.abs(uv[2 * a + 1] - uv[2 * b + 1]) < 1e-7) coinc.push([a, b]); }
  out.coincPairs = coinc.length;
  // triangle uv edge lengths
  const triEdgeUv = new Float64Array(3 * T);
  for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) { const a = idx[3 * t + e], b = idx[3 * t + (e + 1) % 3]; triEdgeUv[3 * t + e] = Math.hypot(uv[2 * a] - uv[2 * b], uv[2 * a + 1] - uv[2 * b + 1]); }
  // face convex hull order in uv
  function hullOrder(vs) {
    const pts = vs.map(v => [uv[2 * v], uv[2 * v + 1], v]);
    let cx = 0, cy = 0; for (const p of pts) { cx += p[0]; cy += p[1]; } cx /= pts.length; cy /= pts.length;
    pts.sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
    return pts.map(p => p[2]);
  }
  const faceLoop = faceVerts.map(hullOrder);

  // ---------- helpers ----------
  const P = new Float32Array(3 * V), Q = new Float32Array(3 * V);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const vtx = (p, i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
  function triData(p) { // normals, plane d, aabb
    const n = new Float64Array(3 * T), bb = new Float64Array(6 * T);
    for (let t = 0; t < T; t++) {
      const a = vtx(p, idx[3 * t]), b = vtx(p, idx[3 * t + 1]), c = vtx(p, idx[3 * t + 2]);
      const m = cross(sub(b, a), sub(c, a)); const l = Math.hypot(m[0], m[1], m[2]) || 1;
      n[3 * t] = m[0] / l; n[3 * t + 1] = m[1] / l; n[3 * t + 2] = m[2] / l;
      for (let k = 0; k < 3; k++) { bb[6 * t + k] = Math.min(a[k], b[k], c[k]); bb[6 * t + 3 + k] = Math.max(a[k], b[k], c[k]); }
    }
    return { n, bb };
  }
  function clipInterval(tv, d, D) { // segment of triangle on plane d=0 -> [min,max] param along D
    let lo = Infinity, hi = -Infinity;
    for (let e = 0; e < 3; e++) {
      const i = e, j = (e + 1) % 3; const di = d[i], dj = d[j];
      if ((di > 0 && dj > 0) || (di < 0 && dj < 0)) continue; if (di === dj) continue;
      const s = di / (di - dj); const pt = [tv[i][0] + (tv[j][0] - tv[i][0]) * s, tv[i][1] + (tv[j][1] - tv[i][1]) * s, tv[i][2] + (tv[j][2] - tv[i][2]) * s];
      const q = dot(D, pt); if (q < lo) lo = q; if (q > hi) hi = q;
    }
    return [lo, hi];
  }
  function triTri(p, td, t1, t2) { // proper transversal intersection -> {L, depth} | null
    const A = [vtx(p, idx[3 * t1]), vtx(p, idx[3 * t1 + 1]), vtx(p, idx[3 * t1 + 2])], B = [vtx(p, idx[3 * t2]), vtx(p, idx[3 * t2 + 1]), vtx(p, idx[3 * t2 + 2])];
    const nA = [td.n[3 * t1], td.n[3 * t1 + 1], td.n[3 * t1 + 2]], nB = [td.n[3 * t2], td.n[3 * t2 + 1], td.n[3 * t2 + 2]];
    const eps = 1e-6;
    const dB = B.map(b => dot(nA, sub(b, A[0]))); const mxB = Math.max(...dB), mnB = Math.min(...dB); if (!(mxB > eps && mnB < -eps)) return null;
    const dA = A.map(a => dot(nB, sub(a, B[0]))); const mxA = Math.max(...dA), mnA = Math.min(...dA); if (!(mxA > eps && mnA < -eps)) return null;
    const D = cross(nA, nB); const dl = Math.hypot(D[0], D[1], D[2]); if (dl < 1e-9) return null;
    const Dn = [D[0] / dl, D[1] / dl, D[2] / dl];
    const iA = clipInterval(A, dA, Dn), iB = clipInterval(B, dB, Dn);
    const L = Math.min(iA[1], iB[1]) - Math.max(iA[0], iB[0]); if (!(L > 0)) return null;
    return { L, depth: Math.min(mxA, -mnA, mxB, -mnB), sin: dl };
  }
  function polyClip(subj, clip) { // convex clip (CCW), 2D
    let outp = subj;
    for (let i = 0; i < clip.length && outp.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length]; const inp = outp; outp = [];
      const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length]; const sp = side(p), sq = side(q);
        if (sp >= 0) outp.push(p);
        if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) { const s = sp / (sp - sq); outp.push([p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s]); }
      }
    }
    return outp;
  }
  const polyArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - a[1] * b[0]; } return s / 2; };
  const ccw = (p) => polyArea(p) < 0 ? p.slice().reverse() : p;

  // per-sample metrics
  function sample(p, isBoundary) {
    const r = {};
    // strain per triangle edge (relative), face rigidity (abs pairwise distance error)
    let strain = 0;
    for (let t = 0; t < T; t++) for (let e = 0; e < 3; e++) {
      const a = idx[3 * t + e], b = idx[3 * t + (e + 1) % 3];
      const l = Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
      const s = Math.abs(l - triEdgeUv[3 * t + e]) / triEdgeUv[3 * t + e]; if (s > strain) strain = s;
    }
    r.strain = strain;
    let rigid = 0;
    for (const vs of faceVerts) for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j];
      const l = Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
      const e = Math.abs(l - Math.hypot(uv[2 * a] - uv[2 * b], uv[2 * a + 1] - uv[2 * b + 1])); if (e > rigid) rigid = e;
    }
    r.rigid = rigid;
    // hinge gaps (shared uv edges, both overlap endpoints) and coincident-uv vertex gaps
    let gap = 0, gapXY = 0, gapZ = 0;
    for (const h of hinges) for (let e = 0; e < 2; e++) {
      const sa = h.sA[e], sb = h.sB[e];
      const dx = p[3 * h.a0] + (p[3 * h.a1] - p[3 * h.a0]) * sa - (p[3 * h.b0] + (p[3 * h.b1] - p[3 * h.b0]) * sb);
      const dy = p[3 * h.a0 + 1] + (p[3 * h.a1 + 1] - p[3 * h.a0 + 1]) * sa - (p[3 * h.b0 + 1] + (p[3 * h.b1 + 1] - p[3 * h.b0 + 1]) * sb);
      const dz = p[3 * h.a0 + 2] + (p[3 * h.a1 + 2] - p[3 * h.a0 + 2]) * sa - (p[3 * h.b0 + 2] + (p[3 * h.b1 + 2] - p[3 * h.b0 + 2]) * sb);
      const g = Math.hypot(dx, dy, dz); if (g > gap) gap = g; const gx = Math.hypot(dx, dy); if (gx > gapXY) gapXY = gx; if (Math.abs(dz) > gapZ) gapZ = Math.abs(dz);
    }
    r.hingeGap = gap; r.hingeGapXY = gapXY; r.hingeGapZ = gapZ;
    let cg = 0; for (const [a, b] of coinc) { const g = Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]); if (g > cg) cg = g; }
    r.coincGap = cg;
    // interpenetration + z-fight
    const td = triData(p);
    const ipList = []; let ipAny = 0, ipSub = 0, ipDeep = 0, ipNbr = 0, ipNbrL = 0, ipNbrDepth = 0, ipMaxL = 0, ipMaxDepth = 0, ipSumL = 0; const ipFacePairs = new Set();
    let zf = 0, zfOpp = 0, zfArea = 0, zfMin = Infinity; const parMap = new Map();
    for (let a = 0; a < T; a++) for (let b = a + 1; b < T; b++) {
      const fa = triFace[a], fb = triFace[b]; if (fa === fb) continue;
      const A = td.bb, m = 0.07;
      if (A[6 * a] > A[6 * b + 3] + m || A[6 * b] > A[6 * a + 3] + m || A[6 * a + 1] > A[6 * b + 4] + m || A[6 * b + 1] > A[6 * a + 4] + m || A[6 * a + 2] > A[6 * b + 5] + m || A[6 * b + 2] > A[6 * a + 5] + m) continue;
      const x = triTri(p, td, a, b);
      if (x && x.L > 1e-4 && x.depth > 1e-5) {
        if (adjV[fa][fb]) { ipNbr++; if (x.L > ipNbrL) ipNbrL = x.L; if (x.depth > ipNbrDepth) ipNbrDepth = x.depth; }
        else { ipList.push([fa, fb, x.L, x.depth]);
          ipAny++; ipSumL += x.L; ipFacePairs.add(fa * F + fb); if (x.L > ipMaxL) ipMaxL = x.L; if (x.depth > ipMaxDepth) ipMaxDepth = x.depth;
          if (x.L > 0.02 && x.depth > 0.004) ipSub++; if (x.L > 0.05 && x.depth > 0.02) ipDeep++;
        }
      }
      // near-coplanar overlap
      const nd = td.n[3 * a] * td.n[3 * b] + td.n[3 * a + 1] * td.n[3 * b + 1] + td.n[3 * a + 2] * td.n[3 * b + 2];
      if (Math.abs(nd) > 0.999) { // parallel-layer order tracking
        const nA = [td.n[3 * a], td.n[3 * a + 1], td.n[3 * a + 2]]; const a0 = vtx(p, idx[3 * a]);
        const Bv = [vtx(p, idx[3 * b]), vtx(p, idx[3 * b + 1]), vtx(p, idx[3 * b + 2])]; const Av = [a0, vtx(p, idx[3 * a + 1]), vtx(p, idx[3 * a + 2])];
        const dc = (dot(nA, sub(Bv[0], a0)) + dot(nA, sub(Bv[1], a0)) + dot(nA, sub(Bv[2], a0))) / 3;
        if (Math.abs(dc) < 0.07) { let u = sub(Av[1], Av[0]); const ul = Math.hypot(...u); u = u.map(c => c / ul); const w = cross(nA, u);
          const pa = ccw(Av.map(q => [dot(sub(q, a0), u), dot(sub(q, a0), w)])), pb = ccw(Bv.map(q => [dot(sub(q, a0), u), dot(sub(q, a0), w)]));
          if (Math.abs(polyArea(polyClip(pa, pb))) > 1e-4) parMap.set(a * T + b, dc); }
      }
      if (Math.abs(nd) > 0.99996) {
        const nA = [td.n[3 * a], td.n[3 * a + 1], td.n[3 * a + 2]]; const a0 = vtx(p, idx[3 * a]);
        const Bv = [vtx(p, idx[3 * b]), vtx(p, idx[3 * b + 1]), vtx(p, idx[3 * b + 2])]; const Av = [a0, vtx(p, idx[3 * a + 1]), vtx(p, idx[3 * a + 2])];
        const ds = Bv.map(q => Math.abs(dot(nA, sub(q, a0)))); const dmax = Math.max(...ds);
        if (dmax < 0.0008) {
          // project to plane A basis
          let u = sub(Av[1], Av[0]); const ul = Math.hypot(...u); u = u.map(c => c / ul); const w = cross(nA, u);
          const pa = ccw(Av.map(q => [dot(sub(q, a0), u), dot(sub(q, a0), w)])), pb = ccw(Bv.map(q => [dot(sub(q, a0), u), dot(sub(q, a0), w)]));
          const ar = Math.abs(polyArea(polyClip(pa, pb)));
          if (ar > 1e-5) { zf++; zfArea += ar; if (nd < 0) zfOpp++; if (dmax < zfMin) zfMin = dmax; }
        }
      }
    }
    Object.assign(r, { ipAny, ipSub, ipDeep, ipNbr, ipNbrL, ipNbrDepth, ipMaxL, ipMaxDepth, ipSumL, ipFacePairs: ipFacePairs.size, zf, zfOpp, zfArea, zfMin });
    // flatness: triangle normals parallel to z
    let nonflat = 0; for (let t = 0; t < T; t++) { const e = 1 - Math.abs(td.n[3 * t + 2]); if (e > nonflat) nonflat = e; }
    r.nonflat = nonflat;
    // bbox
    const bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let v = 0; v < V; v++) { if (!used[v]) continue; for (let k = 0; k < 3; k++) { const c = p[3 * v + k]; if (c < bb[k]) bb[k] = c; if (c > bb[3 + k]) bb[3 + k] = c; } }
    r.bb = bb; r.ctrOff = Math.hypot((bb[0] + bb[3]) / 2, (bb[1] + bb[4]) / 2); r.ctrZ = Math.abs(bb[2] + bb[5]) / 2;
    let nan = 0; for (let i = 0; i < 3 * V; i++) if (!Number.isFinite(p[i])) nan++; r.nan = nan;
    r.td = td; r.parMap = parMap; r.ipList = ipList;
    return r;
  }

  // flat-state layer checks (taco-tortilla, taco-taco, jogs, min separation)
  function flatChecks(p, td) {
    const fz = new Float64Array(F), fo = new Int8Array(F), poly = []; let faceZRange = 0;
    for (let f = 0; f < F; f++) {
      let mn = Infinity, mx = -Infinity, s = 0; for (const v of faceVerts[f]) { const z = p[3 * v + 2]; mn = Math.min(mn, z); mx = Math.max(mx, z); s += z; }
      fz[f] = s / faceVerts[f].length; faceZRange = Math.max(faceZRange, mx - mn);
      poly.push(ccw(faceLoop[f].map(v => [p[3 * v], p[3 * v + 1]])));
    }
    for (let t = 0; t < T; t++) fo[triFace[t]] = td.n[3 * t + 2] > 0 ? 1 : -1;
    const cen = poly.map(pl => { let x = 0, y = 0; for (const q of pl) { x += q[0]; y += q[1]; } return [x / pl.length, y / pl.length]; });
    // min separation among overlapping faces
    let minSep = Infinity, close8 = 0, close15 = 0, maxLayers = 0; const ovl = Array.from({ length: F }, () => new Uint8Array(F));
    for (let a = 0; a < F; a++) for (let b = a + 1; b < F; b++) {
      const ar = Math.abs(polyArea(polyClip(poly[a], poly[b]))); if (ar > 1e-5) { ovl[a][b] = ovl[b][a] = 1; const s = Math.abs(fz[a] - fz[b]); if (s < minSep) minSep = s; if (s < 0.0008) close8++; if (s < 0.00149) close15++; }
    }
    const levels = new Set(Array.from(fz).map(z => Math.round(z * 1e5))).size;
    // hinge geometry in xy
    const H = hinges.map(h => {
      const pt = (s) => [p[3 * h.a0] + (p[3 * h.a1] - p[3 * h.a0]) * s, p[3 * h.a0 + 1] + (p[3 * h.a1 + 1] - p[3 * h.a0 + 1]) * s];
      return { fa: h.fa, fb: h.fb, P: pt(h.sA[0]), Q: pt(h.sA[1]), folded: fo[h.fa] !== fo[h.fb] };
    });
    const sideOf = (h, f) => { const d = [h.Q[0] - h.P[0], h.Q[1] - h.P[1]]; return Math.sign(d[0] * (cen[f][1] - h.P[1]) - d[1] * (cen[f][0] - h.P[0])); };
    const insideMargin = (pl, q) => { let m = Infinity; for (let i = 0; i < pl.length; i++) { const a = pl[i], b = pl[(i + 1) % pl.length]; const l = Math.hypot(b[0] - a[0], b[1] - a[1]); const s = ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])) / l; if (s < m) m = s; } return m; };
    function segInPoly(h, pl) { // length of hinge segment strictly inside polygon interior
      let t0 = 0, t1 = 1; const d = [h.Q[0] - h.P[0], h.Q[1] - h.P[1]];
      for (let i = 0; i < pl.length; i++) {
        const a = pl[i], b = pl[(i + 1) % pl.length]; const nx = -(b[1] - a[1]), ny = (b[0] - a[0]); // inward normal for CCW
        const s0 = nx * (h.P[0] - a[0]) + ny * (h.P[1] - a[1]), ds = nx * d[0] + ny * d[1];
        if (Math.abs(ds) < 1e-12) { if (s0 < 0) return 0; continue; }
        const tt = -s0 / ds; if (ds > 0) t0 = Math.max(t0, tt); else t1 = Math.min(t1, tt);
      }
      if (t1 - t0 <= 0) return 0; const tm = (t0 + t1) / 2; const mid = [h.P[0] + d[0] * tm, h.P[1] + d[1] * tm];
      if (insideMargin(pl, mid) < 1e-5) return 0; return (t1 - t0) * Math.hypot(d[0], d[1]);
    }
    const e = 1e-6; let tacoTortilla = 0, tacoTaco = 0, tortThroughTaco = 0, jogs = 0, jogCross = 0, maxJog = 0, foldedXYmismatch = 0; const examples = [];
    for (const h of H) {
      const lo = Math.min(fz[h.fa], fz[h.fb]), hi = Math.max(fz[h.fa], fz[h.fb]);
      if (!h.folded) { const j = hi - lo; if (j > e) { jogs++; if (j > maxJog) maxJog = j; } }
      if (hi - lo < e) continue;
      for (let c = 0; c < F; c++) { if (c === h.fa || c === h.fb) continue; if (fz[c] > lo + e && fz[c] < hi - e) { const l = segInPoly(h, poly[c]); if (l > 1e-4) { if (h.folded) { tacoTortilla++; if (examples.length < 4) examples.push(`TT hinge ${h.fa}-${h.fb} face ${c} len ${l.toFixed(3)}`); } else jogCross++; } } }
    }
    for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) {
      const a = H[i], b = H[j]; if (!a.folded && !b.folded) continue;
      // collinear overlap in xy
      const d = [a.Q[0] - a.P[0], a.Q[1] - a.P[1]], L = Math.hypot(d[0], d[1]); if (L < 1e-9) continue; const u = [d[0] / L, d[1] / L];
      const c0 = (b.P[0] - a.P[0]) * u[1] - (b.P[1] - a.P[1]) * u[0], c1 = (b.Q[0] - a.P[0]) * u[1] - (b.Q[1] - a.P[1]) * u[0]; if (Math.abs(c0) > 1e-6 || Math.abs(c1) > 1e-6) continue;
      const p0 = (b.P[0] - a.P[0]) * u[0] + (b.P[1] - a.P[1]) * u[1], p1 = (b.Q[0] - a.P[0]) * u[0] + (b.Q[1] - a.P[1]) * u[1];
      if (Math.min(L, Math.max(p0, p1)) - Math.max(0, Math.min(p0, p1)) < 1e-4) continue;
      const set = new Set([a.fa, a.fb, b.fa, b.fb]); if (set.size < 4) continue;
      if (a.folded && b.folded) {
        if (sideOf(a, a.fa) !== sideOf(a, b.fa)) continue;
        const a0 = Math.min(fz[a.fa], fz[a.fb]), a1 = Math.max(fz[a.fa], fz[a.fb]), b0 = Math.min(fz[b.fa], fz[b.fb]), b1 = Math.max(fz[b.fa], fz[b.fb]);
        if ((a0 < b0 - e && b0 < a1 - e && a1 < b1 - e) || (b0 < a0 - e && a0 < b1 - e && b1 < a1 - e)) { tacoTaco++; if (examples.length < 4) examples.push(`TC hinges ${a.fa}-${a.fb} x ${b.fa}-${b.fb}`); }
      } else {
        const fold = a.folded ? a : b, flat = a.folded ? b : a; const sd = sideOf(fold, fold.fa);
        const lo = Math.min(fz[fold.fa], fz[fold.fb]), hi = Math.max(fz[fold.fa], fz[fold.fb]);
        for (const c of [flat.fa, flat.fb]) if (sideOf(fold, c) === sd && fz[c] > lo + e && fz[c] < hi - e) { tortThroughTaco++; if (examples.length < 4) examples.push(`TT2 fold ${fold.fa}-${fold.fb} flat ${flat.fa}-${flat.fb}`); break; }
      }
    }
    // max layers at a point: sample grid
    let bb = [Infinity, Infinity, -Infinity, -Infinity]; for (const pl of poly) for (const q of pl) { bb[0] = Math.min(bb[0], q[0]); bb[1] = Math.min(bb[1], q[1]); bb[2] = Math.max(bb[2], q[0]); bb[3] = Math.max(bb[3], q[1]); }
    for (let i = 0; i < 60; i++) for (let j = 0; j < 60; j++) { const q = [bb[0] + (bb[2] - bb[0]) * (i + 0.37) / 60, bb[1] + (bb[3] - bb[1]) * (j + 0.41) / 60]; let c = 0; for (const pl of poly) if (insideMargin(pl, q) > 0) c++; if (c > maxLayers) maxLayers = c; }
    let zmin = Infinity, zmax = -Infinity; for (const z of fz) { zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
    return { faceZRange, minSep, close8, close15, levels, maxLayers, thickness: zmax - zmin, tacoTortilla, tacoTaco, tortThroughTaco, jogs, maxJog, jogCross, examples, w: bb[2] - bb[0], h: bb[3] - bb[1] };
  }

  const whiteFraction = (p, dirs, res) => visibleWhiteFraction(model, p, dirs, res);
  const fib = (n) => Array.from({ length: n }, (_, i) => { const y = 1 - 2 * (i + 0.5) / n, r = Math.sqrt(1 - y * y), a = i * 2.399963229728653; return [r * Math.cos(a), y, r * Math.sin(a)]; });

  // ---------- run ----------
  const steps = []; let contMax = 0; const shapeFrom = model.steps.findIndex(s => s.kind === 'shape');
  let prevEnd = null;
  for (let k = 0; k < K; k++) {
    const st = model.steps[k]; const row = { k, id: st.id, kind: st.kind };
    const agg = { strain: 0, rigid: 0, hingeGap: 0, coincGap: 0, ipAnyMax: 0, ipAnySamples: 0, ipSubMax: 0, ipDeepMax: 0, ipNbrMax: 0, ipNbrL: 0, ipNbrDepth: 0, ipMaxL: 0, ipMaxDepth: 0, ipSumLMax: 0, ipFacePairsMax: 0, zfMax: 0, zfOppMax: 0, zfSamples: 0, zfOppSamples: 0, ctrOff: 0, jump: 0, nan: 0, ipWorstT: -1, zfWorstT: -1, gapWorstT: -1, excessGap: 0, excessGapT: -1, flips: 0, flipSamples: 0, d2: 0 };
    const hg = (p) => { const g = new Float64Array(2 * hinges.length); hinges.forEach((h, q) => { for (let e = 0; e < 2; e++) { const sa = h.sA[e], sb = h.sB[e]; let d2 = 0; for (let c = 0; c < 3; c++) { const d = p[3 * h.a0 + c] + (p[3 * h.a1 + c] - p[3 * h.a0 + c]) * sa - (p[3 * h.b0 + c] + (p[3 * h.b1 + c] - p[3 * h.b0 + c]) * sb); d2 += d * d; } g[2 * q + e] = Math.sqrt(d2); } }); return g; };
    model.pose(k, 0, P); const g0 = hg(P); model.pose(k, 1, P); const g1 = hg(P); let prevPar = null;
    let prev = null;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1); model.pose(k, t, P); const r = sample(P, i === 0 || i === N - 1);
      const inb = i > 0 && i < N - 1;
      { const g = hg(P); for (let q = 0; q < g.length; q++) { const ex = g[q] - Math.max(g0[q], g1[q]); if (ex > agg.excessGap) { agg.excessGap = ex; agg.excessGapT = t; } } }
      if (prevPar) { let fl = 0; for (const [kk, d] of r.parMap) { const d0 = prevPar.get(kk); if (d0 !== undefined && Math.abs(d) > 2e-5 && Math.abs(d0) > 2e-5 && d * d0 < 0) fl++; } agg.flips += fl; if (fl) agg.flipSamples++; } prevPar = r.parMap;
      agg.strain = Math.max(agg.strain, r.strain); agg.rigid = Math.max(agg.rigid, r.rigid); agg.ctrOff = Math.max(agg.ctrOff, r.ctrOff); agg.nan += r.nan;
      if (r.hingeGap > agg.hingeGap) { agg.hingeGap = r.hingeGap; agg.gapWorstT = t; } agg.coincGap = Math.max(agg.coincGap, r.coincGap);
      if (inb) {
        if (r.ipAny > agg.ipAnyMax) { agg.ipAnyMax = r.ipAny; agg.ipWorstT = t; } if (r.ipAny) agg.ipAnySamples++;
        agg.ipSubMax = Math.max(agg.ipSubMax, r.ipSub); agg.ipDeepMax = Math.max(agg.ipDeepMax, r.ipDeep); agg.ipNbrMax = Math.max(agg.ipNbrMax, r.ipNbr); agg.ipNbrL = Math.max(agg.ipNbrL, r.ipNbrL); agg.ipNbrDepth = Math.max(agg.ipNbrDepth, r.ipNbrDepth);
        agg.ipMaxL = Math.max(agg.ipMaxL, r.ipMaxL); agg.ipMaxDepth = Math.max(agg.ipMaxDepth, r.ipMaxDepth); agg.ipSumLMax = Math.max(agg.ipSumLMax, r.ipSumL); agg.ipFacePairsMax = Math.max(agg.ipFacePairsMax, r.ipFacePairs);
        if (r.zf > agg.zfMax) { agg.zfMax = r.zf; agg.zfWorstT = t; } agg.zfOppMax = Math.max(agg.zfOppMax, r.zfOpp); if (r.zf) agg.zfSamples++; if (r.zfOpp) agg.zfOppSamples++;
      }
      if (inb && r.nonflat < 1e-9) { const fc = flatChecks(P, r.td); (row.midFlat ||= []).push({ t, levels: fc.levels, maxLayers: fc.maxLayers, minSep: fc.minSep, close8: fc.close8, TT: fc.tacoTortilla, TC: fc.tacoTaco, TT2: fc.tortThroughTaco, jogs: fc.jogs, maxJog: fc.maxJog, jogX: fc.jogCross, w: fc.w, h: fc.h, ex: fc.examples }); }
      if (prev) { let j = 0; for (let v = 0; v < V; v++) { const d = Math.hypot(P[3 * v] - prev[3 * v], P[3 * v + 1] - prev[3 * v + 1], P[3 * v + 2] - prev[3 * v + 2]); if (d > j) j = d; } agg.jump = Math.max(agg.jump, j); }
      prev = Float32Array.from(P);
      if (i === 0 || i === N - 1) {
        const b = { ipAny: r.ipAny, ipNbr: r.ipNbr, zf: r.zf, zfOpp: r.zfOpp, nonflat: r.nonflat, strain: r.strain, rigid: r.rigid, hingeGap: r.hingeGap, hingeGapXY: r.hingeGapXY, hingeGapZ: r.hingeGapZ, bb: r.bb };
        const isFlatExpected = (i === 0) ? (shapeFrom < 0 || k <= shapeFrom) : (shapeFrom < 0 || k < shapeFrom);
        b.flatExpected = isFlatExpected;
        if (r.nonflat < 1e-6) b.flat = flatChecks(P, r.td);
        if (i === 0) row.start = b; else row.end = b;
      }
      if (i === 0 && prevEnd) { let c = 0; for (let q = 0; q < 3 * V; q++) c = Math.max(c, Math.abs(P[q] - prevEnd[q])); row.contFromPrev = c; contMax = Math.max(contMax, c); }
      if (i === N - 1) prevEnd = Float32Array.from(P);
    }
    // fine smoothness: dt = 1/4000, then refine worst interval
    { const M = fine; let worst = 0, wi = 0; model.pose(k, 0, Q); let pv = Float32Array.from(Q), pv2 = null, d2m = 0;
      for (let i = 1; i <= M; i++) { model.pose(k, i / M, Q); let j = 0; for (let v = 0; v < 3 * V; v += 3) { const d = Math.hypot(Q[v] - pv[v], Q[v + 1] - pv[v + 1], Q[v + 2] - pv[v + 2]); if (d > j) j = d; } if (j > worst) { worst = j; wi = i; } if (pv2) for (let v = 0; v < 3 * V; v++) { const dd = Math.abs(Q[v] - 2 * pv[v] + pv2[v]); if (dd > d2m) d2m = dd; } if (!pv2) pv2 = new Float32Array(3 * V); pv2.set(pv); pv.set(Q); }
      agg.d2 = d2m;
      agg.fineJump = worst; agg.fineJumpT = wi / M; agg.maxSpeed = worst * M;
      // refine: jump across a 1e-7-wide window around the worst sub-interval
      let lo = (wi - 1) / M, hi = wi / M; const A = new Float32Array(3 * V), B = new Float32Array(3 * V);
      for (let it = 0; it < 4; it++) { let bj = -1, bi = 0; for (let s = 0; s < 10; s++) { model.pose(k, lo + (hi - lo) * s / 10, A); model.pose(k, lo + (hi - lo) * (s + 1) / 10, B); let j = 0; for (let v = 0; v < 3 * V; v += 3) { const d = Math.hypot(A[v] - B[v], A[v + 1] - B[v + 1], A[v + 2] - B[v + 2]); if (d > j) j = d; } if (j > bj) { bj = j; bi = s; } } const w = (hi - lo) / 10; lo = lo + w * bi; hi = lo + w; agg.popJump = bj; agg.popT = (lo + hi) / 2; }
    }
    // turn-over rigid check
    if (st.kind === 'turn-over') { model.pose(k, 0, P); model.pose(k, 1, Q); let cx = 0, cy = 0, cz = 0, n = 0; for (let v = 0; v < V; v++) { if (!used[v]) continue; cx += Q[3 * v] + P[3 * v]; cy += Q[3 * v + 1] - P[3 * v + 1]; cz += Q[3 * v + 2] + P[3 * v + 2]; n++; } cx /= n; cy /= n; cz /= n; let res = 0; for (let v = 0; v < V; v++) { if (!used[v]) continue; res = Math.max(res, Math.abs(Q[3 * v] + P[3 * v] - cx), Math.abs(Q[3 * v + 1] - P[3 * v + 1] - cy), Math.abs(Q[3 * v + 2] + P[3 * v + 2] - cz)); } row.turnResidual = res;
      // rigid throughout: pairwise distances of 400 random pairs
      let rg = 0; const pairs = Array.from({ length: 600 }, (_, i) => [(i * 7919) % V, (i * 104729 + 13) % V]); const d0 = pairs.map(([a, b]) => Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]));
      for (let i = 1; i < 40; i++) { model.pose(k, i / 40, Q); pairs.forEach(([a, b], q) => { rg = Math.max(rg, Math.abs(Math.hypot(Q[3 * a] - Q[3 * b], Q[3 * a + 1] - Q[3 * b + 1], Q[3 * a + 2] - Q[3 * b + 2]) - d0[q])); }); } row.turnRigidErr = rg; }
    // pose cost
    { const M = timingCalls; const t0 = performance.now(); for (let i = 0; i < M; i++) model.pose(k, (i * 0.6180339887) % 1, Q); row.poseMs = M ? (performance.now() - t0) / M : NaN; }
    // determinism: second instance + repeated/out-of-order calls
    { let dd = 0; const A = new Float32Array(3 * V), B = new Float32Array(3 * V); for (const t of [0, 0.123, 0.5, 0.77, 1]) { model.pose(k, t, A); model.pose((k + 3) % K, 0.4, B); model.pose(k, t, B); for (let q = 0; q < 3 * V; q++) dd = Math.max(dd, Math.abs(A[q] - B[q])); if (model2) { model2.pose(k, t, B); for (let q = 0; q < 3 * V; q++) dd = Math.max(dd, Math.abs(A[q] - B[q])); } } row.determinismDiff = dd; }
    Object.assign(row, agg); steps.push(row);
  }
  out.steps = steps; out.contMax = contMax;
  // initial state checks
  model.pose(0, 0, P); { let zmax = 0; for (let v = 0; v < V; v++) zmax = Math.max(zmax, Math.abs(P[3 * v + 2])); const td = triData(P); let nzMin = 1; for (let t = 0; t < T; t++) nzMin = Math.min(nzMin, td.n[3 * t + 2]);
    let axisAligned = 0; for (let v = 0; v < V; v++) axisAligned = Math.max(axisAligned, Math.abs(P[3 * v] - (uv[2 * v] - 0.5)), Math.abs(P[3 * v + 1] - (uv[2 * v + 1] - 0.5)));
    out.initial = { maxAbsZ: zmax, minNz: nzMin, bb: steps[0].start.bb, uvIdentityErr: axisAligned }; }
  // final + key states: white fraction
  const dirs = fib(whiteDirs);
  model.pose(K - 1, 1, P); out.finalWhiteFrac = whiteFraction(P, dirs); out.finalBB = steps[K - 1].end.bb;
  out.finalWhiteFracPM = { home: whiteFraction(P, [HOME_VIEW]), front: whiteFraction(P, [[0, 0, 1]]), back: whiteFraction(P, [[0, 0, -1]]), top: whiteFraction(P, [[0, 1, 0]]), bottom: whiteFraction(P, [[0, -1, 0]]), left: whiteFraction(P, [[-1, 0, 0]]), right: whiteFraction(P, [[1, 0, 0]]) };
  out.boundaryWhite = steps.map((s, k) => { model.pose(k, 1, P); return { id: s.id, front: whiteFraction(P, [[0, 0, 1]], 100), back: whiteFraction(P, [[0, 0, -1]], 100) }; });

  // ---------- self-test of the layer-order checker (mutation): swap the z of two overlapping faces in flat end states ----------
  if (selfTest) { let trials = 0, caught = 0; let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let k = 0; k < K; k++) { model.pose(k, 1, P); const td = triData(P); let nf = 0; for (let t = 0; t < T; t++) nf = Math.max(nf, 1 - Math.abs(td.n[3 * t + 2])); if (nf > 1e-6) continue;
      const base = flatChecks(P, td); if (base.levels < 4) continue;
      for (let it = 0; it < 60; it++) { const a = Math.floor(rnd() * F), b = Math.floor(rnd() * F); if (a === b) continue; const za = P[3 * faceVerts[a][0] + 2], zb = P[3 * faceVerts[b][0] + 2]; if (Math.abs(za - zb) < 1e-6) continue;
        const M = Float32Array.from(P); for (const v of faceVerts[a]) M[3 * v + 2] = zb; for (const v of faceVerts[b]) M[3 * v + 2] = za;
        const c = flatChecks(M, triData(M)); trials++; if (c.tacoTortilla + c.tacoTaco + c.tortThroughTaco + c.jogCross + c.close8 > base.tacoTortilla + base.tacoTaco + base.tortThroughTaco + base.jogCross + base.close8) caught++; } }
    out.selfTest = { trials, caught }; }
  // paper corners / centre tracking at flat end states and final
  { const cv = [[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5]].map(c => { for (let v = 0; v < V; v++) if (Math.abs(uv[2 * v] - c[0]) < 1e-7 && Math.abs(uv[2 * v + 1] - c[1]) < 1e-7) return v; return -1; });
    out.corners = steps.map((s, k) => { model.pose(k, 1, P); return cv.map(v => v < 0 ? null : [P[3 * v], P[3 * v + 1], P[3 * v + 2]].map(x => +x.toFixed(4))); }); }
  // final pose: parallel overlapping pair separations
  { model.pose(K - 1, 1, P); const r = sample(P, true); const ds = [...r.parMap.values()].map(Math.abs).sort((a, b) => a - b); out.finalPar = { pairs: ds.length, min: ds[0], lt0008: ds.filter(d => d < 0.0008).length, lt0015: ds.filter(d => d < 0.00149).length, p10: ds[Math.floor(ds.length * 0.1)] }; }
  out.hingeGapAtEnd = Math.max(...steps.map((s) => s.end.hingeGap));
  return out;
}

/** Prints the report of analyseModel() as tables. */
export function printReport(out, log = console.log) {
  const { V, T, F, K, N, steps, contMax } = out;
  const f = (x, d = 4) => x === undefined ? '-' : (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(1) : x.toFixed(d));
  log(`\n=== ${out.name}  V=${V} T=${T} F=${F} steps=${K} N=${N} hinges=${out.hingeCount} uvArea=${out.uvAreaSum.toFixed(6)} uvWinding=+${out.uvWinding.pos}/-${out.uvWinding.neg} uvRange=[${out.uvRange}] unusedVerts=${out.unusedVerts}`);
  log(`initial: maxAbsZ=${out.initial.maxAbsZ} minNz=${out.initial.minNz.toFixed(6)} bb=${out.initial.bb.map(x => x.toFixed(3))} uvIdentityErr=${f(out.initial.uvIdentityErr)}`);
  log('step            kind        | strain   rigid    | gapMax@t        | ipInb max(samples) sub deep nbr maxL  maxDepth @t   | zf max(opp) samples(opp) | exGap@t      flips | jump81  fineJump pop@t   d2      | ctrOff poseMs  det   cont');
  for (const s of steps) log(`${String(s.k).padStart(2)} ${s.id.padEnd(16)} ${s.kind.padEnd(11)} | ${f(s.strain)} ${f(s.rigid)} | ${f(s.hingeGap)}@${s.gapWorstT.toFixed(2)} | ${String(s.ipAnyMax).padStart(3)}(${String(s.ipAnySamples).padStart(2)}) ${String(s.ipSubMax).padStart(3)} ${String(s.ipDeepMax).padStart(3)} ${String(s.ipNbrMax).padStart(3)} ${f(s.ipMaxL, 3)} ${f(s.ipMaxDepth, 4)} @${s.ipWorstT.toFixed(2)} | ${String(s.zfMax).padStart(3)}(${String(s.zfOppMax).padStart(3)}) ${String(s.zfSamples).padStart(2)}(${String(s.zfOppSamples).padStart(2)}) @${s.zfWorstT.toFixed(2)} | ${f(s.excessGap)}@${s.excessGapT.toFixed(2)} ${String(s.flips).padStart(3)}(${s.flipSamples}) | ${f(s.jump)} ${f(s.fineJump, 5)} ${f(s.popJump, 5)}@${s.popT.toFixed(4)} ${f(s.d2, 6)} | ${f(s.ctrOff, 3)} ${f(s.poseMs, 5)} ${f(s.determinismDiff)} ${f(s.contFromPrev)}${s.turnResidual !== undefined ? ` turnRes=${f(s.turnResidual)} turnRigid=${f(s.turnRigidErr)}` : ''}`);
  log('boundary END states: step | flat? nonflat | strain rigid | gapXY gapZ | ip nbrIp zf(opp) | levels maxLayers thick minSep <.0008 <.0015 | TT TC TT2 jogs(max) jogX | w x h | white F/B');
  for (let k = 0; k < K; k++) { const s = steps[k], b = s.end, fl = b.flat; log(`${String(k).padStart(2)} ${s.id.padEnd(16)} | ${b.nonflat < 1e-6 ? 'flat' : 'NONFLAT'}${b.flatExpected ? '' : '(3D ok)'} ${f(b.nonflat)} | ${f(b.strain)} ${f(b.rigid)} | ${f(b.hingeGapXY)} ${f(b.hingeGapZ)} | ${b.ipAny} ${b.ipNbr} ${b.zf}(${b.zfOpp}) | ${fl ? `${fl.levels} ${fl.maxLayers} ${f(fl.thickness)} ${f(fl.minSep, 5)} ${fl.close8} ${fl.close15} | ${fl.tacoTortilla} ${fl.tacoTaco} ${fl.tortThroughTaco} ${fl.jogs}(${f(fl.maxJog)}) ${fl.jogCross} | ${fl.w.toFixed(4)} x ${fl.h.toFixed(4)}` : '- | - | -'} | ${out.boundaryWhite[k].front.toFixed(3)}/${out.boundaryWhite[k].back.toFixed(3)}${fl && fl.examples.length ? '  ' + fl.examples.join('; ') : ''}`); }
  log('mid-step flat states (in-between samples that are exactly flat):'); for (const st of steps) if (st.midFlat) { const m = st.midFlat; const mid = m[Math.floor(m.length / 2)]; log(`  ${String(st.k).padStart(2)} ${st.id.padEnd(16)} flatSamples=${m.length} t=${mid.t.toFixed(3)} levels=${mid.levels} maxLayers=${mid.maxLayers} minSep=${f(mid.minSep, 5)} <.0008=${Math.max(...m.map(x => x.close8))} TT=${Math.max(...m.map(x => x.TT))} TC=${Math.max(...m.map(x => x.TC))} TT2=${Math.max(...m.map(x => x.TT2))} jogs=${Math.max(...m.map(x => x.jogs))}(${f(Math.max(...m.map(x => x.maxJog)))}) jogX=${Math.max(...m.map(x => x.jogX))} ${mid.w.toFixed(4)}x${mid.h.toFixed(4)} ${mid.ex.join('; ')}`); }
  log('corners (uv 00,10,11,01,centre) at end of each step:'); out.corners.forEach((c, k) => log(`  ${String(k).padStart(2)} ${steps[k].id.padEnd(16)} ${c.map(q => q ? `(${q.join(',')})` : '-').join(' ')}`));
  log('final pose parallel-overlap separations', JSON.stringify(out.finalPar));
  if (out.selfTest) log(`layer-checker mutation self-test: ${out.selfTest.caught}/${out.selfTest.trials} random z-swaps flagged`);
  log(`continuity max=${contMax.toExponential(2)}  final white fraction (120 dirs)=${out.finalWhiteFrac.toFixed(4)}  axis views=${JSON.stringify(Object.fromEntries(Object.entries(out.finalWhiteFracPM).map(([k, v]) => [k, +v.toFixed(3)])))}  finalBB=${out.finalBB.map(x => x.toFixed(3))}`);
  if (out.problems.length) log('PROBLEMS', out.problems);

}
