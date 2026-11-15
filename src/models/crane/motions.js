/**
 * Closed-form rigid kinematics for the crane.
 *
 * Every motion is a function tau in [0, 1] -> array of group transforms
 * { R, t [, B] } acting on the START flat state of its phase (x, y in the
 * folded plane, z = 0). Faces are assigned to groups by the sequence.
 *
 * Timing: a motion is driven at an even pace by tau and does NOT ease in or
 * out at its ends; the viewer eases each step once. The only internal timing
 * is where a motion has sub-phases that must come to rest between them (the
 * reverse fold) or where the natural parameter would run away (the collapse).
 */
import { I3, add, apT, compose, cross, dot, frame3, mirrorX, mm, mv, norm, rotAxis, scl, sub } from '../../origami/geom.js';

const PI = Math.PI;
const r2 = Math.SQRT1_2;
const v3 = (p) => [p[0], p[1], 0];
const clamp01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
/** 0 -> 1, starting from rest and arriving at an even pace: the second stage of a reverse fold. */
const fromRest = (x) => x * x * (2 - x);

/**
 * Simple folds. lines: [{ a, b, left }]; group i + 1 turns half a revolution
 * about line i through +Z (a valley fold as seen from +Z). `left` is true when
 * the moving faces lie to the left of a -> b.
 */
export function simpleFold(lines, dir = 1) {
  return (tau) => {
    const s = clamp01(tau);
    const G = [I3];
    for (const l of lines) G.push(rotAxis(v3(l.a), sub(v3(l.b), v3(l.a)), (l.left ? 1 : -1) * dir * PI * s));
    return G;
  };
}

/** A rigid half turn about the vertical line x = cx. */
export function turnOver(cx) {
  return (tau) => [rotAxis([cx, 0, 0], [0, 1, 0], PI * clamp01(tau))];
}

/**
 * Preliminary-base collapse of the 8 sectors around the paper centre (centre
 * at the origin of the start state, coloured side toward +Z). Sector j lies
 * between the rays at 45 j and 45 (j + 1) degrees.
 *
 * A 1-DOF symmetric linkage: the two folded diagonal halves swing in the plane
 * z_K = 0 by psi while the flat front and back squares tilt by phi, with
 * cos(phi) = tan(pi/4 - psi/2). The linkage is driven by phi, which runs
 * evenly from pi/2 (flat sheet) to 0 (closed): psi as the driver would make
 * the squares snap shut at the end, because phi ~ sqrt(psi) there.
 */
export function collapse() {
  const W = Array.from({ length: 9 }, (_, j) => [Math.cos((j * PI) / 4), Math.sin((j * PI) / 4), 0]);
  return (tau) => {
    const s = clamp01(tau);
    const phi = (PI / 2) * (1 - s);
    const cph = s >= 1 ? 1 : Math.cos(phi);
    const sph = s >= 1 ? 0 : Math.sin(phi);
    // psi = pi/2 - 2 atan(cos phi), in closed form:
    const sp = (1 - cph * cph) / (1 + cph * cph);
    const cp = (2 * cph) / (1 + cph * cph);
    const K = [
      [r2, -r2 * cph, -r2 * sph],
      [0, -cph, -sph],
      [-r2, -r2 * cph, -r2 * sph],
      [-sp, -cp, 0],
      [-r2, -r2 * cph, r2 * sph],
      [0, -cph, sph],
      [r2, -r2 * cph, r2 * sph],
      [sp, -cp, 0],
    ];
    K.push(K[0]);
    // The whole linkage is carried from lying in the paper plane to standing upright, apex on top.
    const Q = mm(rotAxis([0, 0, 0], [1, 0, 0], (PI / 2) * (1 - s)).R, rotAxis([0, 0, 0], [0, 1, 0], (-PI / 4) * (1 - s)).R);
    const apex = [0, (Math.SQRT2 / 2) * s, 0];
    const G = [];
    for (let j = 0; j < 8; j++) {
      G.push(frame3([0, 0, 0], W[j], W[j + 1], apex, add(apex, mv(Q, K[j])), add(apex, mv(Q, K[j + 1]))));
    }
    return G;
  };
}

