/**
 * Dependency-free software renderer for OrigamiModel poses (development only).
 * It uses nothing but the public contract: indices, uvs, pose(), guides().
 * White side light, coloured side red, face boundaries inked where they are
 * folded, valley guides blue dashes, mountain guides yellow dots.
 */
import zlib from 'node:zlib';

const D = Math.PI / 180;
const rotY = (a) => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a) => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const mm = (A, B) => {
  const C = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C.push(A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]);
  return C;
};

/** View matrices; rows are screen-right, screen-up, toward-camera. */
export const VIEWS = {
  front: rotX(0),
  /** The app's default camera: 20 degrees to the right, 12 degrees above. */
  home: mm(rotX(12 * D), rotY(-20 * D)),
  q: mm(rotX(25 * D), rotY(-35 * D)),
  q2: mm(rotX(25 * D), rotY(35 * D)),
  side: rotY(-90 * D),
  top: rotX(90 * D),
  back: rotY(180 * D),
  qb: mm(rotX(25 * D), rotY(-145 * D)),
  low: mm(rotX(-20 * D), rotY(-50 * D)),
  bottom: rotX(-90 * D),
  topq: mm(rotX(60 * D), rotY(-20 * D)),
  edge: mm(rotX(8 * D), rotY(-80 * D)),
};

const COL = [0.85, 0.2, 0.22];
const WHITE = [0.95, 0.94, 0.9];
const BG = [0.16, 0.18, 0.22];
const SS = 2;

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 */
export function createRasterizer(model) {
  const nv = model.vertexCount;
  const ix = model.indices;

  // Face boundary edges: edges that belong to exactly one triangle.
  const ec = new Map();
  for (let t = 0; t < ix.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = ix[t + e];
      const b = ix[t + ((e + 1) % 3)];
      const key = a < b ? a + '_' + b : b + '_' + a;
      const r = ec.get(key) || { a, b, n: 0, tri: t };
      r.n++;
      ec.set(key, r);
    }
  }
  const bedges = [...ec.values()].filter((r) => r.n === 1);

  function triN(pos, t) {
    const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const l = Math.hypot(...n) || 1;
    return n.map((x) => x / l);
  }

  /** Boundary edges, minus those with a coincident coplanar partner (a flat, unfolded crease). */
  function visibleEdges(pos) {
    const q = (i) => [0, 1, 2].map((d) => Math.round(pos[3 * i + d] * 2e4)).join(',');
    const map = new Map();
    for (const e of bedges) {
      const ka = q(e.a), kb = q(e.b);
      const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      (map.get(key) || map.set(key, []).get(key)).push(e);
    }
    const out = [];
    for (const [, l] of map) {
      if (l.length >= 2) {
        const n0 = triN(pos, l[0].tri);
        if (l.every((e) => { const n = triN(pos, e.tri); return n[0] * n0[0] + n[1] * n0[1] + n[2] * n0[2] > 0.9995; })) continue;
      }
      out.push(...l);
    }
    return out;
  }

  /**
   * Renders one square tile.
   * @param {Float32Array} pos    3 * vertexCount positions
   * @param {number[]} V          view matrix (see VIEWS)
   * @param {number} scale        world units -> tile fraction
   * @param {number[]} ctr        world point at the tile centre
   * @param {Object} [opt]
   * @param {number} [opt.tile]   tile size in pixels
   * @param {Array} [opt.guides]  fold guides to draw
   * @param {boolean} [opt.edges] ink the folded face boundaries (default true)
   * @returns {Float32Array} rgb, tile * tile * 3
   */
  function renderTile(pos, V, scale, ctr, { tile = 300, guides = null, edges = true } = {}) {
    const n = tile, N = n * SS;
    const img = new Float32Array(N * N * 3), zb = new Float32Array(N * N).fill(-1e9);
    for (let i = 0; i < N * N; i++) { img[3 * i] = BG[0]; img[3 * i + 1] = BG[1]; img[3 * i + 2] = BG[2]; }
    const P = new Float32Array(3 * nv), kk = scale * N;
    const pr = (x, y, z) => {
      x -= ctr[0]; y -= ctr[1]; z -= ctr[2];
      return [N / 2 + kk * (V[0] * x + V[1] * y + V[2] * z), N / 2 - kk * (V[3] * x + V[4] * y + V[5] * z), kk * (V[6] * x + V[7] * y + V[8] * z)];
    };
    for (let v = 0; v < nv; v++) { const p = pr(pos[3 * v], pos[3 * v + 1], pos[3 * v + 2]); P[3 * v] = p[0]; P[3 * v + 1] = p[1]; P[3 * v + 2] = p[2]; }
    const L = [0.3, 0.55, 0.78];
    for (let t = 0; t < ix.length; t += 3) {
      const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const area = ux * vy - uy * vx;
      if (Math.abs(area) < 1e-9) continue;
      // World normal: counter-clockwise from the white side, so it points to the white side.
      const wn = triN(pos, t);
      const facing = V[6] * wn[0] + V[7] * wn[1] + V[8] * wn[2];
      const base = facing > 0 ? WHITE : COL;
      const lx = V[0] * wn[0] + V[1] * wn[1] + V[2] * wn[2], ly = V[3] * wn[0] + V[4] * wn[1] + V[5] * wn[2];
      const lam = 0.45 + 0.55 * Math.abs(lx * L[0] + ly * L[1] + facing * L[2]);
      const x0 = Math.max(0, Math.floor(Math.min(P[a], P[b], P[c]))), x1 = Math.min(N - 1, Math.ceil(Math.max(P[a], P[b], P[c])));
      const y0 = Math.max(0, Math.floor(Math.min(P[a + 1], P[b + 1], P[c + 1]))), y1 = Math.min(N - 1, Math.ceil(Math.max(P[a + 1], P[b + 1], P[c + 1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - P[a], py = y + 0.5 - P[a + 1];
        const w1 = (px * vy - py * vx) / area, w2 = (ux * py - uy * px) / area;
        if (w1 < -1e-4 || w2 < -1e-4 || w1 + w2 > 1.0001) continue;
        const z = P[a + 2] + w1 * uz + w2 * vz, o = y * N + x;
        if (z > zb[o]) { zb[o] = z; img[3 * o] = base[0] * lam; img[3 * o + 1] = base[1] * lam; img[3 * o + 2] = base[2] * lam; }
      }
    }
    const line = (A, B, col, bias, dash, w) => {
      const len = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1])));
      for (let i = 0; i <= len; i++) {
        if (dash && Math.floor(i / (dash * SS)) % 2) continue;
        const u = i / len, x = Math.round(A[0] + (B[0] - A[0]) * u), y = Math.round(A[1] + (B[1] - A[1]) * u), z = A[2] + (B[2] - A[2]) * u + bias;
        for (let dy = 0; dy < w; dy++) for (let dx = 0; dx < w; dx++) {
          const X = x + dx, Y = y + dy;
          if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
          const o = Y * N + X;
          if (z >= zb[o]) { img[3 * o] = col[0]; img[3 * o + 1] = col[1]; img[3 * o + 2] = col[2]; }
        }
      }
    };
    if (edges) for (const e of visibleEdges(pos)) line([P[3 * e.a], P[3 * e.a + 1], P[3 * e.a + 2]], [P[3 * e.b], P[3 * e.b + 1], P[3 * e.b + 2]], [0.08, 0.08, 0.1], 0.0006 * kk, 0, 1);
    for (const g of guides || []) line(pr(...g.a), pr(...g.b), g.type === 'valley' ? [0.15, 0.7, 1] : [1, 0.85, 0.1], 0.003 * kk, g.type === 'valley' ? 5 : 2, 3);
    const out = new Float32Array(n * n * 3);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) for (let ch = 0; ch < 3; ch++) {
      let s = 0;
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += img[3 * ((y * SS + dy) * N + x * SS + dx) + ch];
      out[3 * (y * n + x) + ch] = s / (SS * SS);
    }
    return out;
  }

  return { renderTile };
}

