/**
 * Test helper: re-meshes a model into many small triangles that each own their
 * vertices, to exercise the viewer and the contract check at the size of a
 * real piece (hundreds of rigid faces) without needing real geometry.
 *
 * Every new vertex is pinned to one triangle of the source model by
 * barycentric coordinates. A rigid motion is affine, so the dense mesh follows
 * the source exactly.
 */

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} source
 * @param {number} [cells]  grid cells per side; the result has 2 * cells^2 triangles
 * @returns {import('../../src/origami/types.js').OrigamiModel}
 */
export function createDenseModel(source, cells = 20) {
  const { indices: sourceIndices, uvs: sourceUvs } = source;
  const sourceTriangles = sourceIndices.length / 3;

  /** Barycentric coordinates of (u, v) in source triangle `tri`. */
  function barycentric(tri, u, v) {
    const a = sourceIndices[3 * tri];
    const b = sourceIndices[3 * tri + 1];
    const c = sourceIndices[3 * tri + 2];
    const ax = sourceUvs[2 * a], ay = sourceUvs[2 * a + 1];
    const bx = sourceUvs[2 * b], by = sourceUvs[2 * b + 1];
    const cx = sourceUvs[2 * c], cy = sourceUvs[2 * c + 1];
    const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    const wa = ((by - cy) * (u - cx) + (cx - bx) * (v - cy)) / det;
    const wb = ((cy - ay) * (u - cx) + (ax - cx) * (v - cy)) / det;
    return [a, b, c, wa, wb, 1 - wa - wb];
  }

  function ownerOf(u, v) {
    for (let tri = 0; tri < sourceTriangles; tri++) {
      const [, , , wa, wb, wc] = barycentric(tri, u, v);
      if (wa >= -1e-9 && wb >= -1e-9 && wc >= -1e-9) return tri;
    }
    throw new Error(`denseModel: (${u}, ${v}) is not on the source mesh`);
  }

  const uvs = [];
  const anchors = []; // per vertex: three source vertices
  const weights = []; // per vertex: three barycentric weights
  const addTriangle = (points) => {
    const centreU = (points[0][0] + points[1][0] + points[2][0]) / 3;
    const centreV = (points[0][1] + points[1][1] + points[2][1]) / 3;
    const owner = ownerOf(centreU, centreV);
    for (const [u, v] of points) {
      const [a, b, c, wa, wb, wc] = barycentric(owner, u, v);
      uvs.push(u, v);
      anchors.push(a, b, c);
      weights.push(wa, wb, wc);
    }
  };
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const u0 = column / cells, u1 = (column + 1) / cells;
      const v0 = row / cells, v1 = (row + 1) / cells;
      // Split along the rising diagonal, which is the direction of the demo's corner crease.
      addTriangle([[u0, v0], [u1, v0], [u1, v1]]);
      addTriangle([[u0, v0], [u1, v1], [u0, v1]]);
    }
  }

  const vertexCount = uvs.length / 2;
  const anchorIndex = Uint32Array.from(anchors);
  const anchorWeight = Float64Array.from(weights);
  const scratch = new Float32Array(3 * source.vertexCount);

  return {
    name: `${source.name} (dense)`,
    steps: source.steps,
    vertexCount,
    indices: Uint32Array.from({ length: vertexCount }, (_, i) => i),
    uvs: Float32Array.from(uvs),
    pose(stepIndex, t, out) {
      source.pose(stepIndex, t, scratch);
      for (let v = 0; v < vertexCount; v++) {
        const a = 3 * anchorIndex[3 * v];
        const b = 3 * anchorIndex[3 * v + 1];
        const c = 3 * anchorIndex[3 * v + 2];
        const wa = anchorWeight[3 * v];
        const wb = anchorWeight[3 * v + 1];
        const wc = anchorWeight[3 * v + 2];
        out[3 * v] = wa * scratch[a] + wb * scratch[b] + wc * scratch[c];
        out[3 * v + 1] = wa * scratch[a + 1] + wb * scratch[b + 1] + wc * scratch[c + 1];
        out[3 * v + 2] = wa * scratch[a + 2] + wb * scratch[b + 2] + wc * scratch[c + 2];
      }
    },
    guides: (stepIndex) => source.guides(stepIndex),
  };
}
