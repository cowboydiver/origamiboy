/**
 * The back of every fold.
 *
 * A model's faces are flat and its stacked layers sit a little apart, so at a
 * crease that is folded flat the two faces end at the same line, one above the
 * other, with an open slit between them: from outside you look into the fold
 * and see the white inside of the paper, and the edge of a stack of folded
 * layers shows as stripes. Real paper goes round. This mesh closes each crease
 * with a narrow strip from the edge of one face to the edge of its neighbour.
 *
 * - The strip bulges out of the fold a little, the more the wider the gap it
 *   bridges, so that of several folds nested on one line the outermost is in
 *   front and hides the edges of the layers inside it.
 * - The strips continue the paper's own winding, so they take the paper's two
 *   colours from the same material: the outside of a fold shows whichever side
 *   of the sheet is on its outside.
 * - A fold with the WHITE side out is left open once it is folded flat. Its
 *   gap is as wide as the layers lying between its two faces somewhere else in
 *   the model, far wider than the fold really is, and a strip would paint a
 *   white band of that width; open, it shows the coloured faces inside it.
 * - Where a crease is not folded the two edges coincide and its strip has no
 *   area.
 */
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh } from 'three';
import { findAdjacency } from './adjacency.js';

/** How far a strip bulges beyond the crease: BULGE of a narrow gap, levelling off at BULGE * BULGE_KNEE. */
const BULGE = 0.25;
const BULGE_KNEE = 0.012;
const bulge = (gap) => (BULGE * gap) / (1 + gap / BULGE_KNEE);
/** A white-side-out fold loses its strip between these two degrees of being folded (0 open, 1 flat). */
const OPEN_FROM = 0.6;
const OPEN_BY = 0.9;

/**
 * @param {import('../origami/types.js').OrigamiModel} model
 * @param {import('three').Material} material  the paper's material
 */
export function createFoldBacks(model, material) {
  // Diagonals inside a face join two triangles that share their vertices: nothing to close.
  const creases = findAdjacency(model).creases.filter((crease) => crease.a !== crease.a2 || crease.b !== crease.b2);
  const count = creases.length;

  // Eight vertices per crease, in the order: a, b, A1, B1, A2, B2, a2, b2
  // (lower case on the faces' edges, upper case out on the bulge).
  const positions = new Float32Array(3 * 8 * count);
  const uvs = new Float32Array(2 * 8 * count);
  const index = new Uint32Array(18 * count);
  creases.forEach((crease, i) => {
    const source = [crease.a, crease.b, crease.a, crease.b, crease.a2, crease.b2, crease.a2, crease.b2];
    source.forEach((vertex, n) => {
      uvs[2 * (8 * i + n)] = model.uvs[2 * vertex];
      uvs[2 * (8 * i + n) + 1] = model.uvs[2 * vertex + 1];
    });
    // Three quads, each running back along the far edge of the one before:
    // (b, a, A1, B1), (B1, A1, A2, B2), (B2, A2, a2, b2).
    const quads = [[1, 0, 2, 3], [3, 2, 4, 5], [5, 4, 6, 7]];
    quads.forEach(([p, q, r, s], n) => {
      index.set([p, q, r, p, r, s].map((v) => 8 * i + v), 18 * i + 6 * n);
    });
  });

  const positionAttribute = new BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(index, 1));

  const mesh = new Mesh(geometry, material);
  mesh.name = 'fold-backs';
  mesh.frustumCulled = false;

  /** Unit vector in the plane of triangle (a, b, c), square to a -> b, pointing away from c. */
  const outward = [0, 0, 0];
  function setOutward(P, a, b, c) {
    const ex = P[b] - P[a];
    const ey = P[b + 1] - P[a + 1];
    const ez = P[b + 2] - P[a + 2];
    const dx = P[a] - P[c];
    const dy = P[a + 1] - P[c + 1];
    const dz = P[a + 2] - P[c + 2];
    const k = (dx * ex + dy * ey + dz * ez) / (ex * ex + ey * ey + ez * ez || 1);
    const nx = dx - k * ex;
    const ny = dy - k * ey;
    const nz = dz - k * ez;
    const length = Math.hypot(nx, ny, nz) || 1;
    outward[0] = nx / length;
    outward[1] = ny / length;
    outward[2] = nz / length;
  }

  return {
    mesh,
    count,
    /** The creases the strips belong to, in the order of the buffers. */
    creases,
    /** The live position buffer (3 * 8 * count). */
    positions,

    /** @param {Float32Array} P  the paper's current pose */
    update(P) {
      for (let i = 0; i < count; i++) {
        const crease = creases[i];
        const a = 3 * crease.a;
        const b = 3 * crease.b;
        const c = 3 * crease.c;
        const a2 = 3 * crease.a2;
        const b2 = 3 * crease.b2;

        // Both edges bulge the same way: along the mean of the two faces' outward
        // directions. Folded flat, that is straight out of the fold; at an open
        // crease the two cancel and the strip is a plain bridge.
        setOutward(P, a, b, c);
        let mx = outward[0];
        let my = outward[1];
        let mz = outward[2];
        setOutward(P, a2, b2, 3 * crease.c2);
        mx = (mx + outward[0]) / 2;
        my = (my + outward[1]) / 2;
        mz = (mz + outward[2]) / 2;

        // Which side of the paper is outside: the first face's normal points to
        // its white side, so if the second face lies on that side, white is inside.
        const ux = P[b] - P[a];
        const uy = P[b + 1] - P[a + 1];
        const uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a];
        const vy = P[c + 1] - P[a + 1];
        const vz = P[c + 2] - P[a + 2];
        const side =
          (P[a2] - P[a]) * (uy * vz - uz * vy) + (P[a2 + 1] - P[a + 1]) * (uz * vx - ux * vz) + (P[a2 + 2] - P[a + 2]) * (ux * vy - uy * vx);
        let keep = 1;
        if (side < 0) {
          const folded = Math.hypot(mx, my, mz);
          const x = Math.min(1, Math.max(0, (folded - OPEN_FROM) / (OPEN_BY - OPEN_FROM)));
          keep = 1 - x * x * (3 - 2 * x);
        }

        const ra = keep * bulge(Math.hypot(P[a] - P[a2], P[a + 1] - P[a2 + 1], P[a + 2] - P[a2 + 2]));
        const rb = keep * bulge(Math.hypot(P[b] - P[b2], P[b + 1] - P[b2 + 1], P[b + 2] - P[b2 + 2]));
        const o = 24 * i;
        for (let d = 0; d < 3; d++) {
          const m = d === 0 ? mx : d === 1 ? my : mz;
          // A strip that is not kept shrinks back onto the first face's edge.
          const farA = P[a + d] + keep * (P[a2 + d] - P[a + d]);
          const farB = P[b + d] + keep * (P[b2 + d] - P[b + d]);
          positions[o + d] = P[a + d];
          positions[o + 3 + d] = P[b + d];
          positions[o + 6 + d] = P[a + d] + m * ra;
          positions[o + 9 + d] = P[b + d] + m * rb;
          positions[o + 12 + d] = farA + m * ra;
          positions[o + 15 + d] = farB + m * rb;
          positions[o + 18 + d] = farA;
          positions[o + 21 + d] = farB;
        }
      }
      positionAttribute.needsUpdate = true;
    },

    dispose() {
      geometry.dispose();
    },
  };
}
