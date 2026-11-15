/**
 * The traditional origami crane (orizuru) as an OrigamiModel
 * (see ../../origami/types.js).
 *
 * sequence.js folds an exact flat-state model of the sheet and attaches a
 * closed-form rigid motion to every step. This module turns that into the
 * contract's buffers: a fixed triangle list (each rigid face owns its
 * vertices), uvs, and a pose() that places every face with its group's rigid
 * transform plus the layer offset that keeps stacked paper apart.
 *
 * Pure ESM, no runtime dependencies; runs unchanged in Node and the browser.
 */
import { ap2, det2 } from '../../origami/geom.js';
import { GUIDE_FADE_END } from '../../origami/types.js';
import { deriveGuides } from './guides.js';
import { EPS, PAR, buildCrane } from './sequence.js';
import { STEP_TEXT } from './text.js';

/** How far guides sit above the surface they are drawn on. */
const GUIDE_LIFT = 0.002;
/**
 * A step that ends somewhere else re-centres the model only after this much of
 * the step, when the viewer has faded the fold guides out (they are drawn where
 * the creases are at the start of the step).
 */
const RECENTRE_FROM = GUIDE_FADE_END;

/**
 * Presentation turns. A step that is hard to read from the front turns the
 * whole model while it is under way: { yaw, pitch } in degrees (about the
 * vertical axis, then about the horizontal one; positive pitch tips the top
 * toward the viewer).
 * - The neck and tail reverse folds open one half of the model like a book,
 *   which is edge-on from the front. Turned about its spine (`axis`: the
 *   folded-plane x of the turning axis), the viewer looks into the open half
 *   and sees the point swing through; the model faces front again at the end.
 * - The last step leaves the finished crane turned a little toward the viewer
 *   (`stay`). The viewer's default camera stands 20 degrees to the right, so
 *   20 degrees of turn make a three-quarter view of 40: neck and beak in
 *   profile on the right, the tail apart from them on the left, both wings
 *   showing. (Turned further, the neck points at the camera and is
 *   foreshortened, and the view looks along the layers of neck and tail.)
 * Every turn waits until the fold guides have faded (RECENTRE_FROM).
 */
const SHOW_TURN = {
  neck: { yaw: -44, pitch: 0, axis: 0, stay: false },
  tail: { yaw: 44, pitch: 0, axis: 0, stay: false },
  wings: { yaw: -20, pitch: 10, axis: null, stay: true },
};
/** A turn that is undone again is complete by TURN_IN and is undone between TURN_OUT and the end of the step. */
const TURN_IN = 0.56;
const TURN_OUT = 0.7;
const RAD = Math.PI / 180;

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0); // NaN -> 0
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (6 * x - 15) + 10));

/**
 * Builds the crane together with the internals that the development tooling
 * (renderer, flat-state tests) looks at. The app only ever sees `model`.
 *
 * @param {Object} [options]
 * @param {boolean} [options.turns]  false leaves out the presentation turns (SHOW_TURN), so that
 *                                   tooling can look at the folds alone, always facing front
 * @returns {{ model: import('../../origami/types.js').OrigamiModel, internals: object }}
 */
