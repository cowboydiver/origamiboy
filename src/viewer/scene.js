/**
 * Renderer, scene, camera and lights.
 *
 * The canvas is transparent: the page behind it supplies the background, so the
 * light and dark themes are pure CSS. The key light rides with the camera, so
 * the model reads as an object being turned in the hand and never goes dark
 * when it is viewed from behind.
 */
import {
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';

const MAX_PIXEL_RATIO = 2;

/**
 * Clip planes. Stacked layers of a folded model are only ~0.002 apart, and
 * depth precision at distance z is about z^2 / (near * 2^24) with a 24-bit
 * buffer: the near plane must not come closer than this, or the layers start
 * to z-fight. The camera rig keeps the paper at least about 0.1 away, so nothing is clipped.
 */
export const CAMERA_NEAR = 0.07;
export const CAMERA_FAR = 60;
export const CAMERA_FOV = 30;

/**
 * @param {HTMLCanvasElement} canvas
 */
export function createStage(canvas) {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);
  camera.position.set(0, 0, 3);
  scene.add(camera);

  // Soft, slightly warm sky over a dimmer bounce from below. Intensities are
  // balanced so a face turned to the viewer lands just under full brightness
  // and no orientation clips.
  const ambient = new HemisphereLight(0xfffaf2, 0xcfc8bc, 1.1);
  scene.add(ambient);

  // Key: close to a headlight, nudged up and to the left. Faces turned toward
  // the viewer show their true colour; faces tilted away fall off, which is
  // what separates one flat-shaded flap from the next. It is parented to the
  // camera (with its target), so `position` is its direction in view space.
  const key = new DirectionalLight(0xfff8ef, 2.2);
  key.position.set(-0.28, 0.4, 0.9);
  key.target.position.set(0, 0, 0);
  camera.add(key, key.target);

  // A low fill from the right keeps faces turned away from the key readable.
  const fill = new DirectionalLight(0xe6edff, 0.45);
  fill.position.set(1, -0.25, 0.2);
  fill.target.position.set(0, 0, 0);
  camera.add(fill, fill.target);

  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  /** Height in CSS pixels of a band at the top of the canvas that the model stays clear of. */
  let topInset = 0;
  let appliedInset = -1;

  /**
   * Matches the drawing buffer to the canvas's CSS box.
   * @returns {boolean} whether anything changed
   */
  function resize() {
    const nextWidth = Math.max(1, Math.floor(canvas.clientWidth));
    const nextHeight = Math.max(1, Math.floor(canvas.clientHeight));
    const nextRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    if (nextWidth === width && nextHeight === height && nextRatio === pixelRatio && topInset === appliedInset) return false;
    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;
    appliedInset = topInset;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    // Shift the picture down by half the band, so that the point the camera
    // looks at sits in the middle of what is left below it.
    if (topInset > 0) camera.setViewOffset(width, height, 0, -topInset / 2, width, height);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    return true;
  }

  /**
   * Keeps a band at the top of the canvas free of the model (the title sits there on small stages).
   * @param {number} pixels  CSS pixels
   */
  function setTopInset(pixels) {
    topInset = Math.max(0, Math.round(pixels) || 0);
  }

  /** The fraction of the canvas height below the band. */
  function usableHeight() {
    return height > 0 ? Math.max(0.3, 1 - topInset / height) : 1;
  }

  function dispose() {
    renderer.dispose();
  }

  return { renderer, scene, camera, resize, setTopInset, usableHeight, dispose };
}
