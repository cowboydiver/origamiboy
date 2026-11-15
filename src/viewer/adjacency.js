/**
 * Which triangles of a model are neighbours on the paper.
 *
 * Adjacency comes from the model's uvs: two triangles share a crease when they
 * share an edge on the unfolded square (vertices are not shared across faces,
 * so the index buffer alone does not say). Topology is fixed, so this is
 * worked out once.
 */

const QUANTUM = 1e5;
const onSquareEdge = (value) => value < 1e-5 || value > 1 - 1e-5;

/**
 * @typedef {Object} Crease
 * @property {number} a       one end of the shared edge, as a vertex of the first triangle
 * @property {number} b       the other end; a -> b is the first triangle's winding
 * @property {number} c       the first triangle's third vertex
 * @property {number} first   the first triangle
 * @property {number} a2      the vertex of the second triangle at the same place on the paper as a
 * @property {number} b2      likewise for b
 * @property {number} c2      the second triangle's third vertex
 * @property {number} second  the second triangle
 *
 * @param {import('../origami/types.js').OrigamiModel} model
 * @returns {{ creases: Crease[], outline: { a: number, b: number, first: number }[] }}
 *          creases: edges shared by two triangles (the diagonals inside a face included);
 *          outline: edges on the raw edge of the sheet
 */
export function findAdjacency(model) {
  const { indices, uvs } = model;
  const triangleCount = indices.length / 3;
  const key = (vertex) => `${Math.round(uvs[2 * vertex] * QUANTUM)},${Math.round(uvs[2 * vertex + 1] * QUANTUM)}`;

  /** @type {Map<string, any>} */
  const table = new Map();
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    for (let side = 0; side < 3; side++) {
      const a = indices[3 * triangle + side];
      const b = indices[3 * triangle + ((side + 1) % 3)];
      const c = indices[3 * triangle + ((side + 2) % 3)];
      const ka = key(a);
      const kb = key(b);
      if (ka === kb) continue;
      const id = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const entry = table.get(id);
      if (!entry) {
        table.set(id, { a, b, c, first: triangle, a2: -1, b2: -1, c2: -1, second: -1, uses: 1, ka });
      } else if (++entry.uses === 2) {
        // The neighbour runs along the shared edge the other way.
        const startsAtA = ka === entry.ka;
        entry.a2 = startsAtA ? a : b;
        entry.b2 = startsAtA ? b : a;
        entry.c2 = c;
        entry.second = triangle;
      }
    }
  }

  const creases = [];
  const outline = [];
  for (const { uses, ka, ...entry } of table.values()) {
    if (uses === 2) {
      creases.push(entry);
    } else if (uses === 1) {
      const sameU = Math.abs(uvs[2 * entry.a] - uvs[2 * entry.b]) < 1e-5 && onSquareEdge(uvs[2 * entry.a]);
      const sameV = Math.abs(uvs[2 * entry.a + 1] - uvs[2 * entry.b + 1]) < 1e-5 && onSquareEdge(uvs[2 * entry.a + 1]);
      if (sameU || sameV) outline.push({ a: entry.a, b: entry.b, first: entry.first });
      // Anything else is a T-junction in the triangulation: not an edge of the sheet.
    }
  }
  return { creases, outline };
}
