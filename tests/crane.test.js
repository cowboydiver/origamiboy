/**
 * The crane, tested through the public model contract only (plus the dev
 * tooling in scripts/lib, which also sees nothing but the contract).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createClock, easeStep } from '../src/core/clock.js';
import { buildCraneModel, createCraneModel } from '../src/models/crane/crane.js';
import { EPS } from '../src/models/crane/sequence.js';
import { DEFAULT_MODEL, MODEL_NAMES, createModel } from '../src/models/index.js';
import { checkModel } from '../src/origami/contract.js';
import { GUIDE_FADE_END } from '../src/origami/types.js';
import { HOME_AZIMUTH_DEG } from '../src/viewer/framing.js';
import { withFoldBacks } from './helpers/foldBacks.js';
import { LIMITS, verdict } from '../scripts/lib/limits.js';
import { HOME_VIEW, analyseModel, visibleWhiteFraction } from '../scripts/lib/metrics.js';
import { endTravel, speedProfile } from '../scripts/lib/motion.js';
import { creaseSenseHistory, guideSense } from '../scripts/lib/sense.js';

const model = createCraneModel();
const stepIndex = (id) => model.steps.findIndex((step) => step.id === id);
const poseOf = (k, t) => {
  const out = new Float32Array(3 * model.vertexCount);
  model.pose(k, t, out);
  return out;
};
const maxDiff = (a, b) => {
  let most = 0;
  for (let i = 0; i < a.length; i++) most = Math.max(most, Math.abs(a[i] - b[i]));
  return most;
};

describe('crane: the model contract', () => {
  it('passes the project contract check with no errors and no warnings', () => {
    const report = checkModel(model, { samplesPerStep: 16 });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('exposes exactly the contract, nothing else', () => {
    expect(Object.keys(model).sort()).toEqual(['guides', 'indices', 'name', 'pose', 'steps', 'uvs', 'vertexCount']);
    for (const step of model.steps) expect(Object.keys(step).sort()).toEqual(['description', 'duration', 'id', 'kind', 'title']);
    // Tooling gets at the internals through a separate door.
    const built = buildCraneModel();
    expect(Object.keys(built.model).sort()).toEqual(Object.keys(model).sort());
    expect(built.internals.core.faces.length).toBeGreaterThan(50);
  });

  it('is the sequence of the traditional crane, with words for every step', () => {
    expect(model.steps.map((step) => step.id)).toEqual([
      'book-1', 'book-2', 'turn-over-1', 'diagonal-1', 'diagonal-2', 'preliminary-base',
      'kite-crease-1', 'top-crease-1', 'petal-fold-1', 'turn-over-2',
      'kite-crease-2', 'top-crease-2', 'petal-fold-2',
      'narrow-1', 'turn-over-3', 'narrow-2', 'neck', 'tail', 'head', 'wings',
    ]);
    for (const step of model.steps) {
      expect(step.title.length).toBeGreaterThan(5);
      expect(step.description.length).toBeGreaterThan(20);
    }
  });

  it('pre-creases with the white side up first, then turns over for the diagonals', () => {
    const whiteUp = (k) => {
      const p = poseOf(k, 0);
      const [a, b, c] = [model.indices[0], model.indices[1], model.indices[2]];
      return (p[3 * b] - p[3 * a]) * (p[3 * c + 1] - p[3 * a + 1]) - (p[3 * b + 1] - p[3 * a + 1]) * (p[3 * c] - p[3 * a]) > 0;
    };
    expect(whiteUp(stepIndex('book-1'))).toBe(true);
    expect(whiteUp(stepIndex('book-2'))).toBe(true);
    expect(whiteUp(stepIndex('diagonal-1'))).toBe(false);
    expect(whiteUp(stepIndex('diagonal-2'))).toBe(false);
    expect(whiteUp(stepIndex('preliminary-base'))).toBe(false);
  });

  it('gives the same pose however it is reached, and from a second instance', () => {
    const other = createCraneModel();
    const out = new Float32Array(3 * model.vertexCount);
    for (const [k, t] of [[5, 0.37], [16, 0.5], [18, 0.81], [19, 1], [0, 0]]) {
      const reference = poseOf(k, t);
      model.pose((k + 7) % model.steps.length, 0.2, out);
      model.guides(k);
      expect(maxDiff(poseOf(k, t), reference)).toBe(0);
      other.pose(k, t, out);
      expect(maxDiff(out, reference)).toBe(0);
    }
  });

  it('is cheap to build and to pose', () => {
    const start = performance.now();
    createCraneModel();
    expect(performance.now() - start).toBeLessThan(400);
    const out = new Float32Array(3 * model.vertexCount);
    const calls = 4000;
    const before = performance.now();
    for (let i = 0; i < calls; i++) model.pose(i % model.steps.length, (i % 97) / 96, out);
    expect((performance.now() - before) / calls).toBeLessThan(0.5);
  });
});

describe('crane: range guards', () => {
  const last = model.steps.length - 1;

  it('clamps a step index outside the sequence, like the placeholder model', () => {
    expect(maxDiff(poseOf(-1, 0.3), poseOf(0, 0.3))).toBe(0);
    expect(maxDiff(poseOf(-Infinity, 0.3), poseOf(0, 0.3))).toBe(0);
    expect(maxDiff(poseOf(99, 0.3), poseOf(last, 0.3))).toBe(0);
    expect(maxDiff(poseOf(Infinity, 0.3), poseOf(last, 0.3))).toBe(0);
    expect(maxDiff(poseOf(NaN, 0.3), poseOf(0, 0.3))).toBe(0);
    expect(maxDiff(poseOf(undefined, 0.3), poseOf(0, 0.3))).toBe(0);
    expect(maxDiff(poseOf(3.9, 0.3), poseOf(3, 0.3))).toBe(0);
  });

  it('clamps t to [0, 1] and never writes a non-finite coordinate', () => {
    for (let k = 0; k <= last; k++) {
      expect(maxDiff(poseOf(k, -0.5), poseOf(k, 0))).toBe(0);
      expect(maxDiff(poseOf(k, 1.5), poseOf(k, 1))).toBe(0);
      expect(maxDiff(poseOf(k, NaN), poseOf(k, 0))).toBe(0);
      for (const t of [-1, 0, 1e-9, 0.5, 1 - 1e-9, 1, 2, NaN, Infinity]) {
        expect(poseOf(k, t).every(Number.isFinite)).toBe(true);
      }
    }
  });

  it('has no guides outside the sequence', () => {
    for (const k of [-1, last + 1, 99, 1.5, NaN, Infinity, undefined, null, '3']) expect(model.guides(k)).toEqual([]);
  });
});

describe('crane: the swap point', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the crane by default and keeps the placeholder selectable', () => {
    expect(DEFAULT_MODEL).toBe('crane');
    expect(MODEL_NAMES).toEqual(['crane', 'demo']);
    expect(createModel().name).toBe(model.name);
    expect(createModel('crane').name).toBe(model.name);
    expect(createModel('demo').name).toBe('Practice folds');
    expect(createModel('no-such-model').name).toBe(model.name);
    expect(createModel('constructor').name).toBe(model.name);
  });

  it('reads ?model=demo from the page address', () => {
    vi.stubGlobal('location', { search: '?model=demo' });
    expect(createModel().name).toBe('Practice folds');
    vi.stubGlobal('location', { search: '?speed=2' });
    expect(createModel().name).toBe(model.name);
    vi.stubGlobal('location', { search: '' });
    expect(createModel().name).toBe(model.name);
  });
});

describe('crane: fold guides', () => {
  const summary = (k) =>
    model
      .guides(k)
      .map((g) => g.type)
      .sort()
      .join(' ');

  it('draws whole lines: the expected creases of every step and none for a turn-over', () => {
    const expected = {
      'book-1': 'valley',
      'book-2': 'valley',
      'turn-over-1': '',
      'diagonal-1': 'valley',
      'diagonal-2': 'valley',
      // Two straight creases as mountains, one diagonal as a valley: three whole lines through the centre.
      'preliminary-base': 'mountain mountain valley',
      'kite-crease-1': 'valley valley',
      'top-crease-1': 'valley',
      'petal-fold-1': 'mountain mountain valley',
      'turn-over-2': '',
      'kite-crease-2': 'valley valley',
      'top-crease-2': 'valley',
      'petal-fold-2': 'mountain mountain valley',
      'narrow-1': 'valley valley',
      'turn-over-3': '',
      'narrow-2': 'valley valley',
      // Reverse folds: the crease across the point (mountain) and the spine that turns inside out (valley).
      neck: 'mountain valley',
      tail: 'mountain valley',
      head: 'mountain valley',
      wings: 'valley',
    };
    model.steps.forEach((step, k) => expect(`${step.id}: ${summary(k)}`).toBe(`${step.id}: ${expected[step.id]}`));
  });

  it('runs the collapse guides corner to corner and edge to edge', () => {
    const guides = model.guides(stepIndex('preliminary-base'));
    const length = (g) => Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]);
    for (const g of guides.filter((x) => x.type === 'mountain')) expect(length(g)).toBeCloseTo(1, 6);
    const valley = guides.find((x) => x.type === 'valley');
    expect(length(valley)).toBeCloseTo(Math.SQRT2, 6);
    // The diagonal that folds inward runs from top left to bottom right as the viewer sees it.
    expect(Math.sign(valley.b[0] - valley.a[0])).toBe(-Math.sign(valley.b[1] - valley.a[1]));
  });

  it('runs a reverse-fold spine guide from the tip of the point to the crease', () => {
    for (const id of ['neck', 'tail', 'head']) {
      const guides = model.guides(stepIndex(id));
      const spine = guides.find((g) => g.type === 'valley');
      const crease = guides.find((g) => g.type === 'mountain');
      const ends = [spine.a, spine.b];
      const meet = Math.min(...ends.flatMap((p) => [crease.a, crease.b].map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));
      expect(meet).toBeLessThan(1e-6); // they share the vertex of the reverse fold
      expect(Math.hypot(spine.b[0] - spine.a[0], spine.b[1] - spine.a[1])).toBeGreaterThan(0.1);
    }
  });

  it('puts every guide just above the surface seen from +Z at the start of its step', () => {
    const ix = model.indices;
    model.steps.forEach((step, k) => {
      const P = poseOf(k, 0);
      const top = (x, y) => {
        let best = -Infinity;
        for (let t = 0; t < ix.length; t += 3) {
          const a = 3 * ix[t], b = 3 * ix[t + 1], c = 3 * ix[t + 2];
          const d = (P[b] - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (P[b + 1] - P[a + 1]);
          if (Math.abs(d) < 1e-12) continue;
          const u = ((x - P[a]) * (P[c + 1] - P[a + 1]) - (P[c] - P[a]) * (y - P[a + 1])) / d;
          const v = ((P[b] - P[a]) * (y - P[a + 1]) - (x - P[a]) * (P[b + 1] - P[a + 1])) / d;
          if (u < 0 || v < 0 || u + v > 1) continue;
          best = Math.max(best, P[a + 2] + u * (P[b + 2] - P[a + 2]) + v * (P[c + 2] - P[a + 2]));
        }
        return best;
      };
      for (const g of model.guides(k)) {
        expect(g.a[2]).toBe(g.b[2]);
        const dx = g.b[0] - g.a[0];
        const dy = g.b[1] - g.a[1];
        const L = Math.hypot(dx, dy);
        expect(L).toBeGreaterThan(0.02);
        for (const f of [0.05, 0.25, 0.5, 0.75, 0.95]) {
          const x = g.a[0] + dx * f;
          const y = g.a[1] + dy * f;
          // The surface either side of the line (a spine guide runs along an edge).
          const z = Math.max(top(x - (dy / L) * 1e-3, y + (dx / L) * 1e-3), top(x + (dy / L) * 1e-3, y - (dx / L) * 1e-3));
          const lift = g.a[2] - z;
          // 0.002 above the surface. One line is exempt, by name: the wings crease is a single
          // straight guide across two layers of different height, and sits two layers (0.0056)
          // above the lower one.
          expect(lift, `${step.id} ${g.type} at ${f}`).toBeGreaterThan(0.002 - 1e-5);
          expect(lift, `${step.id} ${g.type} at ${f}`).toBeLessThan(step.id === 'wings' ? 0.002 + 2 * EPS + 1e-5 : 0.002 + 1e-5);
        }
      }
    });
  });

  it('hands out fresh copies', () => {
    const k = stepIndex('preliminary-base');
    const first = model.guides(k);
    first[0].a[0] = 99;
    first[0].type = 'crimp';
    first.pop();
    expect(model.guides(k).length).toBe(3);
    expect(model.guides(k)[0].a[0]).not.toBe(99);
    expect(model.guides(k)[0].type).not.toBe('crimp');
  });
});

describe('crane: fold sense, measured on the animated paper', () => {
  const history = creaseSenseHistory(model);
  const row = (id) => history.find((r) => r.id === id);

  it('makes the pre-creases in the sense the collapse uses them', () => {
    const collapse = row('preliminary-base');
    expect(collapse.folded).toBeGreaterThan(15); // four half book creases and two half diagonals, in pieces
    expect(collapse.fresh).toBe(0); // every crease the collapse folds was pre-creased...
    expect(collapse.reversals).toBe(0); // ...and in the same sense
    for (const id of ['book-1', 'book-2', 'diagonal-1', 'diagonal-2']) {
      expect(row(id).folded).toBeGreaterThan(0);
      expect(row(id).fresh).toBe(row(id).folded);
    }
  });

  it('only ever reverses a crease where the traditional sequence does', () => {
    const reversing = history.filter((r) => r.reversals > 0).map((r) => r.id);
    // - petal folds: the two kite pre-creases of the top layer turn from valleys into mountains;
    // - top-crease-2: the second side is creased through layers the first side creased the other way;
    // - neck, tail, head: an inside reverse fold turns the spine of its point inside out
    //   (the head does it to the tip of the neck's spine a second time).
    expect(reversing).toEqual(['petal-fold-1', 'top-crease-2', 'petal-fold-2', 'neck', 'tail', 'head']);
    const kite = 2 * Math.hypot((Math.SQRT2 - 1) / 2, 0.5);
    expect(row('petal-fold-1').reversalLength).toBeCloseTo(kite, 6);
    expect(row('petal-fold-2').reversalLength).toBeCloseTo(kite, 6);
    // Exactly the spine of each point, from the vertex of the reverse fold to the tip, and nothing else.
    const { PAR } = buildCraneModel().internals;
    expect(row('neck').reversalLength).toBeCloseTo(PAR.ys, 6);
    expect(row('tail').reversalLength).toBeCloseTo(PAR.ys, 6);
    expect(row('head').reversalLength).toBeCloseTo(PAR.dh, 6);
  });

  it('reads the sense of a reverse fold the same however finely the step is sampled', () => {
    // The spine of a reverse fold opens one way and closes the other; the probe goes by how it closes.
    for (const samples of [40, 80, 123]) {
      const rows = creaseSenseHistory(model, samples);
      expect(rows.filter((r) => r.reversals > 0).map((r) => r.id), `${samples} samples`).toEqual(['petal-fold-1', 'top-crease-2', 'petal-fold-2', 'neck', 'tail', 'head']);
    }
  });

  it('labels every guide of every step the way the paper then folds', () => {
    const results = guideSense(model);
    const wrong = results.filter((r) => r.verdict !== 'ok' && r.verdict !== 'ok-reversal');
    expect(wrong.map((r) => `${r.id} guide ${r.guide} (${r.type}) at ${r.at}: ${r.verdict}${r.actual ? ', folds as a ' + r.actual : ''}`)).toEqual([]);
    // Every guide of every step was looked at, at five points each.
    const guideCount = model.steps.reduce((sum, _, k) => sum + model.guides(k).length, 0);
    expect(results.length).toBe(5 * guideCount);
    // The spine guides are the creases that turn inside out; everything else folds from flat.
    const reversal = new Set(results.filter((r) => r.verdict === 'ok-reversal').map((r) => r.id));
    expect([...reversal]).toEqual(['neck', 'tail', 'head']);
  });

  it('the checker itself notices a wrong label', () => {
    const k = stepIndex('preliminary-base');
    const flipped = { ...model, guides: (i) => model.guides(i).map((g) => (i === k ? { ...g, type: g.type === 'valley' ? 'mountain' : 'valley' } : g)) };
    const wrong = guideSense(flipped).filter((r) => r.verdict === 'wrong');
    expect(wrong.length).toBe(15);
    expect(new Set(wrong.map((r) => r.id))).toEqual(new Set(['preliminary-base']));
  });
});

describe('crane: timing (the viewer eases each step once)', () => {
  const profiles = model.steps.map((_, k) => ({
    linear: speedProfile(model, k),
    eased: speedProfile(model, k, { timing: easeStep }),
  }));

  it('does not ease the ends of a step itself', () => {
    model.steps.forEach((step, k) => {
      const { linear } = profiles[k];
      expect(linear.start, `${step.id} start`).toBeGreaterThan(0.25 * linear.mean);
      expect(linear.end, `${step.id} end`).toBeGreaterThan(0.25 * linear.mean);
    });
  });

  it('moves simple folds and turn-overs at an even pace', () => {
    model.steps.forEach((step, k) => {
      if (step.kind !== 'fold' && step.kind !== 'turn-over') return;
      const { linear } = profiles[k];
      expect(linear.peak / linear.mean, step.id).toBeLessThan(1.01);
    });
  });

  it('starts and ends every step at rest once the viewer has eased it', () => {
    model.steps.forEach((step, k) => {
      const { eased } = profiles[k];
      expect(eased.start, `${step.id} start`).toBeLessThan(0.03 * eased.peak);
      expect(eased.end, `${step.id} end`).toBeLessThan(0.03 * eased.peak);
    });
  });

  it('never snaps: the speed stays finite right up to both ends of every step', () => {
    // With a finite speed the travel over the last h of the step shrinks like h (ratio 0.1 here);
    // a fold that snaps shut shrinks only like sqrt(h) (ratio 0.32).
    model.steps.forEach((step, k) => {
      for (const atStart of [false, true]) {
        const ratio = endTravel(model, k, 1e-3, atStart) / endTravel(model, k, 1e-2, atStart);
        expect(ratio, `${step.id} ${atStart ? 'start' : 'end'}`).toBeGreaterThan(0.08);
        expect(ratio, `${step.id} ${atStart ? 'start' : 'end'}`).toBeLessThan(0.13);
      }
    });
  });

  it('has no kinks: the speed changes smoothly through every step', () => {
    model.steps.forEach((step, k) => {
      for (const which of ['linear', 'eased']) {
        const p = profiles[k][which];
        expect(p.maxJump, `${step.id} ${which} at ${p.maxJumpAt}`).toBeLessThan(0.08 * p.peak);
      }
    });
  });

  it('a fold-and-unfold rests folded flat half way and retraces its path', () => {
    model.steps.forEach((step, k) => {
      if (step.kind !== 'fold-unfold') return;
      expect(maxDiff(poseOf(k, 1), poseOf(k, 0)), step.id).toBe(0);
      for (const t of [0.1, 0.25, 0.4]) expect(maxDiff(poseOf(k, t), poseOf(k, 1 - t)), step.id).toBeLessThan(1e-6);
      // Flat at the half-way point: every triangle normal is parallel to z.
      const P = poseOf(k, 0.5);
      for (let t = 0; t < model.indices.length; t += 3) {
        const a = 3 * model.indices[t], b = 3 * model.indices[t + 1], c = 3 * model.indices[t + 2];
        const nx = (P[b + 1] - P[a + 1]) * (P[c + 2] - P[a + 2]) - (P[b + 2] - P[a + 2]) * (P[c + 1] - P[a + 1]);
        const ny = (P[b + 2] - P[a + 2]) * (P[c] - P[a]) - (P[b] - P[a]) * (P[c + 2] - P[a + 2]);
        expect(Math.hypot(nx, ny), step.id).toBeLessThan(1e-7);
      }
      const { linear } = profiles[k];
      const middle = linear.speed[linear.speed.length / 2];
      expect(middle, step.id).toBeLessThan(0.02 * linear.peak);
    });
  });

  it('keeps the paper where the guides were drawn until they have faded', () => {
    // Guides sit where the creases are at the start of the step and fade out by GUIDE_FADE_END
    // (the one constant the viewer and the models share). A fold-and-unfold never re-centres;
    // other steps do so only after that.
    expect(GUIDE_FADE_END).toBeGreaterThan(0.2);
    expect(GUIDE_FADE_END).toBeLessThan(0.5);
    const { internals } = buildCraneModel();
    const { faces } = internals.core;
    model.steps.forEach((step, k) => {
      if (step.kind === 'turn-over') return;
      const phase = internals.core.steps[k].phases[0];
      const still = faces.findIndex((f) => f.grp[phase.id] === 0);
      const start = poseOf(k, 0);
      for (const t of step.kind === 'fold-unfold' ? [0.2, 0.5, 0.8] : [0.1, 0.2, 0.3, GUIDE_FADE_END]) {
        const now = poseOf(k, t);
        // A face of the static group does not move sideways (it may settle in height as layers pile up).
        for (let v = internals.first[still]; v < internals.first[still + 1]; v++) {
          if (step.id === 'preliminary-base') continue; // every sector of the collapse moves
          expect(Math.hypot(now[3 * v] - start[3 * v], now[3 * v + 1] - start[3 * v + 1]), `${step.id} t=${t}`).toBeLessThan(1e-6);
        }
      }
    });
  });

  it('ends centred on the finished piece', () => {
    const P = poseOf(model.steps.length - 1, 1);
    for (const axis of [0, 1]) {
      let min = Infinity;
      let max = -Infinity;
      for (let v = 0; v < model.vertexCount; v++) {
        min = Math.min(min, P[3 * v + axis]);
        max = Math.max(max, P[3 * v + axis]);
      }
      expect(Math.abs((min + max) / 2)).toBeLessThan(1e-6);
    }
  });
});

describe('crane: physical validity through the contract', () => {
  /** @type {ReturnType<typeof analyseModel>} */
  let report;
  beforeAll(() => {
    report = analyseModel(model, { N: 81, fine: 1000, timingCalls: 0, whiteDirs: 60, selfTest: false, model2: createCraneModel() });
  }, 60_000);

  it('passes every hard limit of the validator', () => {
    expect(verdict(report).failures).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('strain: faces stay rigid', () => {
    for (const s of report.steps) {
      expect(s.strain, s.id).toBeLessThan(1e-5);
      expect(s.rigid, s.id).toBeLessThan(1e-6);
      expect(s.nan, s.id).toBe(0);
    }
    expect(Math.max(...report.steps.map((s) => s.strain))).toBeLessThan(LIMITS.strain);
  });

  it('continuity: steps join, and nothing pops inside a step', () => {
    expect(report.contMax).toBeLessThanOrEqual(LIMITS.continuity);
    for (const s of report.steps) {
      // Refined around the worst interval, the largest move across a 1e-7 slice of the step is tiny.
      expect(s.popJump, `${s.id} at t=${s.popT}`).toBeLessThan(1e-5);
      expect(s.determinismDiff, s.id).toBe(0);
    }
  });

  it('interpenetration: none at any step boundary, none substantial in between', () => {
    for (const s of report.steps) {
      expect(s.start.ipAny, `${s.id} start`).toBe(0);
      expect(s.end.ipAny, `${s.id} end`).toBe(0);
      expect(s.ipSubMax, s.id).toBe(0);
      expect(s.ipDeepMax, s.id).toBe(0);
    }
  });

  it('interpenetration inside a step, between faces that are not neighbours on the paper: none, not even grazing', () => {
    // The head used to graze the neck it is tucked into (up to 9 triangle pairs, 0.0038 deep).
    // It is now a small reverse fold of its own, with the top of the neck opening for it.
    for (const s of report.steps) expect(s.ipAnyMax, `${s.id} at t=${s.ipWorstT}`).toBe(0);
  });

  it('faces joined by a crease or a vertex cross only in two steps, by a fraction of a layer', () => {
    // Neighbours on the paper do cut into each other a little where layers of different height
    // turn about one line: in the collapse (2 triangle pairs) and around the mouth of the head
    // fold (12). Pinned here so that it cannot grow unnoticed: never deeper than a third of a
    // layer, and in no other step at all.
    const crossing = Object.fromEntries(report.steps.filter((s) => s.ipNbrMax > 0).map((s) => [s.id, s.ipNbrMax]));
    expect(Object.keys(crossing)).toEqual(['preliminary-base', 'head']);
    expect(crossing['preliminary-base']).toBeLessThanOrEqual(2);
    expect(crossing.head).toBeLessThanOrEqual(12);
    for (const s of report.steps) {
      expect(s.ipNbrDepth, s.id).toBeLessThan(EPS / 3);
      expect(s.ipNbrL, s.id).toBeLessThan(0.075);
      // And never at rest: a step boundary has none.
      expect(s.start.ipNbr, `${s.id} start`).toBe(0);
      expect(s.end.ipNbr, `${s.id} end`).toBe(0);
    }
  });

  it('near-coplanar pairs (z-fighting): none, at the boundaries or in between', () => {
    for (const s of report.steps) {
      expect(s.start.zf, `${s.id} start`).toBe(0);
      expect(s.end.zf, `${s.id} end`).toBe(0);
      expect(s.zfMax, `${s.id} at t=${s.zfWorstT}`).toBe(0);
      expect(s.flips, s.id).toBe(0);
    }
  });

  it('flat states: a valid layer order, layers at least 0.0015 apart', () => {
    for (const s of report.steps) {
      for (const [where, b] of [['start', s.start], ['end', s.end]]) {
        if (!b.flatExpected) continue;
        expect(b.flat, `${s.id} ${where} is flat`).toBeTruthy();
        expect(b.flat.tacoTortilla + b.flat.tacoTaco + b.flat.tortThroughTaco, `${s.id} ${where}`).toBe(0);
        expect(b.flat.minSep, `${s.id} ${where}`).toBeGreaterThanOrEqual(LIMITS.minLayerSeparation);
        expect(b.flat.minSep === Infinity || Math.abs(b.flat.minSep - EPS) < 1e-6, `${s.id} ${where}`).toBe(true);
      }
      for (const m of s.midFlat || []) expect(m.TT + m.TC + m.TT2, `${s.id} t=${m.t}`).toBe(0);
    }
  });

  it('hinges: closed in the plane at every boundary, never gaping more than a stack of layers', () => {
    for (const s of report.steps) {
      if (s.end.flat) expect(s.end.hingeGapXY, s.id).toBeLessThan(1e-6);
      // How far a hinge opens beyond its resting gap. Pinned at the present worst cases:
      // the reverse folds, whose pages pivot at the height of their outermost layer.
      expect(s.excessGap, `${s.id} at t=${s.excessGapT}`).toBeLessThan(0.03);
    }
    // The head stays attached to the neck along its crease all the way through its fold:
    // no hinge of that step opens by even one layer more than it does at rest.
    expect(report.steps[stepIndex('head')].excessGap).toBeLessThan(EPS);
  });

  it('layers: no more levels than there are layers, and the body does not swell for the head', () => {
    const end = (id) => report.steps[stepIndex(id)].end.flat;
    for (const s of report.steps) {
      if (!s.end.flat) continue;
      // Compact: somewhere in the model the stack really is as deep as the number of levels in use.
      expect(s.end.flat.levels, s.id).toBe(s.end.flat.maxLayers);
    }
    // The same holds for a fold-and-unfold folded flat half way, with one exception, by name:
    // the second kite crease uses 8 levels where its deepest stack has 6. (Its two flaps go on
    // top of everything, as in the first one, but here the levels under them are not all
    // occupied where the flaps land.)
    for (const s of report.steps) {
      for (const m of s.midFlat || []) {
        if (s.id === 'kite-crease-2') {
          expect(m.levels, s.id).toBe(8);
          expect(m.maxLayers, s.id).toBe(6);
        } else {
          expect(m.levels, `${s.id} t=${m.t}`).toBe(m.maxLayers);
        }
      }
    }
    expect(end('tail').levels).toBe(24);
    expect(end('head').levels).toBe(24);
    expect(end('head').thickness).toBeCloseTo(23 * EPS, 6);
    expect(end('head').thickness).toBeCloseTo(end('tail').thickness, 9);
  });

  it('sheets are plane: the only steps across an unfolded crease are the two that have to be there', () => {
    // 1. The top of the neck stands four layers out around the head tucked into it (8 sheets,
    //    one soft crease each). 2. Folded flat, the second top crease wraps one sheet round six others.
    for (const s of report.steps) {
      if (s.end.flat) {
        const expected = s.id === 'head' ? 8 : 0;
        expect(s.end.flat.jogs, s.id).toBe(expected);
        if (expected) expect(s.end.flat.maxJog, s.id).toBeCloseTo(4 * EPS, 6);
        expect(s.end.flat.jogCross, s.id).toBe(0);
      }
      for (const m of s.midFlat || []) {
        const expected = s.id === 'top-crease-2' ? 4 : 0;
        expect(m.jogs, `${s.id} t=${m.t}`).toBe(expected);
        if (expected) expect(m.maxJog, s.id).toBeCloseTo(6 * EPS, 6);
        expect(m.jogX, `${s.id} t=${m.t}`).toBe(0);
      }
    }
  });

  it('turn-overs are rigid half turns about the vertical axis', () => {
    for (const s of report.steps.filter((x) => x.kind === 'turn-over')) {
      expect(s.turnResidual, s.id).toBeLessThan(1e-6);
      expect(s.turnRigidErr, s.id).toBeLessThan(1e-6);
    }
  });

  it('ends with the coloured side outside', () => {
    // Averaged over all directions, white shows only in the slits between layers and inside the
    // open body: 0.070 with the thicker stack the head fold used to leave behind, about 0.060 now.
    expect(report.finalWhiteFrac).toBeLessThan(0.065);
    // Seen square on to the body (the model without its final presentation turn).
    const plain = buildCraneModel({ turns: false }).model;
    const square = analyseModel(plain, { N: 3, fine: 10, timingCalls: 0, whiteDirs: 60, selfTest: false });
    expect(square.finalWhiteFrac).toBeLessThan(0.065);
    expect(square.finalWhiteFracPM.front).toBeLessThan(0.03);
    expect(square.finalWhiteFracPM.back).toBeLessThan(0.03);
    // From the square base on, every flat state shows colour only, on both faces.
    for (let k = stepIndex('preliminary-base'); k < stepIndex('wings'); k++) {
      expect(report.boundaryWhite[k].front, model.steps[k].id).toBe(0);
      expect(report.boundaryWhite[k].back, model.steps[k].id).toBe(0);
    }
  });

  it('shows little white in the pose it ships in, turned toward the viewer', () => {
    // The finished crane is turned, so the view is no longer square on to the stacks of neck,
    // tail and body and looks a little way into the gaps between their layers, whose inner faces
    // are white. Measured on the bare contract geometry, from the app's default camera ("home")
    // and from straight in front and behind. (Turned 40 degrees, as it was, these were 0.098,
    // 0.083 and 0.085.) Pinned so that it cannot grow.
    const shipped = report.finalWhiteFracPM;
    expect(shipped.home).toBeLessThan(0.07);
    expect(shipped.front).toBeLessThan(0.04);
    expect(shipped.back).toBeLessThan(0.052);
    // What the viewer draws is far less than that: it closes every folded crease whose outside
    // is coloured with a strip (src/viewer/foldBacks.js), so the edge of a stack shows as one
    // coloured edge and only the open raw edges are left to look into.
    const drawn = withFoldBacks(model);
    const pose = new Float32Array(3 * drawn.vertexCount);
    drawn.pose(model.steps.length - 1, 1, pose);
    expect(visibleWhiteFraction(drawn, pose, [HOME_VIEW])).toBeLessThan(0.005);
    expect(visibleWhiteFraction(drawn, pose, [[0, 0, 1]])).toBeLessThan(0.005);
    expect(visibleWhiteFraction(drawn, pose, [[0, 0, -1]])).toBeLessThan(0.005);
    // From the side, where the bare geometry shows the whole edge of every stack (0.21):
    expect(shipped.right).toBeGreaterThan(0.15);
    expect(visibleWhiteFraction(drawn, pose, [[1, 0, 0]])).toBeLessThan(0.01);
    expect(visibleWhiteFraction(drawn, pose, [[-1, 0, 0]])).toBeLessThan(0.01);
  });
});

