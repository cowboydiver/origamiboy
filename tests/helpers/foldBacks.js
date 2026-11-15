/**
 * Test helper: a model together with the strips the viewer closes its folds
 * with (src/viewer/foldBacks.js), as one triangle mesh in the shape of the
 * model contract. The contract-only measuring tools can then look at the
 * geometry the viewer really draws.
 */
import { createFoldBacks } from '../../src/viewer/foldBacks.js';

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} model
 * @returns {import('../../src/origami/types.js').OrigamiModel}
 */
export function withFoldBacks(model) {
  const foldBacks = createFoldBacks(model, undefined);
  const own = model.vertexCount;
  const extra = foldBacks.positions.length / 3;
  const stripIndex = foldBacks.mesh.geometry.getIndex().array;
  const indices = new Uint32Array(model.indices.length + stripIndex.length);
  indices.set(model.indices);
  for (let i = 0; i < stripIndex.length; i++) indices[model.indices.length + i] = own + stripIndex[i];
  const uvs = new Float32Array(2 * (own + extra));
  uvs.set(model.uvs);
  uvs.set(foldBacks.mesh.geometry.getAttribute('uv').array, 2 * own);
  const scratch = new Float32Array(3 * own);
  return {
    ...model,
    vertexCount: own + extra,
    indices,
    uvs,
    pose(stepIndex, t, out) {
      model.pose(stepIndex, t, scratch);
      foldBacks.update(scratch);
      out.set(scratch);
      out.set(foldBacks.positions, 3 * own);
    },
  };
}
