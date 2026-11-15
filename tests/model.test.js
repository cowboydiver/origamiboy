import { describe, expect, it } from 'vitest';
import { createClock, easeStep } from '../src/core/clock.js';
import { createDemoModel } from '../src/models/demo.js';
import { createModel } from '../src/models/index.js';
import { assertModel, checkModel } from '../src/origami/contract.js';
import { STEP_KINDS } from '../src/origami/types.js';
import { layOutDashes } from '../src/viewer/guides.js';

const LAYER_MIN = 0.0015;

function poseOf(model, step, t) {
  const out = new Float32Array(3 * model.vertexCount);
  model.pose(step, t, out);
  return out;
}

describe('placeholder model', () => {
  const model = createDemoModel();

  it('conforms to the contract', () => {
    const report = checkModel(model, { samplesPerStep: 16 });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('stays selectable at the swap point, and whatever is wired in by default conforms too', () => {
    const placeholder = createModel('demo');
    expect(placeholder.name).toBe(model.name);
    expect(placeholder.steps.map((step) => step.id)).toEqual(model.steps.map((step) => step.id));
    expect(() => assertModel(createModel())).not.toThrow();
  });

  it('uses only known step kinds, with unique ids', () => {
    for (const step of model.steps) expect(STEP_KINDS).toContain(step.kind);
    expect(new Set(model.steps.map((step) => step.id)).size).toBe(model.steps.length);
  });

  it('starts as a flat unit square, white side toward +Z', () => {
    const flat = poseOf(model, 0, 0);
    for (let v = 0; v < model.vertexCount; v++) {
      expect(flat[3 * v]).toBeCloseTo(model.uvs[2 * v] - 0.5, 6);
      expect(flat[3 * v + 1]).toBeCloseTo(model.uvs[2 * v + 1] - 0.5, 6);
      expect(flat[3 * v + 2]).toBe(0);
    }
  });

  it('joins consecutive steps exactly', () => {
    for (let k = 0; k + 1 < model.steps.length; k++) {
      const end = poseOf(model, k, 1);
      const start = poseOf(model, k + 1, 0);
      for (let i = 0; i < end.length; i++) expect(Math.abs(end[i] - start[i])).toBeLessThanOrEqual(1e-6);
    }
  });

  it('does not share vertices between faces', () => {
    // Every face is a fan from its first vertex, so faces are the connected
    // components of the index buffer: none may reuse another's vertices.
    const owner = new Map();
    let face = -1;
    let fanStart = -1;
    for (let i = 0; i < model.indices.length; i += 3) {
      if (model.indices[i] !== fanStart) {
        fanStart = model.indices[i];
        face++;
      }
      for (let j = 0; j < 3; j++) {
        const vertex = model.indices[i + j];
        if (owner.has(vertex)) expect(owner.get(vertex)).toBe(face);
        owner.set(vertex, face);
      }
    }
    expect(owner.size).toBe(model.vertexCount);
  });

  it('keeps stacked layers apart once folded flat', () => {
    // After each flat fold, vertices that coincide in x and y must differ in z.
    for (const step of [0, 1, 2, 3]) {
      const pose = poseOf(model, step, 1);
      const levels = new Set();
      for (let v = 0; v < model.vertexCount; v++) levels.add(Math.round(pose[3 * v + 2] * 1e5));
      const sorted = [...levels].sort((a, b) => a - b).map((z) => z / 1e5);
      expect(sorted.length).toBeGreaterThan(1);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(LAYER_MIN);
    }
  });

  it('turns over as a rigid half turn about the vertical axis', () => {
    const turn = model.steps.findIndex((step) => step.kind === 'turn-over');
    expect(turn).toBeGreaterThanOrEqual(0);
    const before = poseOf(model, turn, 0);
    const after = poseOf(model, turn, 1);
    let cz = 0;
    for (let v = 0; v < model.vertexCount; v++) cz += before[3 * v + 2] + after[3 * v + 2];
    cz /= 2 * model.vertexCount;
    for (let v = 0; v < model.vertexCount; v++) {
      expect(after[3 * v]).toBeCloseTo(-before[3 * v], 5);
      expect(after[3 * v + 1]).toBeCloseTo(before[3 * v + 1], 5);
      expect(after[3 * v + 2] - cz).toBeCloseTo(-(before[3 * v + 2] - cz), 5);
    }
    expect(model.guides(turn)).toEqual([]);
  });

  it('stays centred at every step boundary', () => {
    for (let k = 0; k < model.steps.length; k++) {
      const pose = poseOf(model, k, 1);
      for (let axis = 0; axis < 3; axis++) {
        let min = Infinity;
        let max = -Infinity;
        for (let v = 0; v < model.vertexCount; v++) {
          min = Math.min(min, pose[3 * v + axis]);
          max = Math.max(max, pose[3 * v + axis]);
        }
        expect(Math.abs((min + max) / 2)).toBeLessThan(0.02);
      }
    }
  });

  it('draws guides on the surface facing +Z at the start of their step', () => {
    for (let k = 0; k < model.steps.length; k++) {
      const pose = poseOf(model, k, 0);
      let top = -Infinity;
      for (let v = 0; v < model.vertexCount; v++) top = Math.max(top, pose[3 * v + 2]);
      for (const guide of model.guides(k)) {
        for (const point of [guide.a, guide.b]) {
          expect(point[2]).toBeGreaterThan(top);
          expect(point[2] - top).toBeLessThan(0.004);
        }
      }
    }
  });

  it('gives the same pose however it is reached (scrubbing is reversible)', () => {
    const clock = createClock(model.steps);
    const at = (time) => {
      const { index, t } = clock.locate(time);
      return Array.from(poseOf(model, index, easeStep(t)));
    };
    const reference = at(5.4321);
    at(0.2);
    at(clock.total);
    at(7.7);
    expect(at(5.4321)).toEqual(reference);
  });

  it('is cheap to pose', () => {
    const out = new Float32Array(3 * model.vertexCount);
    const start = performance.now();
    const calls = 20000;
    for (let i = 0; i < calls; i++) model.pose(i % model.steps.length, (i % 97) / 96, out);
    expect((performance.now() - start) / calls).toBeLessThan(0.5);
  });
});

describe('checkModel', () => {
  const broken = (patch) => ({ ...createDemoModel(), ...patch });

  it('reports a pose that jumps between steps', () => {
    const good = createDemoModel();
    const report = checkModel(
      broken({
        pose(step, t, out) {
          good.pose(step, t, out);
          if (step === 2) out[0] += 0.01 * (1 - t);
        },
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.errors.join('\n')).toMatch(/pose\(1, 1\) and pose\(2, 0\) differ/);
  });

  it('reports reversed winding', () => {
    const good = createDemoModel();
    const indices = Uint32Array.from(good.indices);
    [indices[1], indices[2]] = [indices[2], indices[1]];
    const report = checkModel(broken({ indices }));
    expect(report.errors.join('\n')).toMatch(/wound clockwise/);
  });

  it('reports malformed buffers and steps', () => {
    expect(checkModel(broken({ uvs: new Float32Array(3) })).ok).toBe(false);
    expect(checkModel(broken({ indices: [0, 1, 2] })).ok).toBe(false);
    expect(checkModel(broken({ steps: [] })).ok).toBe(false);
    const steps = createDemoModel().steps.map((step) => ({ ...step, kind: 'crumple' }));
    expect(checkModel(broken({ steps })).errors.join('\n')).toMatch(/not a known kind/);
  });

  it('reports a start that is not flat, and non-finite output', () => {
    const good = createDemoModel();
    const lifted = checkModel(
      broken({
        pose(step, t, out) {
          good.pose(step, t, out);
          if (step === 0) out[2] += 0.1 * (1 - t);
        },
      }),
    );
    expect(lifted.errors.join('\n')).toMatch(/not flat/);
    const lazy = checkModel(broken({ pose() {} }));
    expect(lazy.errors.join('\n')).toMatch(/non-finite/);
  });

  it('warns about stretching faces and bad guides', () => {
    const good = createDemoModel();
    const stretchy = checkModel(
      broken({
        pose(step, t, out) {
          good.pose(step, t, out);
          out[0] += 0.05 * Math.sin(Math.PI * t);
        },
      }),
    );
    expect(stretchy.ok).toBe(true);
    expect(stretchy.warnings.join('\n')).toMatch(/change length/);
    const guides = checkModel(broken({ guides: () => [{ type: 'crimp', a: [0, 0, 0], b: [1, 0] }] }));
    expect(guides.errors.join('\n')).toMatch(/'valley' or 'mountain'/);
    expect(guides.errors.join('\n')).toMatch(/three finite numbers/);
  });

  it('assertModel throws with the list of violations', () => {
    expect(() => assertModel(broken({ steps: [] }))).toThrow(/violates the contract/);
  });
});

describe('layOutDashes', () => {
  const segments = (flat) => {
    const list = [];
    for (let i = 0; i < flat.length; i += 6) list.push([flat[i], flat[i + 3]]);
    return list;
  };

  it('starts and ends a valley line on a dash, with even gaps', () => {
    const dashes = segments(layOutDashes({ type: 'valley', a: [0, 0, 0], b: [1, 0, 0] }, []));
    expect(dashes.length).toBeGreaterThan(5);
    expect(dashes[0][0]).toBe(0);
    expect(dashes.at(-1)[1]).toBeCloseTo(1, 9);
    const lengths = dashes.map(([from, to]) => to - from);
    for (const length of lengths) expect(length).toBeCloseTo(lengths[0], 9);
  });

  it('alternates long dashes and dots for a mountain line', () => {
    const marks = segments(layOutDashes({ type: 'mountain', a: [0, 0, 0], b: [1, 0, 0] }, []));
    const lengths = marks.map(([from, to]) => to - from);
    expect(marks.length % 2).toBe(1);
    for (let i = 1; i < lengths.length; i += 2) expect(lengths[i]).toBeLessThan(lengths[i - 1] / 3);
    expect(marks.at(-1)[1]).toBeCloseTo(1, 9);
  });

  it('draws a very short crease as a single dash and ignores a zero-length one', () => {
    expect(layOutDashes({ type: 'valley', a: [0, 0, 0], b: [0.01, 0, 0] }, []).length).toBe(6);
    expect(layOutDashes({ type: 'valley', a: [0, 0, 0], b: [0, 0, 0] }, [])).toEqual([]);
  });
});

describe('viewer pre-computation at the size of a real piece', () => {
  it('finds the sheet outline and the creases from uvs alone', async () => {
    const { createEdges } = await import('../src/viewer/edges.js');
    // Demo: 8 outline pieces (each side is split once) and 8 shared edges
    // (5 creases plus the 3 diagonals inside the quads).
    expect(createEdges(createDemoModel()).counts).toEqual({ creases: 8, outline: 8 });
    const { createDenseModel } = await import('./helpers/denseModel.js');
    const dense = createDenseModel(createDemoModel(), 20);
    expect(createEdges(dense).counts).toEqual({ creases: 2 * 20 * 19 + 400, outline: 80 });
  });

  it('a dense, long variant still conforms and is analysed quickly', async () => {
    const { createDenseModel } = await import('./helpers/denseModel.js');
    const { createLongModel } = await import('./helpers/longModel.js');
    const { analyseModel } = await import('../src/viewer/analysis.js');
    const model = createLongModel(createDenseModel(createDemoModel(), 20), 2);
    expect(model.steps.length).toBe(25);
    expect(model.indices.length / 3).toBe(800);
    const report = checkModel(model, { samplesPerStep: 4 });
    expect(report.errors).toEqual([]);

    const clock = createClock(model.steps);
    const start = performance.now();
    const analysis = analyseModel(model, clock);
    expect(performance.now() - start).toBeLessThan(500);
    // The first box is the flat unit square; the floor follows the model down.
    expect(Array.from(analysis.boxes.slice(0, 6))).toEqual([-0.5, -0.5, 0, 0.5, 0.5, 0]);
    expect(analysis.floorAt(0, 0)).toBeCloseTo(-0.5, 6);
    expect(analysis.floorAt(0, 1)).toBeCloseTo(-0.25, 3);
    const box = analysis.boxAt(0, 0.5, new Float32Array(6));
    expect(box[1]).toBeCloseTo(-0.375, 3);
  });
});
