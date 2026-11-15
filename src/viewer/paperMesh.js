/**
 * The sheet of paper: one mesh with fixed topology whose position buffer is
 * rewritten by model.pose(). Nothing is allocated or rebuilt per frame.
 *
 * One double-sided, flat-shaded material paints both sides: the white side on
 * front faces (the contract winds triangles counter-clockwise as seen from the
 * white side) and the coloured side on back faces, plus a faint fibre grain.
 */
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshLambertMaterial,
} from 'three';

export const PAPER_WHITE = 0xf8f4ea;
export const PAPER_COLOUR = 0xcf4a2e;

const GRAIN = /* glsl */ `
  float paperHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float paperNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(paperHash(i), paperHash(i + vec2(1.0, 0.0)), u.x),
      mix(paperHash(i + vec2(0.0, 1.0)), paperHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  // Mottle plus short fibres, faded out before it can alias.
  float paperGrain(vec2 uv) {
    vec2 fine = uv * 190.0;
    vec2 fibre = vec2(uv.x * 46.0 + uv.y * 9.0, uv.y * 420.0);
    float footprint = max(fwidth(fine.x), fwidth(fine.y));
    float keep = 1.0 - smoothstep(0.45, 1.1, footprint);
    float grain = (paperNoise(fine) - 0.5) * 0.6 + (paperNoise(fibre) - 0.5) * 0.4;
    float cloud = paperNoise(uv * 7.0) - 0.5;
    return grain * keep + cloud * 0.5;
  }
`;

/**
 * Rewrites a Lambert shader in place to paint the two sides of the paper and
 * its grain. All four insertion points must be found; if the shader text of
 * the installed three.js no longer has them, nothing is changed.
 * @param {{ vertexShader: string, fragmentShader: string }} shader
 * @returns {boolean} whether the shader was rewritten
 */
export function patchPaperShaders(shader) {
  const places = [
    [shader.vertexShader, 'void main() {'],
    [shader.vertexShader, '#include <begin_vertex>'],
    [shader.fragmentShader, 'void main() {'],
    [shader.fragmentShader, '#include <color_fragment>'],
  ];
  if (!places.every(([source, find]) => source.includes(find))) return false;
  shader.vertexShader = shader.vertexShader
    .replace('void main() {', 'varying vec2 vPaperUv;\nvoid main() {')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPaperUv = uv;');
  shader.fragmentShader = shader.fragmentShader
    .replace(
      'void main() {',
      `uniform vec3 uPaperWhite;\nuniform vec3 uPaperColour;\nvarying vec2 vPaperUv;\n${GRAIN}\nvoid main() {`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
        diffuseColor.rgb = gl_FrontFacing ? uPaperWhite : uPaperColour;
        diffuseColor.rgb *= 1.0 + paperGrain(vPaperUv) * (gl_FrontFacing ? 0.05 : 0.085);`,
    );
  return true;
}

/**
 * @param {import('../origami/types.js').OrigamiModel} model
 */
export function createPaperMesh(model) {
  const positions = new Float32Array(3 * model.vertexCount);
  const positionAttribute = new BufferAttribute(positions, 3);
  positionAttribute.setUsage(DynamicDrawUsage);

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', positionAttribute);
  geometry.setAttribute('uv', new BufferAttribute(model.uvs, 2));
  geometry.setIndex(new BufferAttribute(model.indices, 1));

  const uniforms = {
    uPaperWhite: { value: new Color(PAPER_WHITE) },
    uPaperColour: { value: new Color(PAPER_COLOUR) },
  };

  const material = new MeshLambertMaterial({
    side: DoubleSide,
    flatShading: true,
    // Pushed back a hair so the ink edges drawn on top never z-fight with it.
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    if (!patchPaperShaders(shader)) {
      // The paper would be drawn in the material's plain colour on both sides.
      console.warn('[origami] could not add the two paper colours to the surface shader');
    }
  };
  material.customProgramCacheKey = () => 'origami-paper';

  const mesh = new Mesh(geometry, material);
  mesh.name = 'paper';
  // Positions change every frame and the camera follows the model, so culling
  // against a stale bounding sphere would only ever be wrong.
  mesh.frustumCulled = false;

  return {
    mesh,
    /** The live position buffer (3 * vertexCount). */
    positions,
    /** Writes the pose for (stepIndex, t) straight into the GPU buffer's source array. */
    setPose(stepIndex, t) {
      model.pose(stepIndex, t, positions);
      positionAttribute.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
