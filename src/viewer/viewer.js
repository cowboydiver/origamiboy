/**
 * The 3D view: ties the stage, paper, ink edges, fold guides, ground shadow
 * and camera rig together behind a small interface.
 *
 * It renders on demand. Callers set the time, then call frame(dt) from their
 * animation loop for as long as it returns true or `onInvalidate` asks for one.
 */
import { easeStep } from '../core/clock.js';
import { analyseModel } from './analysis.js';
import { createCameraRig } from './cameraRig.js';
import { createEdges } from './edges.js';
import { createFoldBacks } from './foldBacks.js';
import { createGuides } from './guides.js';
import { createPaperMesh } from './paperMesh.js';
import { createStage } from './scene.js';
import { createGroundShadow } from './shadow.js';

const SHADOW_LOOK = {
  light: { colour: 0x33261a, opacity: 0.38 },
  dark: { colour: 0x000000, opacity: 0.7 },
};

/**
 * @param {Object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {import('../origami/types.js').OrigamiModel} options.model
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} options.clock
 * @param {() => void} [options.onInvalidate]  called when a new frame is needed
 */
export function createViewer({ canvas, model, clock, onInvalidate = () => {} }) {
  const stage = createStage(canvas);
  const paper = createPaperMesh(model);
  const foldBacks = createFoldBacks(model, paper.mesh.material);
  const edges = createEdges(model);
  const guides = createGuides(model);
  const shadow = createGroundShadow(stage.renderer, paper.mesh);
  const rig = createCameraRig(stage.camera, canvas);
  const analysis = analyseModel(model, clock, { observe: edges.observe });

  stage.scene.add(paper.mesh, foldBacks.mesh, edges.object, guides.object, shadow.object);

  let time = 0;
  let poseDirty = true;
  let renderDirty = true;
  const located = { index: 0, t: 0 };
  const box = new Float32Array(6);

  const invalidate = () => {
    renderDirty = true;
    onInvalidate();
  };
  rig.controls.addEventListener('change', invalidate);

  const observer = new ResizeObserver(invalidate);
  observer.observe(canvas);

  // Moving to a screen with a different pixel density changes no CSS size,
  // so it needs its own watch.
  let densityQuery = null;
  function watchDensity() {
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    densityQuery.addEventListener('change', onDensityChange, { once: true });
  }
  function onDensityChange() {
    invalidate();
    watchDensity();
  }
  watchDensity();

  // three.js rebuilds its GPU state after a lost context; everything just needs redrawing.
  function onContextRestored() {
    shadow.invalidate();
    invalidate();
  }
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  function applyPose() {
    clock.locate(time, located);
    const eased = easeStep(located.t);
    paper.setPose(located.index, eased);
    foldBacks.update(paper.positions);
    edges.update(paper.positions, time);
    guides.update(located.index, located.t, eased, paper.positions);
    rig.frame(analysis.boxAt(located.index, located.t, box));
    shadow.setFloor(analysis.floorAt(located.index, located.t));
    shadow.invalidate();
  }

  return {
    /** Shows the model at `seconds` on the timeline. Cheap; the work happens in frame(). */
    setTime(seconds) {
      if (seconds === time && !poseDirty) return;
      time = seconds;
      poseDirty = true;
      invalidate();
    },

    /**
     * Draws a frame if anything changed.
     * @param {number} dt  seconds since the previous frame
     * @returns {boolean} true while the camera is still settling and wants another frame
     */
    frame(dt) {
      if (stage.resize()) {
        rig.setUsableHeight(stage.usableHeight());
        renderDirty = true;
      }
      if (poseDirty) {
        applyPose();
        poseDirty = false;
        renderDirty = true;
      }
      const moving = rig.update(dt);
      if (moving || renderDirty) {
        shadow.render();
        stage.renderer.render(stage.scene, stage.camera);
        renderDirty = false;
      }
      return moving;
    },

    resetView(options) {
      rig.resetView(options);
      invalidate();
    },

    /**
     * Turns or zooms the view a little (keyboard orbiting).
     * @param {{ azimuth?: number, polar?: number, zoom?: number, immediate?: boolean }} by
     */
    nudgeView(by) {
      rig.nudge(by);
      invalidate();
    },

    /**
     * Keeps a band at the top of the canvas free of the model, for whatever
     * the page draws over it there.
     * @param {number} pixels  CSS pixels
     */
    setTopInset(pixels) {
      stage.setTopInset(pixels);
      invalidate();
    },

    /** Jumps the camera straight to its framing instead of gliding there. */
    snapCamera() {
      rig.snap();
      invalidate();
    },

    /** @param {'light'|'dark'} scheme */
    setScheme(scheme) {
      shadow.setLook(SHADOW_LOOK[scheme] ?? SHADOW_LOOK.light);
      invalidate();
    },

    dispose() {
      observer.disconnect();
      densityQuery?.removeEventListener('change', onDensityChange);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      rig.dispose();
      shadow.dispose();
      guides.dispose();
      edges.dispose();
      foldBacks.dispose();
      paper.dispose();
      stage.dispose();
    },
  };
}