/**
 * Petal fold on the front flap of a base whose open point is at (0, 0) and
 * whose hinge is y = 1/2.
 * Groups: 0 static, 1 kite (turns about the hinge), 2 right tucked triangle
 * (turns about the fixed crease O-P), 3 right outer triangle of the front face
 * (the coupler of the spherical 4-bar at P), 4 and 5 their mirror images.
 */
export const PETAL = { P: [(Math.SQRT2 - 1) / 2, 0.5, 0], Rc: [Math.SQRT2 / 4, Math.SQRT2 / 4, 0] };

export function petalAngles(theta) {
  const { P, Rc } = PETAL;
  const g = norm(P);
  const Ok = apT(rotAxis([0, 0.5, 0], [-1, 0, 0], theta), [0, 0, 0]);
  const c0 = scl(g, dot(Rc, g));
  const e1 = sub(Rc, c0);
  const e2 = cross(e1, g);
  const w = sub(Ok, c0);
  // |Ok - R(rho)| = 1/2 reduces to A (1 + cos rho) + B sin rho = 0, i.e. tan(rho / 2) = -A / B.
  const A = dot(w, e1);
  const B = dot(w, e2);
  const rho = theta <= 0 ? 0 : theta >= PI ? PI : 2 * Math.atan2(-A, B);
  return { rho, Ok };
}

export function petal() {
  const { P, Rc } = PETAL;
  const g = norm(P);
  return (tau) => {
    const theta = PI * clamp01(tau);
    const { rho, Ok } = petalAngles(theta);
    const GK = rotAxis([0, 0.5, 0], [-1, 0, 0], theta);
    const GR = rotAxis([0, 0, 0], g, -rho);
    const GA = frame3(P, [0, 0, 0], Rc, P, Ok, apT(GR, Rc));
    return [I3, GK, GR, GA, mirrorX(GR), mirrorX(GA)];
  };
}

/**
 * Inside reverse fold of a two-sided point whose spine is the line x = 0
 * (z = 0), about the crease S -> E (E on the open edge, x > 0).
 *
 * An exact rigid motion in two stages:
 * 1. the front and back layer groups open like a book about the spine until
 *    the point is a flat sheet;
 * 2. they close again in the other mode of the degree-4 vertex S,
 *    tan(beta) = cot(rho / 2) / sin(a), the tip swinging through between them.
 * The pages change direction between the stages, so stage 1 (the first s1 of
 * the motion) runs out to rest and stage 2 starts from rest; the two ends of
 * the motion are left un-eased. In stage 2 the tip leads and the pages follow
 * at a matching pace (see below), so the model spends as little time as it
 * can standing wide open.
 *
 * Groups: 0 static, 1 front page, 2 back page, 3 front tip, 4 back tip.
 * mirror = true puts the point on x < 0.
 *
 * ctx.hi / ctx.lo are the extreme layer heights of each group: the pages pivot
 * about the spine at the height of their OUTERMOST layer, so that an opened
 * page never cuts into the other (static) half of the model.
 */
