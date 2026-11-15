/**
 * The parts of the 3D view that are plain arithmetic and run without a canvas:
 * fold guides that ride with the paper, the strips that close folded creases,
 * ink lines inside stacks, and the shader patches.
 */
import { describe, expect, it } from 'vitest';
import { ShaderLib } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createClock, easeStep } from '../src/core/clock.js';
import { createCraneModel } from '../src/models/crane/crane.js';
import { EPS } from '../src/models/crane/sequence.js';
import { createDemoModel } from '../src/models/demo.js';
import { GUIDE_FADE_END } from '../src/origami/types.js';
import { findAdjacency } from '../src/viewer/adjacency.js';
import { analyseModel } from '../src/viewer/analysis.js';
import { createEdges, patchLineShaders } from '../src/viewer/edges.js';
import { createFoldBacks } from '../src/viewer/foldBacks.js';
import { fitDistance } from '../src/viewer/framing.js';
import { anchorDashes, guideOpacity, guideSchedule, layOutDashes, placeDashes } from '../src/viewer/guides.js';
import { patchPaperShaders } from '../src/viewer/paperMesh.js';

const crane = createCraneModel();
const stepIndex = (id) => crane.steps.findIndex((step) => step.id === id);
const poseOf = (model, k, t) => {
  const out = new Float32Array(3 * model.vertexCount);
  model.pose(k, t, out);
  return out;
};

/** Distance from point p to the triangle (a, b, c), all [x, y, z]. */
function distanceToTriangle(p, a, b, c) {
  const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q;
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b);
    const d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = sub(p, c);
    const d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) q = b;
    else if (d6 >= 0 && d5 <= d6) q = c;
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) q = [0, 1, 2].map((i) => a[i] + (ab[i] * d1) / (d1 - d3));
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) q = [0, 1, 2].map((i) => a[i] + (ac[i] * d2) / (d2 - d6));
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) q = [0, 1, 2].map((i) => b[i] + ((c[i] - b[i]) * (d4 - d3)) / (d4 - d3 + (d5 - d6)));
    else q = [0, 1, 2].map((i) => a[i] + (ab[i] * vb + ac[i] * vc) / (va + vb + vc));
  }
  return Math.hypot(...sub(p, q));
}

function distanceToPaper(model, positions, p) {
  let best = Infinity;
  const at = (v) => [positions[3 * v], positions[3 * v + 1], positions[3 * v + 2]];
  for (let t = 0; t < model.indices.length; t += 3) {
    best = Math.min(best, distanceToTriangle(p, at(model.indices[t]), at(model.indices[t + 1]), at(model.indices[t + 2])));
  }
  return best;
}

describe('dash patterns for short creases', () => {
  const marks = (type, length) => {
    const flat = layOutDashes({ type, a: [0, 0, 0], b: [length, 0, 0] }, []);
    const list = [];
    for (let i = 0; i < flat.length; i += 6) list.push([flat[i], flat[i + 3]]);
    return list;
  };

  it('keeps a mountain crease dash-dot even when it is too short for the full-size pattern', () => {
    // The crease across the neck (0.086 long) used to come out as one solid bar.
    const neck = marks('mountain', 0.086);
    expect(neck.length).toBe(3);
    const lengths = neck.map(([from, to]) => to - from);
    expect(lengths[1]).toBeLessThan(lengths[0] / 3); // a dot between two dashes
    expect(lengths[0]).toBeCloseTo(lengths[2], 9);
    expect(neck[0][0]).toBe(0);
    expect(neck[2][1]).toBeCloseTo(0.086, 9);
    // The head crease (0.025): still dash-dot-dash, with a dot and gaps large enough to see.
    const head = marks('mountain', 0.025);
    expect(head.length).toBe(3);
    expect(head[1][1] - head[1][0]).toBeGreaterThanOrEqual(0.0035 - 1e-12);
    expect(head[1][0] - head[0][1]).toBeGreaterThanOrEqual(0.004 - 1e-12);
    expect(head[2][0] - head[1][1]).toBeGreaterThanOrEqual(0.004 - 1e-12);
  });

  it('fits at least two cycles on a crease of middling length by shrinking the pattern', () => {
    const mountain = marks('mountain', 0.15);
    expect(mountain.length).toBe(5); // dash dot dash dot dash
    const valley = marks('valley', 0.105); // the spine of the head
    expect(valley.length).toBe(3);
    for (const [from, to] of valley) expect(to - from).toBeCloseTo(valley[0][1] - valley[0][0], 9);
  });

  it('gives every crane guide a pattern that can be told from the other kind', () => {
    crane.steps.forEach((step, k) => {
      for (const guide of crane.guides(k)) {
        const count = layOutDashes(guide, []).length / 6;
        // A mountain line shows at least dash-dot-dash, a valley line at least two dashes.
        expect(count, `${step.id} ${guide.type}`).toBeGreaterThanOrEqual(guide.type === 'mountain' ? 3 : 2);
      }
    });
  });
});