const FONT = { 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', '.': '000000000000010' };

/** Lays square tiles out on a grid, each with a small numeric label, and returns an 8-bit rgb buffer. */
export function contactSheet(tiles, labels, cols, tile) {
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * tile, H = rows * tile, buf = Buffer.alloc(W * H * 3);
  tiles.forEach((t, i) => {
    const ox = (i % cols) * tile, oy = Math.floor(i / cols) * tile;
    for (let y = 0; y < tile; y++) for (let x = 0; x < tile; x++) for (let ch = 0; ch < 3; ch++) buf[3 * ((oy + y) * W + ox + x) + ch] = Math.max(0, Math.min(255, Math.round(255 * t[3 * (y * tile + x) + ch])));
    [...String(labels[i] ?? '')].forEach((chr, ci) => {
      const g = FONT[chr];
      if (!g) return;
      for (let p = 0; p < 15; p++) if (g[p] === '1') for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) {
        const X = ox + 6 + ci * 12 + (p % 3) * 3 + dx, Y = oy + 6 + Math.floor(p / 3) * 3 + dy;
        buf[3 * (Y * W + X)] = 255; buf[3 * (Y * W + X) + 1] = 255; buf[3 * (Y * W + X) + 2] = 120;
      }
    });
    for (let y = 0; y < tile; y++) for (let ch = 0; ch < 3; ch++) buf[3 * ((oy + y) * W + ox) + ch] = 70;
    for (let x = 0; x < tile; x++) for (let ch = 0; ch < 3; ch++) buf[3 * (oy * W + ox + x) + ch] = 70;
  });
  return { width: W, height: H, rgb: buf };
}

export function encodePng(w, h, rgb) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
  const raw = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (3 * w + 1) + 1, y * 3 * w, (y + 1) * 3 * w);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
