/**
 * Ink lines that make stacked, flat-shaded layers readable:
 * - the raw edge of the sheet, always;
 * - every crease that is currently folded, fading in with the fold angle;
 * - a faint trace of every crease that has been folded earlier on the
 *   timeline, like the mark a real crease leaves after it is unfolded.
 *
 * Which triangles meet at a crease comes from adjacency.js. Topology is fixed,
 * so that is worked out once; per frame only positions and alphas are rewritten.
 */
import { DynamicDrawUsage, InstancedBufferAttribute } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { findAdjacency } from './adjacency.js';

const INK = 0x2b2622;
const LINE_WIDTH = 1.25; // CSS pixels
const OUTLINE_ALPHA = 0.8;
const CREASE_ALPHA = 0.7;
/** Strength of a crease that was folded earlier and is flat again, relative to a live one. */
const MEMORY = 0.3;
/** Fold amount (0 flat .. 1 folded flat) past which a crease counts as "has been folded". */
const MEMORY_THRESHOLD = 0.03;
/**
 * A line inside a closed stack, with paper lying right on it above and below,
 * is drawn at this fraction of its strength: the edge of a stack of layers
 * then reads as one edge and not as a line per layer.
 */
const BURIED = 0.1;
/** Without per-segment alpha (see createInkMaterial), lines weaker than this are not drawn at all. */
const SOLID_FROM = 0.4;
/** Paper within this distance of a line (along the face's normal) lies right on it; beyond twice that, not. */
const COVER_NEAR = 0.0045;
const COVER_FAR = 2 * COVER_NEAR;

/**
 * @param {import('../origami/types.js').OrigamiModel} model
 */