describe('guides ride with the paper', () => {
  for (const [name, model] of [['crane', crane], ['demo', createDemoModel()]]) {
    it(`${name}: every dash is tied to a piece of paper and starts exactly where the model drew it`, () => {
      model.steps.forEach((step, k) => {
        const dashes = [];
        for (const guide of model.guides(k)) layOutDashes(guide, dashes);
        if (dashes.length === 0) return;
        const start = poseOf(model, k, 0);
        const anchors = anchorDashes(dashes, start, model.indices);
        expect(Array.from(anchors.triangle).every((t) => t >= 0), step.id).toBe(true);
        const placed = placeDashes(anchors, start, model.indices, new Float32Array(dashes.length));
        for (let i = 0; i < dashes.length; i++) expect(Math.abs(placed[i] - dashes[i]), step.id).toBeLessThan(1e-6);
      });
    });
  }

  it('keeps both ends of every dash on the paper for as long as it shows', () => {
    let stretched = 0;
    let total = 0;
    crane.steps.forEach((step, k) => {
      const dashes = [];
      for (const guide of crane.guides(k)) layOutDashes(guide, dashes);
      if (dashes.length === 0) return;
      const anchors = anchorDashes(dashes, poseOf(crane, k, 0), crane.indices);
      const placed = new Float32Array(dashes.length);
      for (const eased of [0.1, 0.2, 0.3, GUIDE_FADE_END]) {
        const now = poseOf(crane, k, eased);
        placeDashes(anchors, now, crane.indices, placed);
        for (let d = 0; d < dashes.length; d += 6) {
          for (const end of [0, 3]) {
            const p = [placed[d + end], placed[d + end + 1], placed[d + end + 2]];
            // Within its lift of the surface (a guide sits 0.002 above it; the wings line two layers more).
            expect(distanceToPaper(crane, now, p), `${step.id} at ${eased}`).toBeLessThan(0.002 + 2 * EPS + 1e-4);
          }
          const length = (q) => Math.hypot(q[d + 3] - q[d], q[d + 4] - q[d + 1], q[d + 5] - q[d + 2]);
          total++;
          if (Math.abs(length(placed) - length(dashes)) > 1e-3) stretched++;
        }
      }
    });
    // A dash keeps its length unless its two ends are on faces that move apart (it crosses a
    // vertex where creases meet, or bridges a hinge that opens by the thickness of the paper).
    expect(total).toBeGreaterThan(1000);
    expect(stretched / total).toBeLessThan(0.08);
  });

  it('where the paper moves away, a guide left where it was drawn would hang in the air', () => {
    // The collapse stands the whole sheet up: this is what the guides used to do.
    const k = stepIndex('preliminary-base');
    const dashes = [];
    for (const guide of crane.guides(k)) layOutDashes(guide, dashes);
    const now = poseOf(crane, k, 0.3);
    let farthest = 0;
    for (let d = 0; d < dashes.length; d += 3) farthest = Math.max(farthest, distanceToPaper(crane, now, [dashes[d], dashes[d + 1], dashes[d + 2]]));
    expect(farthest).toBeGreaterThan(0.1);
  });

  it('carries the mountain guides of a petal fold up with the flap', () => {
    const k = stepIndex('petal-fold-1');
    const guides = crane.guides(k).filter((g) => g.type === 'mountain');
    const dashes = [];
    for (const guide of guides) layOutDashes(guide, dashes);
    const anchors = anchorDashes(dashes, poseOf(crane, k, 0), crane.indices);
    const placed = placeDashes(anchors, poseOf(crane, k, 0.25), crane.indices, new Float32Array(dashes.length));
    // The lower ends of the two lines (at the bottom corner of the flap) have come well toward the viewer.
    let lowest = 0;
    for (let d = 0; d < dashes.length; d += 3) if (dashes[d + 1] < dashes[lowest + 1]) lowest = d;
    expect(placed[lowest + 2] - dashes[lowest + 2]).toBeGreaterThan(0.05);
  });
});