export function buildCraneModel({ turns = true } = {}) {
  const core = buildCrane();
  const { faces, phases, H, centers } = core;
  const faceCount = faces.length;

  // ---- fixed topology: fan-triangulated convex faces, vertices owned per face ----
  let vertexCount = 0;
  const first = faces.map((f) => {
    const v = vertexCount;
    vertexCount += f.poly.length;
    return v;
  });
  first.push(vertexCount);
  const uvs = new Float32Array(2 * vertexCount);
  const index = [];
  faces.forEach((f, i) => {
    f.poly.forEach((p, k) => {
      uvs[2 * (first[i] + k)] = p[0] + 0.5;
      uvs[2 * (first[i] + k) + 1] = p[1] + 0.5;
    });
    for (let k = 1; k + 1 < f.poly.length; k++) index.push(first[i], first[i] + k, first[i] + k + 1);
  });
  const indices = Uint32Array.from(index);

  // ---- per-motion baked data: start-state 2D positions, layer heights, flips, groups ----
  const baked = new Map();
  for (const ph of phases) {
    if (baked.has(ph.id)) continue;
    const q = new Float64Array(2 * vertexCount);
    const grp = new Int32Array(faceCount);
    const flip = new Uint8Array(faceCount);
    faces.forEach((f, i) => {
      const M0 = f.hist[ph.start].M;
      f.poly.forEach((p, k) => {
        const w = ap2(M0, p);
        q[2 * (first[i] + k)] = w[0];
        q[2 * (first[i] + k) + 1] = w[1];
      });
      grp[i] = f.grp[ph.id];
      flip[i] = ph.flat && det2(M0) * det2(f.hist[ph.end].M) < 0 ? 1 : 0;
    });
    const groupCount = 1 + Math.max(...grp);
    const extremes = (h) => {
      const hi = new Float64Array(groupCount).fill(-Infinity);
      const lo = new Float64Array(groupCount).fill(Infinity);
      for (let i = 0; i < faceCount; i++) {
        hi[grp[i]] = Math.max(hi[grp[i]], h[i]);
        lo[grp[i]] = Math.min(lo[grp[i]], h[i]);
      }
      for (let g = 0; g < groupCount; g++) if (hi[g] < lo[g]) hi[g] = lo[g] = 0;
      return { hi, lo };
    };
    const h0 = H[ph.start];
    const h1 = ph.flat ? H[ph.end] : H[ph.start];
    baked.set(ph.id, {
      motion: ph.motion,
      q,
      grp,
      flip,
      h0,
      h1,
      e0: extremes(h0),
      e1: extremes(h1),
      // Scratch handed to the motion: extreme layer heights of each group right now.
      hi: new Float64Array(groupCount),
      lo: new Float64Array(groupCount),
      c0: centers[ph.start],
      c1: ph.flat ? centers[ph.end] : centers[ph.start],
    });
  }

  // ---- steps ----------------------------------------------------------------
  const steps = core.steps.map((s) => {
    const text = STEP_TEXT[s.id];
    if (!text) throw new Error(`crane: no text for step "${s.id}"`);
    return { id: s.id, title: text[0], description: text[1], duration: s.duration, kind: s.kind };
  });
  const stepCount = steps.length;
  /** One motion per step; a fold-and-unfold plays it there and back. */
  const stepMotion = core.steps.map((s) => ({
    b: baked.get(s.phases[0].id),
    thereAndBack: s.phases.length === 2 && s.phases[1].rev,
    turn: turns && SHOW_TURN[s.id] ? { ...SHOW_TURN[s.id], ex: 0, ey: 0 } : null,
  }));

  /** Writes the pose at fold amount `tau` of a motion, shifted by (-cx, -cy). */
  function place(b, tau, cx, cy, out) {
    const { q, grp, flip, h0, h1, e0, e1, hi, lo } = b;
    // How far the layers have moved from their old heights to their new ones: in step with the
    // fold, unless the motion needs the room earlier or later (motion.settle).
    const w = b.motion.settle ? b.motion.settle(tau) : tau;
    for (let g = 0; g < hi.length; g++) {
      hi[g] = e0.hi[g] + (e1.hi[g] - e0.hi[g]) * w;
      lo[g] = e0.lo[g] + (e1.lo[g] - e0.lo[g]) * w;
    }
    const G = b.motion(tau, b);
    for (let i = 0; i < faceCount; i++) {
      const { R, t: T, B } = G[grp[i]];
      // A face that ends up turned over carries its layer offset round with it
      // (it pivots half way between its two heights); any other face slides
      // along its own normal from one height to the other.
      let cc;
      let dd;
      if (flip[i]) {
        cc = (h0[i] + h1[i]) / 2;
        dd = (h0[i] - h1[i]) / 2;
      } else {
        cc = 0;
        dd = h0[i] + (h1[i] - h0[i]) * w;
      }
      const ox = T[0] + (B ? B[0] * cc : 0) + R[2] * dd - cx;
      const oy = T[1] + (B ? B[1] * cc : 0) + R[5] * dd - cy;
      const oz = T[2] + (B ? B[2] * cc : cc) + R[8] * dd;
      for (let v = first[i]; v < first[i + 1]; v++) {
        const x = q[2 * v];
        const y = q[2 * v + 1];
        out[3 * v] = R[0] * x + R[1] * y + ox;
        out[3 * v + 1] = R[3] * x + R[4] * y + oy;
        out[3 * v + 2] = R[6] * x + R[7] * y + oz;
      }
    }
  }

  // A motion that does not end flat (the wings) has no flat end state to take
  // its centre from: measure the bounding box of its end pose instead.
  {
    const scratch = new Float32Array(3 * vertexCount);
    for (const ph of phases) {
      if (ph.flat) continue;
      const b = baked.get(ph.id);
      place(b, 1, 0, 0, scratch);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let v = 0; v < vertexCount; v++) {
        x0 = Math.min(x0, scratch[3 * v]);
        x1 = Math.max(x1, scratch[3 * v]);
        y0 = Math.min(y0, scratch[3 * v + 1]);
        y1 = Math.max(y1, scratch[3 * v + 1]);
      }
      b.c1 = [(x0 + x1) / 2, (y0 + y1) / 2];
    }
  }

  /**
   * pose() is driven evenly by t: the viewer applies the one ease-in-out of
   * the step. These things are timed inside a step:
   * - a fold-and-unfold follows sin(pi t), so it comes to rest folded flat
   *   half way through and is back where it started at t = 1;
   * - re-centring on the new shape waits until the fold guides have faded;
   * - so do the presentation turns of the whole model (SHOW_TURN).
   */
  function pose(stepIndex, t, out) {
    const k = Math.min(stepCount - 1, Math.max(0, Math.trunc(stepIndex) || 0));
    const x = clamp01(t);
    const { b, thereAndBack, turn } = stepMotion[k];
    let tau = x;
    let shift = 0;
    if (thereAndBack) {
      tau = x >= 1 ? 0 : Math.sin(Math.PI * x);
    } else if (x > RECENTRE_FROM) {
      const u = (x - RECENTRE_FROM) / (1 - RECENTRE_FROM);
      shift = u * u;
    }
    const cx = b.c0[0] + (b.c1[0] - b.c0[0]) * shift;
    place(b, tau, cx, b.c0[1] + (b.c1[1] - b.c0[1]) * shift, out);
    if (turn && x > RECENTRE_FROM && (turn.stay || x < 1)) {
      const amount = turn.stay
        ? smooth((x - RECENTRE_FROM) / (1 - RECENTRE_FROM))
        : smooth((x - RECENTRE_FROM) / (TURN_IN - RECENTRE_FROM)) * (1 - smooth((x - TURN_OUT) / (1 - TURN_OUT)));
      rotate(out, turn.yaw * RAD * amount, turn.pitch * RAD * amount, turn.axis === null ? 0 : turn.axis - cx, -turn.ex * amount, -turn.ey * amount);
    }
    return out;
  }

  /** Turns every vertex about the vertical line x = x0, z = 0, then about the x axis, then shifts it by (dx, dy). */
  function rotate(out, yaw, pitch, x0, dx, dy) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    for (let v = 0; v < vertexCount; v++) {
      const px = out[3 * v] - x0;
      const py = out[3 * v + 1];
      const pz = c * out[3 * v + 2] - s * px;
      out[3 * v] = x0 + c * px + s * out[3 * v + 2] + dx;
      out[3 * v + 1] = cp * py - sp * pz + dy;
      out[3 * v + 2] = sp * py + cp * pz;
    }
  }

  // A turn that stays must leave the piece centred: measure where the turned end pose sits.
  {
    const scratch = new Float32Array(3 * vertexCount);
    for (const { b, turn } of stepMotion) {
      if (!turn || !turn.stay) continue;
      place(b, 1, b.c1[0], b.c1[1], scratch);
      rotate(scratch, turn.yaw * RAD, turn.pitch * RAD, 0, 0, 0);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let v = 0; v < vertexCount; v++) {
        x0 = Math.min(x0, scratch[3 * v]);
        x1 = Math.max(x1, scratch[3 * v]);
        y0 = Math.min(y0, scratch[3 * v + 1]);
        y1 = Math.max(y1, scratch[3 * v + 1]);
      }
      turn.ex = (x0 + x1) / 2;
      turn.ey = (y0 + y1) / 2;
    }
  }

  // ---- guides: derived from the motions, cached per step ----------------------
  const guideCache = new Array(stepCount);
  function guides(stepIndex) {
    if (!Number.isInteger(stepIndex) || stepIndex < 0 || stepIndex >= stepCount) return [];
    const list = (guideCache[stepIndex] ??= deriveGuides(core, stepIndex, GUIDE_LIFT));
    return list.map((g) => ({ type: g.type, a: [...g.a], b: [...g.b] }));
  }

  const model = {
    name: 'Traditional crane (orizuru)',
    steps,
    vertexCount,
    indices,
    uvs,
    pose,
    guides,
  };
  return { model, internals: { core, first, EPS, PAR, SHOW_TURN } };
}

/** @returns {import('../../origami/types.js').OrigamiModel} */
export function createCraneModel() {
  return buildCraneModel().model;
}
