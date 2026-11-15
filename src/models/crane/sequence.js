/**
 * The crane's folding sequence: the flat-state operations of every step, each
 * paired with the analytic motion that animates it.
 *
 * Nothing here knows about vertices or thickness; see crane.js for the mesh
 * and guides.js for the fold guides, which are derived from these motions.
 */
import { Sheet, heights, paperAdjacency } from '../../origami/flatSheet.js';
import { ap2, mul2, side } from '../../origami/geom.js';
import * as mo from './motions.js';

/** Separation between stacked layers. */
export const EPS = 0.0018;

/**
 * Shape parameters. ys: height of the neck/tail reverse folds on the centre
 * line; a: their half angle (degrees); dh: head length; headDown: head droop
 * (degrees); yw: height of the wing crease; omega: wing angle (degrees).
 */
export const PAR = Object.freeze({ ys: 0.44, a: 16, dh: 0.105, headDown: 28, mouth: 0.07, mouthClear: 2, mouthWide: 70, yw: 0.6, omega: 80 });

const D = Math.PI / 180;
const O = [0, 0];

/*
 * Step durations (seconds at 1x) follow how much there is to watch: a plain
 * fold that stays folded 2.6, a turn-over 1.8, a fold-and-unfold a little over
 * 3 (longer when the paper travels further or two flaps move), the collapse
 * and the petal folds 5.5, the small head fold 5, the wings with the final
 * turn 5, and the two big reverse folds, which open, swing and close while
 * the model turns, 7.
 */

/**
 * @typedef {Object} Phase
 * @property {number} id       motion id (the unfold of a fold shares its id)
 * @property {number} start    snapshot the motion starts from
 * @property {number} end      snapshot the motion ends in (flat phases only)
 * @property {(tau: number, ctx?: object) => object[]} motion
 * @property {boolean} rev     played backwards (the unfold half of a fold-and-unfold)
 * @property {boolean} flat    whether the motion ends in a flat state
 * @property {number} [snapEnd] snapshot after an unfold
 */