describe('crane: the head is a small reverse fold of its own', () => {
  const { internals } = buildCraneModel();
  const { core, first } = internals;
  const k = stepIndex('head');
  const phase = core.steps[k].phases[0];
  const verticesOf = (pick) => core.faces.flatMap((f, i) => (pick(f, i) ? Array.from({ length: first[i + 1] - first[i] }, (_, n) => first[i] + n) : []));

  it('moves nothing but the top of the neck', () => {
    // Everything outside the mouth of the neck keeps its place and its height: the body does not
    // breathe while the head is folded. (Before the model re-centres on its new outline.)
    const still = verticesOf((f) => f.grp[phase.id] === 0);
    const moving = verticesOf((f) => f.grp[phase.id] !== 0);
    expect(still.length).toBeGreaterThan(0.75 * model.vertexCount);
    expect(moving.length).toBeGreaterThan(0);
    const start = poseOf(k, 0);
    for (const t of [0.1, 0.2, 0.3, GUIDE_FADE_END]) {
      const now = poseOf(k, t);
      for (const v of still) for (let d = 0; d < 3; d++) expect(Math.abs(now[3 * v + d] - start[3 * v + d])).toBeLessThan(1e-7);
    }
    // And afterwards it only slides sideways as a whole.
    const end = poseOf(k, 1);
    const [dx, dy] = [end[3 * still[0]] - start[3 * still[0]], end[3 * still[0] + 1] - start[3 * still[0] + 1]];
    for (const v of still) {
      expect(Math.abs(end[3 * v] - start[3 * v] - dx)).toBeLessThan(1e-6);
      expect(Math.abs(end[3 * v + 1] - start[3 * v + 1] - dy)).toBeLessThan(1e-6);
      expect(Math.abs(end[3 * v + 2] - start[3 * v + 2])).toBeLessThan(1e-7);
    }
  });

  it('opens the top of the neck like a mouth and shuts it again', () => {
    // The two sides of the top of the neck (groups 3 and 4) part, lie in one plane when the head
    // passes between them, and close again: their normals go from parallel to opposite and back.
    const tri = (group) => {
      const i = core.faces.findIndex((f) => f.grp[phase.id] === group);
      return [first[i], first[i] + 1, first[i] + 2];
    };
    const normal = (P, [a, b, c]) => {
      const u = [0, 1, 2].map((d) => P[3 * b + d] - P[3 * a + d]);
      const w = [0, 1, 2].map((d) => P[3 * c + d] - P[3 * a + d]);
      const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const l = Math.hypot(...n);
      return n.map((x) => x / l);
    };
    // Opening angle between the two sides: 0 shut, pi when they form one flat sheet.
    const opening = (t) => {
      const P = poseOf(k, t);
      const a = normal(P, tri(3));
      const b = normal(P, tri(4));
      // Unit normals of the outer faces of the two sides, whichever way each face is wound.
      const dot = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
      const tilt = Math.acos(Math.min(1, Math.abs(a[2])));
      return { between: Math.acos(Math.min(1, dot)), tilt };
    };
    expect(opening(0).tilt).toBeLessThan(1e-3);
    expect(opening(1).tilt).toBeLessThan(1e-3);
    // Fully open (each side a quarter turn from the plane of the model) when the first stage ends.
    const widest = Math.max(...Array.from({ length: 101 }, (_, i) => opening(i / 100).tilt));
    expect(widest).toBeGreaterThan(Math.PI / 2 - 0.02);
    // Half way through closing the mouth is clearly on its way shut, not still gaping.
    expect(opening(0.8).tilt).toBeLessThan(1.2);
    expect(opening(0.8).tilt).toBeGreaterThan(0.3);
  });

  it('tucks the head between the layers of the neck, which is thicker there and nowhere else', () => {
    const P = poseOf(k, 1);
    const zRange = (vs) => [Math.min(...vs.map((v) => P[3 * v + 2])), Math.max(...vs.map((v) => P[3 * v + 2]))];
    const head = zRange(verticesOf((f) => f.tags.head));
    const top = verticesOf((f) => f.grp[phase.id] === 3 || f.grp[phase.id] === 4).map((v) => Math.abs(P[3 * v + 2]));
    const rest = zRange(verticesOf((f) => f.tags.neck && f.grp[phase.id] <= 2));
    // Head: the four innermost levels on either side of the middle.
    expect(head[1] - head[0]).toBeCloseTo(7 * EPS, 6);
    // Top of the neck: the next four levels out, clear of the head by one layer.
    expect(Math.min(...top)).toBeCloseTo(4.5 * EPS, 6);
    expect(Math.max(...top)).toBeCloseTo(7.5 * EPS, 6);
    // The rest of the neck is no thicker than before the fold.
    expect(rest[1] - rest[0]).toBeCloseTo(7 * EPS, 6);
  });
});

