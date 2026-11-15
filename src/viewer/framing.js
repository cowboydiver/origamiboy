/**
 * The arithmetic of framing, kept apart from the camera rig so that it can be
 * tested without a canvas: which sphere a bounding box needs, and how far away
 * the camera must be for that sphere to fit the view.
 */

/** Default view: a little to the right of straight on, slightly from above (degrees). */
export const HOME_AZIMUTH_DEG = 20;
export const HOME_ELEVATION_DEG = 12;
/** Breathing room around the model's bounding sphere. */
export const MARGIN = 1.03;
export const MIN_RADIUS = 0.2;

const RAD = Math.PI / 180;

/**
 * The sphere around a box: its centre and half its diagonal.
 * @param {ArrayLike<number>} box  min xyz, max xyz
 * @returns {{ x: number, y: number, z: number, radius: number }}
 */
export function sphereOfBox(box) {
  return {
    x: (box[0] + box[3]) / 2,
    y: (box[1] + box[4]) / 2,
    z: (box[2] + box[5]) / 2,
    radius: Math.max(MIN_RADIUS, 0.5 * Math.hypot(box[3] - box[0], box[4] - box[1], box[5] - box[2])),
  };
}

/**
 * Distance at which a sphere of `radius` fits the narrower of the two fields
 * of view.
 * @param {number} radius
 * @param {number} fovDeg   vertical field of view of the whole canvas
 * @param {number} aspect   canvas width / height
 * @param {number} [usable] fraction of the canvas height the model may use
 *                          (less than 1 when a band at the top is kept free)
 */
export function fitDistance(radius, fovDeg, aspect, usable = 1) {
  const tan = Math.tan((fovDeg * RAD) / 2);
  const vertical = Math.atan(tan * usable);
  const horizontal = Math.atan(tan * aspect);
  return (radius / Math.sin(Math.min(vertical, horizontal))) * MARGIN;
}