export function createEdges(model) {
  const { indices } = model;
  const triangleCount = indices.length / 3;
  const { creases, outline } = findAdjacency(model);

  const creaseCount = creases.length;
  const segments = [...creases, ...outline];
  const segmentCount = segments.length;
  const ends = new Uint32Array(2 * segmentCount);
  segments.forEach((entry, i) => {
    ends[2 * i] = entry.a;
    ends[2 * i + 1] = entry.b;
  });
  const sides = new Uint32Array(2 * creaseCount);
  creases.forEach((entry, i) => {
    sides[2 * i] = entry.first;
    sides[2 * i + 1] = entry.second;
  });
  /** The triangle each segment is an edge of. */
  const owner = Uint32Array.from(segments, (entry) => entry.first);
  /** Triangles of one rigid face share vertices; a face never covers its own edges. */
  const faceOf = facesOfTriangles(indices, model.vertexCount);

  /** The time at which each crease is first folded; Infinity if it never is. */
  const firstFolded = new Float32Array(creaseCount).fill(Infinity);
  const normals = new Float32Array(3 * triangleCount);

  // --- GPU buffers ---------------------------------------------------------
  // Wide lines are instanced quads: one instance per segment, six floats of
  // position and one of alpha, all rewritten in place.
  const linePositions = new Float32Array(6 * segmentCount);
  const lineAlphas = new Float32Array(segmentCount).fill(OUTLINE_ALPHA, creaseCount);

  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(linePositions); // adopts the array, no copy
  const positionBuffer = geometry.attributes.instanceStart.data;
  positionBuffer.setUsage(DynamicDrawUsage);
  const alphaAttribute = new InstancedBufferAttribute(lineAlphas, 1);
  alphaAttribute.setUsage(DynamicDrawUsage);
  geometry.setAttribute('instanceAlpha', alphaAttribute);

  const material = createInkMaterial();
  const lines = new LineSegments2(geometry, material);
  lines.name = 'paper-edges';
  lines.frustumCulled = false;
  lines.renderOrder = 2;

  function computeNormals(positions) {
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      const i0 = 3 * indices[3 * triangle];
      const i1 = 3 * indices[3 * triangle + 1];
      const i2 = 3 * indices[3 * triangle + 2];
      const ax = positions[i1] - positions[i0];
      const ay = positions[i1 + 1] - positions[i0 + 1];
      const az = positions[i1 + 2] - positions[i0 + 2];
      const bx = positions[i2] - positions[i0];
      const by = positions[i2 + 1] - positions[i0 + 1];
      const bz = positions[i2 + 2] - positions[i0 + 2];
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const length = Math.hypot(nx, ny, nz) || 1;
      normals[3 * triangle] = nx / length;
      normals[3 * triangle + 1] = ny / length;
      normals[3 * triangle + 2] = nz / length;
    }
  }

  /**
   * How deep inside a stack the middle of a segment lies: 0 with open air on
   * at least one side of its face, 1 with other paper lying right on it on both.
   */
  function buried(positions, segment) {
    const a = 3 * ends[2 * segment];
    const b = 3 * ends[2 * segment + 1];
    const mx = (positions[a] + positions[b]) / 2;
    const my = (positions[a + 1] + positions[b + 1]) / 2;
    const mz = (positions[a + 2] + positions[b + 2]) / 2;
    const own = owner[segment];
    const nx = normals[3 * own];
    const ny = normals[3 * own + 1];
    const nz = normals[3 * own + 2];
    let above = 0;
    let below = 0;
    for (let triangle = 0; triangle < triangleCount; triangle++) {
      if (faceOf[triangle] === faceOf[own]) continue;
      const tx = normals[3 * triangle];
      const ty = normals[3 * triangle + 1];
      const tz = normals[3 * triangle + 2];
      const facing = nx * tx + ny * ty + nz * tz;
      if (facing < 0.9 && facing > -0.9) continue; // not a layer of the same stack
      const i0 = 3 * indices[3 * triangle];
      const px = mx - positions[i0];
      const py = my - positions[i0 + 1];
      const pz = mz - positions[i0 + 2];
      const height = px * tx + py * ty + pz * tz;
      const distance = Math.abs(height);
      if (distance >= COVER_FAR || distance < 1e-6) continue;
      // Is the point over the triangle (or on its rim: the layers of a stack often end on one line)?
      const i1 = 3 * indices[3 * triangle + 1];
      const i2 = 3 * indices[3 * triangle + 2];
      const ux = positions[i1] - positions[i0];
      const uy = positions[i1 + 1] - positions[i0 + 1];
      const uz = positions[i1 + 2] - positions[i0 + 2];
      const vx = positions[i2] - positions[i0];
      const vy = positions[i2 + 1] - positions[i0 + 1];
      const vz = positions[i2 + 2] - positions[i0 + 2];
      const uu = ux * ux + uy * uy + uz * uz;
      const uv = ux * vx + uy * vy + uz * vz;
      const vv = vx * vx + vy * vy + vz * vz;
      const pu = px * ux + py * uy + pz * uz;
      const pv = px * vx + py * vy + pz * vz;
      const det = uu * vv - uv * uv;
      if (det < 1e-14) continue;
      const s = (pu * vv - pv * uv) / det;
      const t = (pv * uu - pu * uv) / det;
      if (s < -RIM || t < -RIM || s + t > 1 + RIM) continue;
      const x = Math.min(1, Math.max(0, (COVER_FAR - distance) / (COVER_FAR - COVER_NEAR)));
      const cover = x * x * (3 - 2 * x);
      // The triangle lies on the side of the face that `height` is NOT on.
      if (height * facing < 0) above = Math.max(above, cover);
      else below = Math.max(below, cover);
      if (above === 1 && below === 1) return 1;
    }
    return above * below;
  }

  /** 0 when the two faces at a crease are coplanar, 1 when folded flat onto each other. */
  function foldAmount(crease) {
    const p = 3 * sides[2 * crease];
    const q = 3 * sides[2 * crease + 1];
    const dot = normals[p] * normals[q] + normals[p + 1] * normals[q + 1] + normals[p + 2] * normals[q + 2];
    return (1 - dot) * 0.5;
  }

  return {
    object: lines,
    /** How many segments of each kind were found on the unfolded square. */
    counts: { creases: creaseCount, outline: outline.length },

    /** Called during the load-time analysis pass, in order of increasing time. */
    observe(positions, time) {
      computeNormals(positions);
      for (let crease = 0; crease < creaseCount; crease++) {
        if (time < firstFolded[crease] && foldAmount(crease) > MEMORY_THRESHOLD) firstFolded[crease] = time;
      }
    },

    /**
     * @param {Float32Array} positions  the paper's current pose
     * @param {number} time             current timeline time, for crease memory
     */
    update(positions, time) {
      computeNormals(positions);
      for (let segment = 0; segment < segmentCount; segment++) {
        const a = 3 * ends[2 * segment];
        const b = 3 * ends[2 * segment + 1];
        const out = 6 * segment;
        linePositions[out] = positions[a];
        linePositions[out + 1] = positions[a + 1];
        linePositions[out + 2] = positions[a + 2];
        linePositions[out + 3] = positions[b];
        linePositions[out + 4] = positions[b + 1];
        linePositions[out + 5] = positions[b + 2];
      }
      for (let crease = 0; crease < creaseCount; crease++) {
        const x = Math.min(1, Math.max(0, (foldAmount(crease) - 0.002) / 0.078));
        const live = x * x * (3 - 2 * x);
        const remembered = time >= firstFolded[crease] ? MEMORY : 0;
        const alpha = CREASE_ALPHA * Math.max(live, remembered);
        lineAlphas[crease] = alpha > 0 ? alpha * (1 - (1 - BURIED) * buried(positions, crease)) : 0;
      }
      for (let segment = creaseCount; segment < segmentCount; segment++) {
        lineAlphas[segment] = OUTLINE_ALPHA * (1 - (1 - BURIED) * buried(positions, segment));
      }
      if (!material.userData.perSegmentAlpha) {
        // Without per-segment alpha every line draws at full strength: show only
        // the ones that should be strong, and shrink the rest to nothing.
        for (let segment = 0; segment < segmentCount; segment++) {
          if (lineAlphas[segment] >= SOLID_FROM) continue;
          const out = 6 * segment;
          linePositions[out + 3] = linePositions[out];
          linePositions[out + 4] = linePositions[out + 1];
          linePositions[out + 5] = linePositions[out + 2];
        }
      }
      positionBuffer.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
    },

    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}