describe('crane: presentation turns', () => {
  const plain = buildCraneModel({ turns: false }).model;
  const { SHOW_TURN } = buildCraneModel().internals;
  const plainPose = (k, t) => {
    const out = new Float32Array(3 * plain.vertexCount);
    plain.pose(k, t, out);
    return out;
  };
  const pairs = Array.from({ length: 400 }, (_, i) => [(i * 37) % model.vertexCount, (i * 101 + 13) % model.vertexCount]);
  const dist = (P, a, b) => Math.hypot(P[3 * a] - P[3 * b], P[3 * a + 1] - P[3 * b + 1], P[3 * a + 2] - P[3 * b + 2]);

  it('turns only the neck, the tail and the last step', () => {
    expect(Object.keys(SHOW_TURN).sort()).toEqual(['neck', 'tail', 'wings']);
    model.steps.forEach((step, k) => {
      for (const t of [0, 0.3, 0.5, 0.8, 1]) {
        const same = maxDiff(poseOf(k, t), plainPose(k, t)) === 0;
        if (!SHOW_TURN[step.id]) expect(same, `${step.id} t=${t}`).toBe(true);
      }
    });
  });

  it('is a rigid motion of the whole model: every distance is kept', () => {
    for (const id of Object.keys(SHOW_TURN)) {
      const k = stepIndex(id);
      for (const t of [0.4, 0.5, 0.63, 0.8, 0.95, 1]) {
        const A = poseOf(k, t);
        const B = plainPose(k, t);
        for (const [a, b] of pairs) expect(Math.abs(dist(A, a, b) - dist(B, a, b)), `${id} t=${t}`).toBeLessThan(2e-6);
      }
    }
  });

  it('waits for the guides to fade, and a reverse fold faces front again at the end', () => {
    for (const id of ['neck', 'tail']) {
      const k = stepIndex(id);
      for (const t of [0, 0.1, 0.2, 0.3, GUIDE_FADE_END]) expect(maxDiff(poseOf(k, t), plainPose(k, t)), `${id} t=${t}`).toBe(0);
      expect(maxDiff(poseOf(k, 1), plainPose(k, 1)), id).toBe(0);
      // In between, the model turns about a vertical axis: no vertex changes height.
      let turned = 0;
      for (const t of [0.45, 0.6, 0.8]) {
        const A = poseOf(k, t);
        const B = plainPose(k, t);
        for (let v = 0; v < model.vertexCount; v++) expect(Math.abs(A[3 * v + 1] - B[3 * v + 1])).toBeLessThan(1e-6);
        turned = Math.max(turned, maxDiff(A, B));
      }
      expect(turned, id).toBeGreaterThan(0.05);
    }
  });

  it('turns the open half of a reverse fold toward the viewer', () => {
    // Half way through, the inside of the opened half faces +Z more than it faces sideways:
    // the point that is being reversed (it swings in the plane of the spine) is seen at an angle
    // of the declared turn, on the side it started from.
    for (const [id, sign] of [['neck', 1], ['tail', -1]]) {
      const k = stepIndex(id);
      const A = poseOf(k, 0.6);
      const B = plainPose(k, 0.6);
      // The farthest vertex to that side in the plain pose is the tip of the point, lying in z ~ 0.
      let tip = 0;
      for (let v = 0; v < model.vertexCount; v++) if (sign * B[3 * v] > sign * B[3 * tip]) tip = v;
      expect(sign * A[3 * tip]).toBeGreaterThan(0);
      expect(Math.abs(B[3 * tip + 2])).toBeLessThan(0.03);
      expect(A[3 * tip + 2]).toBeGreaterThan(0.3 * Math.abs(B[3 * tip])); // it has come toward the viewer
    }
  });

  it('leaves the finished crane in a three-quarter view from the default camera: the plain pose, turned as declared and centred', () => {
    const k = stepIndex('wings');
    const A = poseOf(k, 1);
    const B = plainPose(k, 1);
    const yaw = (SHOW_TURN.wings.yaw * Math.PI) / 180;
    const pitch = (SHOW_TURN.wings.pitch * Math.PI) / 180;
    const turn = (x, y, z) => {
      const x1 = Math.cos(yaw) * x + Math.sin(yaw) * z;
      const z1 = Math.cos(yaw) * z - Math.sin(yaw) * x;
      return [x1, Math.cos(pitch) * y - Math.sin(pitch) * z1, Math.sin(pitch) * y + Math.cos(pitch) * z1];
    };
    const origin = turn(B[0], B[1], B[2]);
    for (let v = 0; v < model.vertexCount; v++) {
      const q = turn(B[3 * v], B[3 * v + 1], B[3 * v + 2]);
      for (let d = 0; d < 3; d++) expect(Math.abs(A[3 * v + d] - A[d] - (q[d] - origin[d]))).toBeLessThan(2e-6);
    }
    // What the viewer sees is the turned pose through the default camera, which itself stands
    // HOME_AZIMUTH_DEG to the right: screen x, and distance toward the camera, of a vertex.
    const azimuth = (HOME_AZIMUTH_DEG * Math.PI) / 180;
    const screenX = (v) => Math.cos(azimuth) * A[3 * v] - Math.sin(azimuth) * A[3 * v + 2];
    const toward = (v) => Math.sin(azimuth) * A[3 * v] + Math.cos(azimuth) * A[3 * v + 2];
    // The head (the far end of the neck side, +x in the plain pose) comes toward the viewer.
    let head = 0;
    let tail = 0;
    for (let v = 0; v < model.vertexCount; v++) {
      if (B[3 * v] > B[3 * head]) head = v;
      if (B[3 * v] < B[3 * tail]) tail = v;
    }
    expect(toward(head)).toBeGreaterThan(0.1);
    // Both wings show: their tips, one behind the other in the plain pose, are far apart on screen.
    let front = 0;
    let back = 0;
    for (let v = 0; v < model.vertexCount; v++) {
      if (B[3 * v + 2] > B[3 * front + 2]) front = v;
      if (B[3 * v + 2] < B[3 * back + 2]) back = v;
    }
    expect(Math.abs(B[3 * front] - B[3 * back])).toBeLessThan(0.01);
    expect(Math.abs(screenX(front) - screenX(back))).toBeGreaterThan(0.45);
    // Neck and tail read apart: the head is well to the right of the tail tip on screen, most of
    // the way to their distance in pure profile. (Turned 40 degrees the neck pointed at the
    // camera and this was half of it.)
    expect(screenX(head) - screenX(tail)).toBeGreaterThan(0.75 * (B[3 * head] - B[3 * tail]));
  });
});