export function reverseFold(S, E, mirror = false, s1 = 0.34) {
  const Ex = Math.abs(E[0]);
  const l = norm([Ex, E[1] - S[1], 0]);
  const rsa = Math.sqrt(-l[1]);
  const S3 = [0, S[1], 0];
  const Z = [0, 0, 1];
  return (tau, ctx) => {
    const x = clamp01(tau);
    let beta;
    let rho;
    if (x < s1) {
      beta = (PI / 2) * Math.sin((PI / 2) * (x / s1));
      rho = 0;
    } else {
      // Driven by v so that the swing of the tip and the closing of the pages share the time:
      // tan(rho / 2) = tan(v) / sqrt(sin a), tan(pi/2 - beta) = sqrt(sin a) tan(v). Driven by
      // rho alone, the pages would stand wide open almost to the end and then snap shut.
      const v = (PI / 2) * fromRest((x - s1) / (1 - s1));
      const cv = x >= 1 ? 0 : Math.cos(v);
      const sv = x >= 1 ? 1 : Math.sin(v);
      rho = 2 * Math.atan2(sv, rsa * cv);
      beta = Math.atan2(cv, rsa * sv);
    }
    const zf = ctx ? ctx.hi[1] : 0;
    const zb = ctx ? ctx.lo[2] : 0;
    const PF = rotAxis([0, 0, zf], [0, 1, 0], -beta);
    const PB = rotAxis([0, 0, zb], [0, 1, 0], beta);
    const TF = compose(PF, rotAxis(S3, l, rho));
    const TB = compose(PB, rotAxis(S3, l, -rho));
    TF.B = mv(PF.R, Z);
    TB.B = mv(PB.R, Z);
    const G = [I3, PF, PB, TF, TB];
    return mirror ? G.map(mirrorX) : G;
  };
}

/**
 * Inside reverse fold of the TIP of a closed two-sided point, without opening
 * the rest of the point: the small reverse fold that makes the crane's head.
 *
 * Canonical frame as for reverseFold: spine on x = 0, tip toward -y, the head
 * vertex at the origin, its crease running to E (x > 0). A closed point cannot
 * open at one end only while its faces stay rigid, so the top of the neck is
 * given two soft creases per side, fanning out from the spine point
 * V = (0, d) at the angles phi1 > 2 phi2 from the spine. With the lower neck
 * shut they form a spherical kite linkage with one degree of freedom:
 *
 *   - the "cheek" between the two creases lifts about the lower crease by mu,
 *   - the top of the neck opens about the spine by beta, like a small mouth,
 *     while the spine above V nods toward the open edge by `kink`,
 *     sin(mu) = sin(phi2) sin(beta) / sin(phi1 - phi2).
 *
 * At beta = pi/2 the top of the neck is a flat sheet, so the head can change
 * from lying straight to being reversed exactly as in reverseFold, and the
 * mouth closes again around it. Every face stays rigid and, but for the
 * thickness of the layers, every crease stays closed throughout.
 *
 * Groups: 0 static, 1 front cheek, 2 back cheek, 3 front top of the neck,
 * 4 back top of the neck, 5 front of the head, 6 back of the head.
 *
 * Thickness. ctx.lo / ctx.hi: each packet of layers pivots at the height of
 * its INNERMOST layer, so that at the two ridges of the mouth (the spine and
 * the upper soft crease) the outer layers gape a little instead of the inner
 * ones cutting into each other. motion.settle(tau) says how far the layers
 * have moved from their heights before the fold to their heights after it:
 * the two sides of the neck must have parted a little before the head starts
 * to turn between them, and all the way by the time it lies flat.
 */
