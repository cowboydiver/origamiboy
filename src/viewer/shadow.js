/**
 * A soft shadow on the ground under the model.
 *
 * There are no shadow maps: layers a few thousandths apart would show acne
 * under any usable bias. Instead the paper is drawn once more, squashed onto
 * the ground along a slanted light direction, into a small off-screen texture
 * (darker where the paper is closer to the ground), blurred, and shown on a
 * transparent plane. The model never receives a shadow, so it cannot acne.
 */
import {
  BufferGeometry,
  Camera,
  Color,
  CustomBlending,
  DoubleSide,
  Float32BufferAttribute,
  LinearFilter,
  MaxEquation,
  Mesh,
  OneFactor,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three';

/** Side of the square patch of ground that can show shadow, in world units. */
const EXTENT = 3.4;
const RESOLUTION = 512;
/** The gap left between the lowest point of the model and the ground. */
export const CLEARANCE = 0.03;

const castVertex = /* glsl */ `
  uniform float uGroundY;
  uniform vec2 uShear;
  uniform float uHalfExtent;
  varying float vHeight;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vHeight = world.y - uGroundY;
    // Slide each point along the light direction until it reaches the ground.
    vec2 ground = world.xz + uShear * max(vHeight, 0.0);
    gl_Position = vec4(ground.x / uHalfExtent, -ground.y / uHalfExtent, 0.0, 1.0);
  }
`;

const castFragment = /* glsl */ `
  uniform float uReach;
  varying float vHeight;
  void main() {
    float near = clamp(1.0 - vHeight / uReach, 0.0, 1.0);
    gl_FragColor = vec4(near * near * (0.35 + 0.65 * near));
  }
`;

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = position.xy * 0.5 + 0.5;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const blurFragment = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec2 uStep;
  varying vec2 vUv;
  void main() {
    float sum = texture2D(tMap, vUv).r * 0.1964825501511404;
    sum += (texture2D(tMap, vUv + uStep * 1.411764705882353).r + texture2D(tMap, vUv - uStep * 1.411764705882353).r) * 0.2969069646728344;
    sum += (texture2D(tMap, vUv + uStep * 3.2941176470588234).r + texture2D(tMap, vUv - uStep * 3.2941176470588234).r) * 0.09447039785044732;
    sum += (texture2D(tMap, vUv + uStep * 5.176470588235294).r + texture2D(tMap, vUv - uStep * 5.176470588235294).r) * 0.010381362401148057;
    gl_FragColor = vec4(sum);
  }
`;

const groundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const groundFragment = /* glsl */ `
  uniform sampler2D tMap;
  uniform vec3 uColour;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    // Fade to nothing before the edge of the patch so it never shows as a square.
    vec2 centred = abs(vUv - 0.5) * 2.0;
    float edge = 1.0 - smoothstep(0.7, 1.0, max(centred.x, centred.y));
    float alpha = texture2D(tMap, vUv).r * uOpacity * edge;
    gl_FragColor = vec4(uColour, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').Mesh} paper  the mesh that casts the shadow
 */
export function createGroundShadow(renderer, paper) {
  const targetOptions = { depthBuffer: false, stencilBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter };
  const source = new WebGLRenderTarget(RESOLUTION, RESOLUTION, targetOptions);
  const scratch = new WebGLRenderTarget(RESOLUTION, RESOLUTION, targetOptions);
  source.texture.generateMipmaps = false;
  scratch.texture.generateMipmaps = false;

  const castMaterial = new ShaderMaterial({
    uniforms: {
      uGroundY: { value: 0 },
      // Light from the upper front left: shadows fall behind and a little to the right.
      uShear: { value: new Vector2(0.16, -0.42) },
      uHalfExtent: { value: EXTENT / 2 },
      uReach: { value: 1.25 },
    },
    vertexShader: castVertex,
    fragmentShader: castFragment,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    // Overlapping layers keep the darkest value instead of piling up.
    transparent: true,
    blending: CustomBlending,
    blendEquation: MaxEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendEquationAlpha: MaxEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });

  const quadGeometry = new BufferGeometry();
  quadGeometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const blurMaterial = new ShaderMaterial({
    uniforms: { tMap: { value: null }, uStep: { value: new Vector2() } },
    vertexShader: quadVertex,
    fragmentShader: blurFragment,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(quadGeometry, blurMaterial);
  quad.frustumCulled = false;

  const groundMaterial = new ShaderMaterial({
    uniforms: {
      tMap: { value: source.texture },
      uColour: { value: new Color(0x2a2118) },
      uOpacity: { value: 0.3 },
    },
    vertexShader: groundVertex,
    fragmentShader: groundFragment,
    transparent: true,
    depthWrite: false,
  });
  const ground = new Mesh(new PlaneGeometry(EXTENT, EXTENT).rotateX(-Math.PI / 2), groundMaterial);
  ground.name = 'ground-shadow';
  ground.renderOrder = -1;

  // The cast and blur shaders write clip-space positions themselves.
  const camera = new Camera();
  const clearColour = new Color();
  let dirty = true;

  function blur(radius) {
    const step = radius / RESOLUTION;
    blurMaterial.uniforms.tMap.value = source.texture;
    blurMaterial.uniforms.uStep.value.set(step, 0);
    renderer.setRenderTarget(scratch);
    renderer.render(quad, camera);
    blurMaterial.uniforms.tMap.value = scratch.texture;
    blurMaterial.uniforms.uStep.value.set(0, step);
    renderer.setRenderTarget(source);
    renderer.render(quad, camera);
  }

  return {
    object: ground,

    /** Places the ground just under `lowestY`, the lowest point of the model. */
    setFloor(lowestY) {
      const y = lowestY - CLEARANCE;
      if (y === ground.position.y) return;
      ground.position.y = y;
      castMaterial.uniforms.uGroundY.value = y;
      dirty = true;
    },

    /** The paper moved: the shadow texture must be redrawn before the next frame. */
    invalidate() {
      dirty = true;
    },

    /** @param {{ colour: number, opacity: number }} look */
    setLook({ colour, opacity }) {
      groundMaterial.uniforms.uColour.value.set(colour);
      groundMaterial.uniforms.uOpacity.value = opacity;
    },

    /** Redraws the shadow texture if the paper has moved since the last call. */
    render() {
      if (!dirty) return;
      dirty = false;

      const previousTarget = renderer.getRenderTarget();
      const previousAlpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColour);
      const previousAutoClear = renderer.autoClear;
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 0);

      const paperMaterial = paper.material;
      paper.material = castMaterial;
      renderer.setRenderTarget(source);
      renderer.render(paper, camera);
      paper.material = paperMaterial;

      blur(1.6);
      blur(0.8);

      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clearColour, previousAlpha);
      renderer.autoClear = previousAutoClear;
    },

    dispose() {
      source.dispose();
      scratch.dispose();
      castMaterial.dispose();
      blurMaterial.dispose();
      groundMaterial.dispose();
      quadGeometry.dispose();
      ground.geometry.dispose();
    },
  };
}