describe('crane: reverse folds share their time between the swing and the closing', () => {
  const plain = buildCraneModel({ turns: false });
  const { core, first } = plain.internals;

  it('opens, swings and closes without standing wide open to the end', () => {
    for (const id of ['neck', 'tail']) {
      const k = stepIndex(id);
      const phase = core.steps[k].phases[0];
      const page = core.faces.findIndex((f) => f.grp[phase.id] === 1);
      const [a, b, c] = [first[page], first[page] + 1, first[page] + 2];
      // How far the front page has turned out of the plane of the model: 0 shut, pi / 2 wide open.
      const open = (t) => {
        const P = new Float32Array(3 * plain.model.vertexCount);
        plain.model.pose(k, t, P);
        const u = [0, 1, 2].map((d) => P[3 * b + d] - P[3 * a + d]);
        const w = [0, 1, 2].map((d) => P[3 * c + d] - P[3 * a + d]);
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        return Math.acos(Math.min(1, Math.abs(n[2]) / Math.hypot(...n)));
      };
      expect(open(0), id).toBeLessThan(1e-3);
      expect(open(0.34), id).toBeGreaterThan(Math.PI / 2 - 0.01); // open: a third of the step
      expect(open(1), id).toBeLessThan(1e-3);
      // Closing is spread over the swing. (Driven by the swing angle alone the page was still
      // 68 degrees open three quarters of the way through the second stage, and 45 at 93% of the step.)
      expect(open(0.34 + 0.66 * 0.5), id).toBeLessThan((72 * Math.PI) / 180);
      expect(open(0.34 + 0.66 * 0.75), id).toBeLessThan((48 * Math.PI) / 180);
      expect(open(0.93), id).toBeLessThan((20 * Math.PI) / 180);
      // And it only ever closes during the second stage.
      let last = open(0.34);
      for (let t = 0.36; t <= 1; t += 0.02) {
        const now = open(t);
        expect(now, `${id} t=${t}`).toBeLessThanOrEqual(last + 1e-6);
        last = now;
      }
    }
  });
});