/** Slack of the "is the point over this triangle" test, in the triangle's own edge coordinates. */
const RIM = 0.03;

/**
 * Which rigid face each triangle belongs to: triangles that share a vertex are
 * one face (the contract does not share vertices between faces).
 * @param {ArrayLike<number>} indices
 * @param {number} vertexCount
 * @returns {Int32Array} a face number per triangle
 */
function facesOfTriangles(indices, vertexCount) {
  const parent = Int32Array.from({ length: vertexCount }, (_, i) => i);
  const find = (v) => {
    while (parent[v] !== v) v = parent[v] = parent[parent[v]];
    return v;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    parent[find(indices[t + 1])] = root;
    parent[find(indices[t + 2])] = root;
  }
  return Int32Array.from({ length: indices.length / 3 }, (_, triangle) => find(indices[3 * triangle]));
}

/**
 * Adds a per-segment alpha to the wide-line shaders: every replacement must
 * find its place, or the result is null (the addon's shader text has changed).
 * @param {string} vertexShader
 * @param {string} fragmentShader
 * @returns {{ vertexShader: string, fragmentShader: string } | null}
 */
export function patchLineShaders(vertexShader, fragmentShader) {
  let ok = true;
  const swap = (source, find, replacement) => {
    if (!source.includes(find)) ok = false;
    return source.replace(find, replacement);
  };
  let vertex = swap(vertexShader, 'attribute vec3 instanceStart;', 'attribute vec3 instanceStart;\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;');
  vertex = swap(vertex, 'void main() {', 'void main() {\nvInstanceAlpha = instanceAlpha;');
  let fragment = swap(fragmentShader, 'void main() {', 'varying float vInstanceAlpha;\nvoid main() {');
  fragment = swap(fragment, 'gl_FragColor = vec4( diffuseColor.rgb, alpha );', 'gl_FragColor = vec4( diffuseColor.rgb, alpha * vInstanceAlpha );');
  return ok ? { vertexShader: vertex, fragmentShader: fragment } : null;
}

/**
 * The stock wide-line material, with one addition: a per-segment alpha so
 * creases can fade in and out individually. `userData.perSegmentAlpha` says
 * whether the addition took.
 */
function createInkMaterial() {
  const material = new LineMaterial({
    color: INK,
    linewidth: LINE_WIDTH,
    transparent: true,
    depthWrite: false,
  });
  const patched = patchLineShaders(material.vertexShader, material.fragmentShader);
  material.userData.perSegmentAlpha = patched !== null;
  if (!patched) {
    // Lines are then all of one strength; update() leaves out the faint ones instead of inking every crease.
    console.warn('[origami] could not add per-crease alpha to the line shader');
    return material;
  }
  material.vertexShader = patched.vertexShader;
  material.fragmentShader = patched.fragmentShader;
  return material;
}