export function buildCrane() {
  const sh = new Sheet();
  const phases = [];
  const steps = [];
  let motionCount = 0;
  let step = null;
  sh.snap();

  const front = (f) => f.key > sh.mid;
  const beginStep = (id, kind, duration) => {
    step = { id, kind, duration, phases: [], snap: sh.mids.length - 1 };
    steps.push(step);
  };

  /** Runs one phase: groupOf(face, centroid) -> group index, keyOf(face, group) -> new layer key. */
  function phase(motion, groupOf, keyOf, opt = {}) {
    const id = motionCount++;
    const start = sh.mids.length - 1;
    const G1 = motion(1);
    const cens = sh.faces.map((f) => sh.cen(f));
    const grp = sh.faces.map((f, i) => groupOf(f, cens[i]));
    const keys = sh.faces.map((f, i) => (keyOf ? keyOf(f, grp[i]) : f.key));
    sh.faces.forEach((f, i) => {
      f.grp[id] = grp[i];
      if (opt.flat !== false) {
        const G = G1[grp[i]];
        f.M = mul2([G.R[0], G.R[1], G.R[3], G.R[4], G.t[0], G.t[1]], f.M);
      }
      f.key = keys[i];
      if (opt.tag) opt.tag(f, grp[i]);
    });
    if (opt.mid !== undefined) sh.mid = opt.mid;
    const ph = { id, start, end: sh.snap(), motion, rev: false, flat: opt.flat !== false };
    phases.push(ph);
    step.phases.push(ph);
    return ph;
  }

  function unfold(ph) {
    sh.restore(ph.start);
    const u = { id: ph.id, start: ph.start, end: ph.end, motion: ph.motion, rev: true, flat: true, snapEnd: sh.snap() };
    phases.push(u);
    step.phases.push(u);
  }

  /** Simple valley folds: lines = [{ a, b, move(f, c) }]; the moving faces stack reversed on top of everything. */
  function fold(lines, splitPred, keyOf) {
    for (const l of lines) sh.split(l.a, l.b, splitPred);
    const top = sh.maxKey() + 0.5;
    for (const l of lines) {
      const f = sh.faces.find((face) => l.move(face, sh.cen(face)));
      l.left = side(l.a, l.b, sh.cen(f)) > 0;
    }
    return phase(
      mo.simpleFold(lines),
      (f, c) => {
        for (let i = 0; i < lines.length; i++) if (lines[i].move(f, c)) return i + 1;
        return 0;
      },
      keyOf || ((f, g) => (g ? 2 * top - f.key : f.key)),
    );
  }

  function turn(id) {
    beginStep(id, 'turn-over', 1.8);
    const mid = -sh.mid;
    phase(mo.turnOver(0), () => 0, (f) => -f.key, { mid });
  }

  // ---- 1-2: book creases, white side up -----------------------------------
  // Valleys seen from the white side, i.e. mountains on the coloured side:
  // exactly how the collapse uses them, so the colour ends up outside.
  beginStep('book-1', 'fold-unfold', 3.2);
  unfold(fold([{ a: [0, -0.5], b: [0, 0.5], move: (f, c) => c[0] > 0 }]));
  beginStep('book-2', 'fold-unfold', 3.2);
  unfold(fold([{ a: [-0.5, 0], b: [0.5, 0], move: (f, c) => c[1] > 0 }]));
  turn('turn-over-1');
  // ---- 4-5: diagonal creases, coloured side up ----------------------------
  // Valleys seen from the coloured side; the collapse folds one of them that way.
  beginStep('diagonal-1', 'fold-unfold', 3.4);
  unfold(fold([{ a: [-0.5, -0.5], b: [0.5, 0.5], move: (f, c) => side([-0.5, -0.5], [0.5, 0.5], c) < 0 }]));
  beginStep('diagonal-2', 'fold-unfold', 3.4);
  unfold(fold([{ a: [0.5, -0.5], b: [-0.5, 0.5], move: (f, c) => side([0.5, -0.5], [-0.5, 0.5], c) > 0 }]));
  // ---- 6: collapse into the preliminary base ------------------------------
  beginStep('preliminary-base', 'compound', 5.5);
  const sector = (c) => Math.floor((((Math.atan2(c[1], c[0]) / D) + 360) % 360) / 45);
  phase(mo.collapse(), (f, c) => sector(c), (f, g) => [1, 1, 2, 3, 4, 4, 3, 2][g], { mid: 2.5 });

  // ---- 7-13: petal folds --------------------------------------------------
  const kr = [Math.sin(22.5 * D), Math.cos(22.5 * D)];
  const kl = [-kr[0], kr[1]];
  const P = (Math.SQRT2 - 1) / 2;
  function petalSide(n) {
    // Pre-crease: lower edges of the front flap to the centre line.
    beginStep('kite-crease-' + n, 'fold-unfold', 3.6);
    unfold(
      fold(
        [
          { a: O, b: kr, move: (f, c) => front(f) && side(O, kr, c) < 0 },
          { a: O, b: kl, move: (f, c) => front(f) && side(O, kl, c) > 0 },
        ],
        front,
      ),
    );
    // Pre-crease: top triangle down.
    beginStep('top-crease-' + n, 'fold-unfold', 3.2);
    unfold(fold([{ a: [-1, 0.5], b: [1, 0.5], move: (f, c) => !f.tags.wing && c[1] > 0.5 }], (f) => !f.tags.wing));
    // Petal fold.
    beginStep('petal-fold-' + n, 'compound', 5.5);
    const kA = sh.maxKey();
    const kS = Math.max(...sh.faces.filter((f) => f.key < kA).map((f) => f.key));
    phase(
      mo.petal(),
      (f, c) => {
        const r = side(O, kr, c) < 0;
        const l = side(O, kl, c) > 0;
        if (f.key === kA) return r ? 3 : l ? 5 : c[1] < 0.5 ? 1 : 0;
        if (f.key === kS) return r ? 2 : l ? 4 : 0;
        return 0;
      },
      (f, g) => (g === 0 ? f.key : g === 1 ? kA + 1 : kA + 2),
      {
        tag: (f, g) => {
          if (g === 1 || g === 3 || g === 5) f.tags.wing = true;
        },
      },
    );
  }
  petalSide(1);
  turn('turn-over-2');
  petalSide(2);

  // ---- 14-16: narrow the legs ---------------------------------------------
  const nr = [Math.sin(11.25 * D), Math.cos(11.25 * D)];
  const nl = [-nr[0], nr[1]];
  function narrow(n) {
    beginStep('narrow-' + n, 'fold', 2.6);
    fold(
      [
        { a: O, b: nr, move: (f, c) => front(f) && side(O, nr, c) < 0 },
        { a: O, b: nl, move: (f, c) => front(f) && side(O, nl, c) > 0 },
      ],
      front,
    );
  }
  narrow(1);
  turn('turn-over-3');
  narrow(2);

  // ---- 17-18: inside reverse folds: neck (right leg), tail (left leg) -----
  const ta = Math.tan(PAR.a * D);
  const ye = PAR.ys / (1 + (nr[0] / nr[1]) * ta);
  const xe = (ye * nr[0]) / nr[1];
  const S = [0, PAR.ys];
  const tuck = (f, m) => sh.mid + (Math.sign(f.key - sh.mid) * m) / (1 + Math.abs(f.key - sh.mid));
  function reverse(id, sgn, tag) {
    const E = [sgn * xe, ye];
    beginStep(id, 'compound', 7);
    sh.split(S, E, (f) => sgn * sh.cen(f)[0] > 0);
    const m = 0.8 * sh.minGap();
    const tipSide = Math.sign(side(S, E, O));
    phase(
      mo.reverseFold(S, E, sgn < 0),
      (f, c) => {
        if (sgn * c[0] < 0) return 0;
        const tip = side(S, E, c) * tipSide > 0;
        return (front(f) ? 1 : 2) + (tip ? 2 : 0);
      },
      (f, g) => (g < 3 ? f.key : tuck(f, m)),
      {
        tag: (f, g) => {
          if (g >= 3) f.tags[tag] = true;
        },
      },
    );
  }
  reverse('neck', 1, 'neck');
  reverse('tail', -1, 'tail');

  // ---- 19: head: reverse the tip of the neck ------------------------------
  {
    const un = [Math.sin(2 * PAR.a * D), Math.cos(2 * PAR.a * D)];
    const N = [S[0] + PAR.ys * un[0], S[1] + PAR.ys * un[1]];
    const S2 = [N[0] - PAR.dh * un[0], N[1] - PAR.dh * un[1]];
    const ang = ((90 - 2 * PAR.a - PAR.headDown) / 2) * D;
    const E2 = [S2[0] + Math.cos(ang), S2[1] + Math.sin(ang)];
    beginStep('head', 'compound', 5);
    const tipSide = Math.sign(side(S2, E2, N));
    sh.split(S2, E2, (f) => f.tags.neck);
    for (const f of sh.faces) if (f.tags.neck && side(S2, E2, sh.cen(f)) * tipSide > 0) f.tags.head = true;
    // The mouth: two soft creases per side fan out from the spine point V below the head, so the
    // top of the neck can open while the rest of it stays shut (see mouthReverseFold). The upper
    // one must pass below everything the reversed head will lie on, so that only the top of the
    // neck has to make room for it; the lower one at more than twice the upper one's angle.
    const V = [S2[0] - PAR.mouth * un[0], S2[1] - PAR.mouth * un[1]];
    const fromSpine = (phi) => [un[0] * Math.cos(phi) + un[1] * Math.sin(phi), -un[0] * Math.sin(phi) + un[1] * Math.cos(phi)];
    const angleFromSpine = (p) => Math.atan2(-side(V, N, p), (p[0] - V[0]) * un[0] + (p[1] - V[1]) * un[1]);
    // Where the head crease meets the open edge of the neck, and where the edge of the reversed head crosses it.
    const creaseEnd = sh.faces.filter((f) => f.tags.head).flatMap((f) => sh.folded(f)).reduce((best, p) => (side(S2, N, p) < side(S2, N, best) ? p : best));
    const cd = [Math.cos(ang), Math.sin(ang)];
    const along = (N[0] - S2[0]) * cd[0] + (N[1] - S2[1]) * cd[1];
    const tipAfter = [2 * (S2[0] + along * cd[0]) - N[0], 2 * (S2[1] + along * cd[1]) - N[1]];
    const headReach = (() => {
      // Intersection of the line S2 -> tipAfter with the open edge creaseEnd -> N.
      const d1 = [tipAfter[0] - S2[0], tipAfter[1] - S2[1]];
      const d2 = [N[0] - creaseEnd[0], N[1] - creaseEnd[1]];
      const den = d1[0] * d2[1] - d1[1] * d2[0];
      const u = ((creaseEnd[0] - S2[0]) * d2[1] - (creaseEnd[1] - S2[1]) * d2[0]) / den;
      return [S2[0] + u * d1[0], S2[1] + u * d1[1]];
    })();
    const phi2 = Math.max(angleFromSpine(creaseEnd), angleFromSpine(headReach)) + PAR.mouthClear * D;
    const phi1 = PAR.mouthWide * D;
    if (!(phi1 > 2 * phi2)) throw new Error('crane: the mouth of the head fold cannot open flat');
    const C1 = [V[0] + fromSpine(phi1)[0], V[1] + fromSpine(phi1)[1]];
    const C2 = [V[0] + fromSpine(phi2)[0], V[1] + fromSpine(phi2)[1]];
    const soft = (f) => f.tags.neck && !f.tags.head;
    sh.split(V, C1, soft);
    sh.split(V, C2, soft);
    const above1 = Math.sign(side(V, C1, N));
    const above2 = Math.sign(side(V, C2, N));
    const m = 0.8 * sh.minGap();
    const step = sh.keyStep();
    // Canonical frame of the reverse-fold motion: spine on x = 0, tip toward -y, the head vertex at the origin.
    const phi = Math.PI - 2 * PAR.a * D;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    const Ec = [cp * Math.cos(ang) + sp * Math.sin(ang), -sp * Math.cos(ang) + cp * Math.sin(ang)];
    phase(
      mo.conj(mo.mouthReverseFold(Ec, PAR.mouth, phi1, phi2, Ec[0] < 0, 0.4), phi, S2),
      (f, c) => {
        if (!f.tags.neck) return 0;
        const fr = front(f) ? 0 : 1;
        if (f.tags.head) return 5 + fr;
        if (side(V, C2, c) * above2 > 0) return 3 + fr;
        if (side(V, C1, c) * above1 > 0) return 1 + fr;
        return 0;
      },
      // The head goes in between the layers of the neck. Only the top of the neck, above the upper
      // soft crease, lies on it and has to make room: it becomes a sheet apart from the rest of the
      // neck, which stays where it was. The neck is a little thicker at the head, as on a real
      // crane, and the rest of the model does not have to move out by four layers.
      (f, g) => (g >= 5 ? tuck(f, m) : g >= 3 ? f.key + Math.sign(f.key - sh.mid) * 0.5 * step : f.key),
    );
  }

  // ---- 20: wings ----------------------------------------------------------
  {
    const yw = PAR.yw;
    beginStep('wings', 'shape', 5);
    sh.split([-1, yw], [1, yw], (f) => f.tags.wing);
    phase(mo.wings(yw, PAR.omega * D), (f, c) => (f.tags.wing && c[1] > yw ? (front(f) ? 1 : 2) : 0), null, { flat: false });
  }

  // ---- bake: adjacency, layer heights and centres of every flat state -----
  const faces = sh.faces;
  const adj = paperAdjacency(faces);
  const nSnap = sh.mids.length;
  const H = [];
  const centers = [];
  for (let s = 0; s < nSnap; s++) {
    H.push(heights(faces, adj, s, sh.mids[s], EPS));
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const f of faces) {
      for (const p of f.poly) {
        const q = ap2(f.hist[s].M, p);
        x0 = Math.min(x0, q[0]);
        x1 = Math.max(x1, q[0]);
        y0 = Math.min(y0, q[1]);
        y1 = Math.max(y1, q[1]);
      }
    }
    centers.push([(x0 + x1) / 2, (y0 + y1) / 2]);
  }
  return { faces, adj, phases, steps, H, centers, mids: sh.mids, nSnap };
}
