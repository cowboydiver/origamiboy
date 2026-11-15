/**
 * Orbiting plus automatic framing.
 *
 * The user owns the viewing direction and a zoom factor (OrbitControls: drag
 * to rotate, wheel or pinch to zoom, with damping). The rig owns what is being
 * looked at: the orbit target glides to the centre of the model's bounding box
 * and the camera distance scales with its size. The rig only ever moves the
 * target and rescales the distance by a ratio, so it never touches the angles
 * or the zoom the user chose.
 */
import { MathUtils, Spherical, TOUCH, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { HOME_AZIMUTH_DEG, HOME_ELEVATION_DEG, fitDistance as fit, sphereOfBox } from './framing.js';

const HOME_AZIMUTH = MathUtils.degToRad(HOME_AZIMUTH_DEG);
const HOME_POLAR = MathUtils.degToRad(90 - HOME_ELEVATION_DEG);
/** Time constant of the glide toward a new framing, in seconds. */
const FOLLOW_TIME = 0.2;
const HOME_DURATION = 0.6;
const NUDGE_DURATION = 0.2;
/** How far the user may zoom in and out, relative to the fitted distance. */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 2.6;
const POLAR_LIMIT = 0.05;

/**
 * @param {import('three').PerspectiveCamera} camera
 * @param {HTMLElement} element  receives the pointer and wheel events
 */
export function createCameraRig(camera, element) {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = true;
  controls.dampingFactor = 0.085;
  controls.enablePan = false;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 0.9;
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };

  // What the rig is currently framing (smoothed) and what it is heading for.
  const target = new Vector3();
  const goalTarget = new Vector3();
  let radius = 0.75;
  let goalRadius = 0.75;
  let distance = 1;
  let snap = true;
  /** Fraction of the canvas height the model may use (the rest is kept free at the top). */
  let usable = 1;

  const offset = new Vector3();
  const spherical = new Spherical();
  /**
   * A move of the view in flight (reset, or a keyboard nudge), expressed as
   * azimuth, polar angle and zoom relative to the fitted distance.
   * @type {null | { elapsed: number, duration: number, from: View, to: View, shortestTurn: boolean }}
   * @typedef {{ theta: number, phi: number, zoom: number }} View
   */
  let move = null;

  /** @returns {View} */
  function currentView() {
    offset.copy(camera.position).sub(controls.target);
    spherical.setFromVector3(offset);
    return { theta: spherical.theta, phi: spherical.phi, zoom: spherical.radius / distance };
  }

  function moveTo(to, duration, shortestTurn) {
    move = { elapsed: 0, duration, from: currentView(), to, shortestTurn };
  }

  const fitDistance = (r) => fit(r, camera.fov, camera.aspect, usable);

  // Any touch of the controls cancels a reset in flight: the user wins.
  controls.addEventListener('start', () => {
    move = null;
  });

  // Start from the home view.
  distance = fitDistance(radius);
  offset.setFromSphericalCoords(distance, HOME_POLAR, HOME_AZIMUTH);
  camera.position.copy(target).add(offset);
  controls.update();

  return {
    controls,

    /**
     * Sets the box to frame: six numbers, min xyz then max xyz.
     * @param {ArrayLike<number>} box
     */
    frame(box) {
      const sphere = sphereOfBox(box);
      goalTarget.set(sphere.x, sphere.y, sphere.z);
      goalRadius = sphere.radius;
    },

    /**
     * Keeps a band at the top of the canvas free: the model is fitted into
     * `fraction` of the canvas height (the stage shifts the picture down to match).
     * @param {number} fraction  in (0, 1]
     */
    setUsableHeight(fraction) {
      usable = MathUtils.clamp(fraction, 0.3, 1);
    },

    /** Skips the glide on the next update (first frame, reduced motion). */
    snap() {
      snap = true;
    },

    /** Returns to the default direction and zoom. */
    resetView({ immediate = false } = {}) {
      moveTo({ theta: HOME_AZIMUTH, phi: HOME_POLAR, zoom: 1 }, immediate ? 0 : HOME_DURATION, true);
    },

    /**
     * Turns or zooms the view by a small amount: the keyboard's way to orbit.
     * Presses made while a nudge is still in flight add up.
     * @param {{ azimuth?: number, polar?: number, zoom?: number, immediate?: boolean }} by
     */
    nudge({ azimuth = 0, polar = 0, zoom = 1, immediate = false }) {
      const base = move ? move.to : currentView();
      moveTo(
        {
          theta: base.theta + azimuth,
          phi: MathUtils.clamp(base.phi + polar, POLAR_LIMIT, Math.PI - POLAR_LIMIT),
          zoom: MathUtils.clamp(base.zoom * zoom, MIN_ZOOM, MAX_ZOOM),
        },
        immediate ? 0 : NUDGE_DURATION,
        false,
      );
    },

    /**
     * Advances the glide, any reset in flight, and the controls' damping.
     * @param {number} dt  seconds since the last frame
     * @returns {boolean} true while the camera is still moving
     */
    update(dt) {
      const blend = snap ? 1 : 1 - Math.exp(-dt / FOLLOW_TIME);
      snap = false;
      target.lerp(goalTarget, blend);
      radius += (goalRadius - radius) * blend;
      let following = true;
      if (target.distanceToSquared(goalTarget) < 1e-10 && Math.abs(goalRadius - radius) < 1e-5) {
        target.copy(goalTarget);
        radius = goalRadius;
        following = false;
      }

      // Keep the user's direction and zoom: rescale their offset, move the target.
      const previousDistance = distance;
      distance = fitDistance(radius);
      offset.copy(camera.position).sub(controls.target).multiplyScalar(distance / previousDistance);

      if (move) {
        move.elapsed += dt;
        const x = move.duration > 0 ? Math.min(1, move.elapsed / move.duration) : 1;
        const eased = x * x * (3 - 2 * x);
        const { from, to } = move;
        // A reset takes the short way round; a nudge goes exactly as far as asked.
        const turn = move.shortestTurn
          ? MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, 2 * Math.PI) - Math.PI
          : to.theta - from.theta;
        offset.setFromSphericalCoords(
          distance * MathUtils.lerp(from.zoom, to.zoom, eased),
          MathUtils.lerp(from.phi, to.phi, eased),
          from.theta + turn * eased,
        );
        if (x >= 1) move = null;
      }

      controls.target.copy(target);
      camera.position.copy(target).add(offset);
      controls.minDistance = distance * MIN_ZOOM;
      controls.maxDistance = distance * MAX_ZOOM;
      const moved = controls.update();
      return following || moved || move !== null;
    },

    dispose() {
      controls.dispose();
    },
  };
}