describe('when guides show', () => {
  it('fades the guides of a step out by GUIDE_FADE_END', () => {
    expect(guideOpacity(0)).toBe(1);
    expect(guideOpacity(GUIDE_FADE_END / 2)).toBeCloseTo(0.5, 9);
    expect(guideOpacity(GUIDE_FADE_END)).toBe(0);
    expect(guideOpacity(1)).toBe(0);
  });

  it('fades the next step\'s guides in over the last moments of a step, so they do not pop in', () => {
    const count = crane.steps.length;
    crane.steps.forEach((step, k) => {
      const at = (t) => guideSchedule(k, t, easeStep(t), step.duration, count);
      expect(at(0)).toEqual({ step: k, opacity: 1 });
      if (k + 1 === count) {
        expect(at(1)).toEqual({ step: k, opacity: 0 });
        return;
      }
      // At the boundary the next step's guides are fully there: no jump when the step changes.
      expect(at(1)).toEqual({ step: k + 1, opacity: 1 });
      // They begin from nothing, a fraction of a second before, when this step's own are long gone.
      const lead = 0.22 / step.duration;
      const before = at(1 - lead - 1e-6);
      expect(before).toEqual({ step: k, opacity: 0 });
      const just = at(1 - lead + 1e-6);
      expect(just.step).toBe(k + 1);
      expect(just.opacity).toBeLessThan(1e-6);
      // Rising steadily in between.
      let last = 0;
      for (let i = 1; i <= 10; i++) {
        const now = at(1 - lead + (lead * i) / 10);
        expect(now.opacity).toBeGreaterThan(last);
        last = now.opacity;
      }
      // They are drawn for the start of the next step but ride on the paper as it is now,
      // still a moment short of that pose: every dash end lies on it all the same.
      const dashes = [];
      for (const guide of crane.guides(k + 1)) layOutDashes(guide, dashes);
      if (dashes.length === 0) return;
      const anchors = anchorDashes(dashes, poseOf(crane, k + 1, 0), crane.indices);
      const now = poseOf(crane, k, easeStep(1 - lead));
      const placed = placeDashes(anchors, now, crane.indices, new Float32Array(dashes.length));
      for (let d = 0; d < dashes.length; d += 3) {
        expect(distanceToPaper(crane, now, [placed[d], placed[d + 1], placed[d + 2]]), step.id).toBeLessThan(0.002 + 2 * EPS + 1e-4);
      }
    });
  });
});