export function mouthReverseFold(E, d, phi1, phi2, mirror = false, s1 = 0.4) {
  const l = norm([Math.abs(E[0]), E[1], 0]);
  const rsa = Math.sqrt(-l[1]);
  const g1 = phi1 - phi2;
  const g2 = phi2;
  const c1 = [Math.sin(phi1), -Math.cos(phi1), 0];
  const Y = [0, 1, 0];
  const Z = [0, 0, 1];
  const O = [0, 0, 0];
  const cg1 = Math.cos(g1);
  const k = Math.sin(g2) / Math.sin(g1);
  /** Mouth opening beta and head turn rho at progress x. */
  const stage = (x) => {
    if (x < s1) return [(PI / 2) * Math.sin((PI / 2) * (x / s1)), 0];
    // As in reverseFold: the head leads, the mouth closes behind it at a matching pace.
    const v = (PI / 2) * fromRest((x - s1) / (1 - s1));
    const cv = x >= 1 ? 0 : Math.cos(v);
    const sv = x >= 1 ? 1 : Math.sin(v);
    return [Math.atan2(cv, rsa * sv), 2 * Math.atan2(sv, rsa * cv)];
  };
  const motion = (tau, ctx) => {
    const [beta, rho] = stage(clamp01(tau));
    // The kite: cheek lift and the angle left between the lower crease and the spine above V.
    const mu = Math.asin(Math.min(1, k * Math.sin(beta)));
    const A = Math.cos(g2);
    const B = Math.sin(g2) * Math.cos(beta);
    const open = Math.atan2(B, A) + Math.acos(Math.min(1, cg1 / Math.hypot(A, B)));
    const kink = phi1 - open;
    const zf = ctx ? ctx.lo[3] : 0;
    const zb = ctx ? ctx.hi[4] : 0;
    const K = rotAxis([0, d, 0], Z, kink);
    const PF = compose(K, rotAxis([0, d, zf], Y, -beta));
    const PB = compose(K, rotAxis([0, d, zb], Y, beta));
    const MF = rotAxis([0, d, zf], c1, -mu);
    const MB = rotAxis([0, d, zb], c1, mu);
    const TF = compose(PF, rotAxis(O, l, rho));
    const TB = compose(PB, rotAxis(O, l, -rho));
    TF.B = mv(PF.R, Z);
    TB.B = mv(PB.R, Z);
    const G = [I3, MF, MB, PF, PB, TF, TB];
    return mirror ? G.map(mirrorX) : G;
  };
  motion.settle = (tau) => {
    const x = clamp01(tau);
    if (x < s1) return MOUTH_SETTLE[0] * Math.sin((PI / 2) * (x / s1)) ** 2;
    const turned = 1 - Math.cos(stage(x)[1]);
    return MOUTH_SETTLE[0] + MOUTH_SETTLE[1] * turned + MOUTH_SETTLE[2] * turned * turned;
  };
  return motion;
}

/**
 * How far the neck layers have parted while the head turns by rho, as a
 * polynomial in 1 - cos(rho): 5/16 of the way before the head starts (one and
 * a quarter layers of room), 1 when it lies flat. Derived from the layer
 * geometry at the head crease: with less room the inner layers of the head
 * would cut the inner layers of the neck.
 */
const MOUTH_SETTLE = [0.3125, 0.15, 0.096875];

/**
 * Conjugates a motion by the in-plane rigid frame F (rotation phi about z,
 * then translation to c), so that a motion written in canonical coordinates
 * can act anywhere in the folded plane.
 */
export function conj(motion, phi, c) {
  const F = rotAxis([0, 0, 0], [0, 0, 1], phi);
  F.t = [c[0], c[1], 0];
  const Fi = { R: [F.R[0], F.R[3], F.R[6], F.R[1], F.R[4], F.R[7], F.R[2], F.R[5], F.R[8]], t: [0, 0, 0] };
  Fi.t = scl(mv(Fi.R, F.t), -1);
  const moved = (tau, ctx) =>
    motion(tau, ctx).map((G) => {
      const X = compose(F, compose(G, Fi));
      if (G.B) X.B = mv(F.R, G.B);
      return X;
    });
  if (motion.settle) moved.settle = motion.settle;
  return moved;
}

/**
 * Wings: group 1 turns about the horizontal line y = yw toward +Z by omega,
 * group 2 toward -Z. Each wing pivots about the crease at the height of its
 * outermost layer (ctx.hi / ctx.lo), so the turning stack stays a rigid block
 * and never dips into the body layers underneath.
 */
export function wings(yw, omega) {
  return (tau, ctx) => {
    const w = omega * clamp01(tau);
    const zf = ctx ? ctx.hi[1] : 0;
    const zb = ctx ? ctx.lo[2] : 0;
    return [I3, rotAxis([0, yw, zf], [1, 0, 0], w), rotAxis([0, yw, zb], [1, 0, 0], -w)];
  };
}