describe('crane: step text and pacing', () => {
  it('gives every step a duration that fits what happens in it', () => {
    const duration = (id) => model.steps[stepIndex(id)].duration;
    for (const step of model.steps) {
      expect(step.duration, step.id).toBeGreaterThanOrEqual(1.5);
      expect(step.duration, step.id).toBeLessThanOrEqual(8);
    }
    const byKind = (kind) => model.steps.filter((step) => step.kind === kind).map((step) => step.duration);
    // Turn-overs are the quickest, a plain fold is quicker than a fold-and-unfold, compound folds take longest.
    expect(Math.max(...byKind('turn-over'))).toBeLessThan(Math.min(...byKind('fold')));
    expect(Math.max(...byKind('fold'))).toBeLessThan(Math.min(...byKind('fold-unfold')));
    expect(Math.max(...byKind('fold-unfold'))).toBeLessThan(Math.min(...byKind('compound')));
    // The two big reverse folds (open, swing, close, with a turn of the model) are the longest steps.
    expect(duration('neck')).toBe(Math.max(...model.steps.map((step) => step.duration)));
    expect(duration('tail')).toBe(duration('neck'));
    expect(duration('head')).toBeLessThan(duration('neck'));
    // The same fold takes the same time on both sides.
    for (const name of ['book', 'diagonal', 'kite-crease', 'top-crease', 'petal-fold', 'narrow']) expect(duration(`${name}-1`)).toBe(duration(`${name}-2`));
  });

  it('writes one short paragraph per step, in plain words', () => {
    for (const step of model.steps) {
      expect(step.title.length, step.id).toBeLessThanOrEqual(32);
      expect(step.description.length, step.id).toBeGreaterThan(40);
      expect(step.description.length, step.id).toBeLessThanOrEqual(480);
      expect(step.description.trim(), step.id).toBe(step.description);
      expect(step.description.endsWith('.'), step.id).toBe(true);
    }
    // Steps in which the model itself turns say so.
    for (const id of ['neck', 'wings']) expect(model.steps[stepIndex(id)].description).toMatch(/model turns/);
    // A fold-and-unfold says that the fold is undone; a fold that stays does not.
    for (const step of model.steps) {
      const undone = /open (the paper|them) again|lift (the point|it) back up/.test(step.description);
      if (step.kind === 'fold-unfold') expect(undone, step.id).toBe(true);
      if (step.kind === 'fold') expect(undone, step.id).toBe(false);
    }
  });
});