describe('the backs of folds', () => {
  const foldBacks = createFoldBacks(crane, undefined);
  const { creases } = findAdjacency(crane);
  const real = creases.filter((c) => c.a !== c.a2);
  const index = foldBacks.mesh.geometry.getIndex().array;
  const area = (P) => {
    let total = 0;
    for (let i = 0; i < index.length; i += 3) {
      const [a, b, c] = [3 * index[i], 3 * index[i + 1], 3 * index[i + 2]];
      const u = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
      const v = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      total += 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    }
    return total;
  };

  it('has one strip per crease between two faces and none for the diagonals inside a face', () => {
    expect(foldBacks.count).toBe(real.length);
    expect(real.length).toBeGreaterThan(100);
    expect(creases.length).toBeGreaterThan(real.length);
    expect(index.length).toBe(18 * real.length);
  });

  it('has no area on the flat sheet', () => {
    foldBacks.update(poseOf(crane, 0, 0));
    expect(area(foldBacks.positions)).toBeLessThan(1e-9);
  });

  /** Per strip at the pose P: the gap it bridges, how far it bulges, and which side of the paper is outside. */
  const measure = (P) => {
    foldBacks.update(P);
    const S = foldBacks.positions;
    return real.map((crease, i) => {
      const at = (n) => [S[24 * i + 3 * n], S[24 * i + 3 * n + 1], S[24 * i + 3 * n + 2]];
      const of = (v) => [P[3 * v], P[3 * v + 1], P[3 * v + 2]];
      const minus = (p, q) => p.map((x, d) => x - q[d]);
      const [a, b, c, a2] = [of(crease.a), of(crease.b), of(crease.c), of(crease.a2)];
      const u = minus(b, a);
      const v = minus(c, a);
      const white = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const across = minus(a2, a);
      // Folded flat: the neighbour's white side faces the other way.
      const [p, q, r] = [of(crease.a2), of(crease.b2), of(crease.c2)];
      const u2 = minus(r, q);
      const v2 = minus(p, q);
      // The neighbour runs b2 -> a2 -> c2 counter-clockwise as seen from its white side.
      const white2 = [v2[1] * u2[2] - v2[2] * u2[1], v2[2] * u2[0] - v2[0] * u2[2], v2[0] * u2[1] - v2[1] * u2[0]];
      const cos = (white[0] * white2[0] + white[1] * white2[1] + white[2] * white2[2]) / (Math.hypot(...white) * Math.hypot(...white2));
      return {
        folded: cos < -0.99,
        crease,
        at,
        of,
        gap: Math.hypot(...across),
        bulge: Math.hypot(...minus(at(2), at(0))),
        span: Math.hypot(...minus(at(4), at(2))),
        whiteOut: across[0] * white[0] + across[1] * white[1] + across[2] * white[2] < 0,
      };
    });
  };

  it('bridges every folded crease whose outside is coloured from one face to the other', () => {
    const P = poseOf(crane, stepIndex('head'), 1);
    const rows = measure(P);
    let bridged = 0;
    for (const row of rows) {
      // Every strip starts on the first face's own edge.
      expect(row.at(0)).toEqual(row.of(row.crease.a));
      expect(row.at(1)).toEqual(row.of(row.crease.b));
      if (!row.folded || row.whiteOut) continue;
      bridged++;
      // ... ends on the second face's, and its middle spans exactly the gap between them.
      expect(row.at(6)).toEqual(row.of(row.crease.a2));
      expect(row.at(7)).toEqual(row.of(row.crease.b2));
      expect(row.span).toBeCloseTo(row.gap, 6);
      // It stands out of the fold by a fraction of the gap, never by more than 0.003.
      expect(row.bulge).toBeGreaterThan(0.04 * row.gap);
      expect(row.bulge).toBeLessThan(0.25 * row.gap);
      expect(row.bulge).toBeLessThan(0.003);
    }
    expect(bridged).toBeGreaterThan(60);
    expect(area(foldBacks.positions)).toBeGreaterThan(0.005);
  });

  it('leaves a fold open whose outside is white, once it is folded flat', () => {
    // The second diagonal is creased with the coloured side up: folded flat, white is outside.
    const k = stepIndex('diagonal-2');
    const flat = measure(poseOf(crane, k, 0.5));
    const folded = flat.filter((row) => row.folded);
    expect(folded.length).toBeGreaterThan(0);
    for (const row of folded) expect(row.whiteOut).toBe(true);
    expect(area(foldBacks.positions)).toBeLessThan(1e-9);
    // The first book crease is made white side up: colour outside, and its strip is there.
    measure(poseOf(crane, stepIndex('book-1'), 0.5));
    expect(area(foldBacks.positions)).toBeGreaterThan(0.0018);
    // In the finished flat model, the white-out folds (there are some deep inside) have no area either.
    const end = measure(poseOf(crane, stepIndex('head'), 1));
    const S = foldBacks.positions;
    let open = 0;
    end.forEach((row, i) => {
      if (!row.whiteOut || !row.folded) return;
      open++;
      for (let n = 0; n < 8; n += 2) for (let d = 0; d < 3; d++) expect(S[24 * i + 3 * n + d]).toBe(S[24 * i + d]);
    });
    expect(open).toBeGreaterThan(5);
  });

  it('bulges a wider fold more than a narrower one, so folds nested on one line stay in order', () => {
    const rows = measure(poseOf(crane, stepIndex('head'), 1)).filter((row) => row.folded && !row.whiteOut);
    rows.sort((p, q) => p.gap - q.gap);
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].gap - rows[i - 1].gap < 1e-6) continue;
      // By enough for the depth buffer to tell them apart at the default distance (about 1e-5).
      expect(rows[i].bulge - rows[i - 1].bulge).toBeGreaterThan(4e-5);
    }
  });

  it('closes the spine of a reverse fold while it stands open', () => {
    // Half way through the neck the hinges along the spine gape by the thickness of the opened
    // half (0.03): the strips bridge them, so the spine does not show as a dark slit.
    const rows = measure(poseOf(crane, stepIndex('neck'), 0.44));
    const wide = rows.filter((row) => row.gap > 0.02);
    expect(wide.length).toBeGreaterThan(0);
    for (const row of wide) {
      expect(row.span).toBeCloseTo(row.gap, 6);
      expect(row.at(6)).toEqual(row.of(row.crease.a2));
    }
  });
});

describe('ink lines inside a stack', () => {
  const edges = createEdges(crane);
  const clock = createClock(crane.steps);
  analyseModel(crane, clock, { observe: edges.observe });
  const { creases, outline } = edges.counts;
  const alphas = edges.object.geometry.getAttribute('instanceAlpha').array;
  const starts = edges.object.geometry.getAttribute('instanceStart').data.array;

  it('draws the raw edge at full strength where it lies open', () => {
    edges.update(poseOf(crane, 0, 0), 0);
    for (let i = creases; i < creases + outline; i++) expect(alphas[i]).toBeCloseTo(0.8, 6);
    // Folded in half: two layers, both of them outermost.
    const k = stepIndex('book-1');
    edges.update(poseOf(crane, k, 0.5), clock.timeAt(k, 0.5));
    for (let i = creases; i < creases + outline; i++) expect(alphas[i]).toBeCloseTo(0.8, 6);
  });

  it('draws at most the two outermost of the crease lines that lie on one line in a closed stack', () => {
    const k = stepIndex('head');
    edges.update(poseOf(crane, k, 1), clock.timeAt(k, 1));
    // Group the inked crease lines by where they are in the plane of the model.
    const groups = new Map();
    let inked = 0;
    for (let i = 0; i < creases; i++) {
      if (alphas[i] === 0) continue;
      inked++;
      const ends = [[starts[6 * i], starts[6 * i + 1]], [starts[6 * i + 3], starts[6 * i + 4]]].map(([x, y]) => `${Math.round(x * 2e3)},${Math.round(y * 2e3)}`).sort();
      const key = ends.join('|');
      (groups.get(key) ?? groups.set(key, []).get(key)).push({ z: starts[6 * i + 2], alpha: alphas[i] });
    }
    let stacks = 0;
    let strong = 0;
    for (const list of groups.values()) {
      // Within a group, a stack is a run of lines no more than a couple of layers apart.
      list.sort((p, q) => p.z - q.z);
      let run = [];
      const close = () => {
        if (run.length >= 2) stacks++;
        const full = run.filter((line) => line.alpha > 0.4).length;
        expect(full).toBeLessThanOrEqual(2);
        strong += full;
        run = [];
      };
      for (const line of list) {
        if (run.length && line.z - run[run.length - 1].z > 0.0045) close();
        run.push(line);
      }
      close();
    }
    expect(stacks).toBeGreaterThan(20);
    // Most of the lines of the folded model are inside a stack: only a few are drawn at full strength.
    expect(inked).toBeGreaterThan(150);
    expect(strong).toBeLessThan(0.25 * inked);
  });
});

describe('shader patches against the installed three.js', () => {
  it('adds the per-segment alpha to the wide-line shaders', () => {
    const material = new LineMaterial();
    const patched = patchLineShaders(material.vertexShader, material.fragmentShader);
    expect(patched).not.toBeNull();
    expect(patched.vertexShader).toContain('attribute float instanceAlpha;');
    expect(patched.vertexShader).toContain('vInstanceAlpha = instanceAlpha;');
    expect(patched.fragmentShader).toContain('varying float vInstanceAlpha;');
    expect(patched.fragmentShader).toContain('alpha * vInstanceAlpha');
    expect(createEdges(crane).object.material.userData.perSegmentAlpha).toBe(true);
  });

  it('reports a line shader it cannot patch instead of half patching it', () => {
    const material = new LineMaterial();
    expect(patchLineShaders(material.vertexShader, 'void main() { gl_FragColor = vec4( 1.0 ); }')).toBeNull();
    expect(patchLineShaders('void main() {}', material.fragmentShader)).toBeNull();
  });

  it('adds the two paper colours to the Lambert shader', () => {
    const shader = { vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    expect(patchPaperShaders(shader)).toBe(true);
    expect(shader.vertexShader).toContain('vPaperUv = uv;');
    expect(shader.fragmentShader).toContain('gl_FrontFacing ? uPaperWhite : uPaperColour');
    expect(shader.fragmentShader).toContain('float paperGrain(vec2 uv)');
  });

  it('leaves a shader it cannot patch alone', () => {
    const shader = { vertexShader: 'void main() {}', fragmentShader: 'void main() {}' };
    expect(patchPaperShaders(shader)).toBe(false);
    expect(shader).toEqual({ vertexShader: 'void main() {}', fragmentShader: 'void main() {}' });
  });
});

describe('fitting below a band kept free', () => {
  it('moves the camera back just enough for the smaller picture', () => {
    const full = fitDistance(0.5, 30, 1.6);
    const reduced = fitDistance(0.5, 30, 1.6, 0.8);
    expect(reduced).toBeGreaterThan(full);
    // On a narrow canvas the width decides, and a band at the top changes nothing.
    expect(fitDistance(0.5, 30, 0.5, 0.8)).toBe(fitDistance(0.5, 30, 0.5));
  });
});