describe('crane in the viewer', () => {
  it('inks no crease of the final crease pattern before that crease has been folded', async () => {
    const { createEdges } = await import('../src/viewer/edges.js');
    const { analyseModel: analyseForViewer } = await import('../src/viewer/analysis.js');
    const edges = createEdges(model);
    const clock = createClock(model.steps);
    analyseForViewer(model, clock, { observe: edges.observe });
    const { creases, outline } = edges.counts;
    expect(outline).toBeGreaterThanOrEqual(4);
    const alphas = edges.object.geometry.getAttribute('instanceAlpha').array;
    const starts = edges.object.geometry.getAttribute('instanceStart').data.array;
    const inked = () => {
      const list = [];
      for (let i = 0; i < creases; i++) if (alphas[i] > 0) list.push(i);
      return list;
    };

    // The flat sheet at the very start: only the outline, at full strength.
    edges.update(poseOf(0, 0), 0);
    expect(inked()).toEqual([]);
    for (let i = creases; i < creases + outline; i++) expect(alphas[i]).toBeGreaterThan(0.5);

    // Unfolded again after the first book fold: only the vertical centre line is remembered.
    const afterBook1 = clock.timeAt(1, 0);
    edges.update(poseOf(1, 0), afterBook1);
    const centre = inked();
    expect(centre.length).toBeGreaterThan(0);
    for (const i of centre) {
      expect(Math.abs(starts[6 * i])).toBeLessThan(1e-6);
      expect(Math.abs(starts[6 * i + 3])).toBeLessThan(1e-6);
    }

    // Flat again before the collapse: the two book creases and the two diagonals, nothing else.
    const k = stepIndex('preliminary-base');
    edges.update(poseOf(k, 0), clock.timeAt(k, 0));
    for (const i of inked()) {
      const [ax, ay, bx, by] = [starts[6 * i], starts[6 * i + 1], starts[6 * i + 3], starts[6 * i + 4]];
      const onBook = (Math.abs(ax) < 1e-6 && Math.abs(bx) < 1e-6) || (Math.abs(ay) < 1e-6 && Math.abs(by) < 1e-6);
      const onDiagonal = (Math.abs(ax - ay) < 1e-6 && Math.abs(bx - by) < 1e-6) || (Math.abs(ax + ay) < 1e-6 && Math.abs(bx + by) < 1e-6);
      expect(onBook || onDiagonal).toBe(true);
    }
    expect(inked().length).toBeLessThan(creases / 3);
  });

  it('keeps the near plane far enough out for the layer spacing to resolve', async () => {
    const { CAMERA_FAR, CAMERA_FOV, CAMERA_NEAR } = await import('../src/viewer/scene.js');
    const { MAX_ZOOM } = await import('../src/viewer/cameraRig.js');
    const { fitDistance } = await import('../src/viewer/framing.js');
    expect(CAMERA_NEAR).toBeGreaterThanOrEqual(0.05);
    // Farthest the rig puts the camera for the flat sheet (the largest shape of the sequence):
    // fitted distance times the widest zoom, on a landscape canvas and on the narrowest stage
    // the layout produces, a tall phone held upright (the stage is never narrower than 0.56 : 1).
    for (const aspect of [1.32, 0.56]) {
      const farthest = fitDistance(0.75, CAMERA_FOV, aspect) * MAX_ZOOM;
      // Smallest depth step a 24-bit buffer can tell apart at that distance.
      const step = (farthest * farthest * (CAMERA_FAR - CAMERA_NEAR)) / (CAMERA_FAR * CAMERA_NEAR * 2 ** 24);
      expect(step, `aspect ${aspect}`).toBeLessThan(EPS / 10);
    }
    // And the nearest it comes (smallest shape, closest zoom) is still outside the near plane.
    const { MIN_ZOOM } = await import('../src/viewer/cameraRig.js');
    const { MIN_RADIUS } = await import('../src/viewer/framing.js');
    const nearest = fitDistance(MIN_RADIUS, CAMERA_FOV, 1.32) * MIN_ZOOM - MIN_RADIUS;
    expect(nearest).toBeGreaterThan(1.5 * CAMERA_NEAR);
  });
});
