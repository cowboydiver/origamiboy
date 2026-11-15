/**
 * What the camera frames: every vertex of every pose must land inside the
 * canvas when seen from the home view, at any canvas shape, and the paper must
 * stay above the ground the shadow is drawn on.
 */
import { describe, expect, it } from 'vitest';
import { createClock, easeStep } from '../src/core/clock.js';
import { createCraneModel } from '../src/models/crane/crane.js';
import { createDemoModel } from '../src/models/demo.js';
import { analyseModel } from '../src/viewer/analysis.js';
import { HOME_AZIMUTH_DEG, HOME_ELEVATION_DEG, MARGIN, fitDistance, sphereOfBox } from '../src/viewer/framing.js';
import { CAMERA_FOV } from '../src/viewer/scene.js';
import { CLEARANCE } from '../src/viewer/shadow.js';

const RAD = Math.PI / 180;
/** Canvas shapes: wide desktop, the default desktop stage, square, phone portrait. */
const ASPECTS = [1.6, 1.32, 1, 0.56];
const MOMENTS = 80;

/**
 * Largest |NDC| coordinate of any vertex of `positions`, seen by the settled
 * home camera framing `box` on a canvas of the given shape.
 * `usable` < 1 keeps a band at the top free, as the stage does for the title.
 */
function extent(positions, box, aspect, usable = 1) {
  const sphere = sphereOfBox(box);
  const distance = fitDistance(sphere.radius, CAMERA_FOV, aspect, usable);
  const azimuth = HOME_AZIMUTH_DEG * RAD;
  const elevation = HOME_ELEVATION_DEG * RAD;
  // Unit vector from the target to the camera, and the camera's right and up vectors.
  const back = [Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)];
  const right = [Math.cos(azimuth), 0, -Math.sin(azimuth)];
  const up = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
  const tan = Math.tan((CAMERA_FOV * RAD) / 2);
  let most = { x: 0, top: -Infinity, bottom: Infinity };
  for (let i = 0; i < positions.length; i += 3) {
    const p = [positions[i] - sphere.x, positions[i + 1] - sphere.y, positions[i + 2] - sphere.z];
    const depth = distance - (p[0] * back[0] + p[1] * back[1] + p[2] * back[2]);
    const x = (p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) / (depth * tan * aspect);
    // The picture is shifted down by half the free band.
    const y = (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) / (depth * tan) - (1 - usable);
    most = { x: Math.max(most.x, Math.abs(x)), top: Math.max(most.top, y), bottom: Math.min(most.bottom, y) };
  }
  return most;
}

for (const [name, create] of [['crane', createCraneModel], ['demo', createDemoModel]]) {
  describe(`framing the ${name}`, () => {
    const model = create();
    const clock = createClock(model.steps);
    const analysis = analyseModel(model, clock);
    const positions = new Float32Array(3 * model.vertexCount);
    const box = new Float32Array(6);

    it('keeps the whole model inside the canvas at every moment of every step', () => {
      const worst = { value: 0, where: '' };
      model.steps.forEach((step, k) => {
        for (let i = 0; i <= MOMENTS; i++) {
          const t = i / MOMENTS;
          model.pose(k, easeStep(t), positions);
          analysis.boxAt(k, t, box);
          for (const aspect of ASPECTS) {
            const e = extent(positions, box, aspect);
            const value = Math.max(e.x, e.top, -e.bottom);
            if (value > worst.value) Object.assign(worst, { value, where: `${step.id} t=${t} aspect=${aspect}` });
          }
        }
      });
      // The fitted sphere leaves MARGIN of room, so nothing comes closer to the edge than this.
      expect(worst.value, worst.where).toBeLessThan(1 / MARGIN + 1e-3);
    });

    it('keeps it below a band left free at the top of the canvas', () => {
      const usable = 0.86; // a 56 px title band on a 400 px stage
      model.steps.forEach((step, k) => {
        for (let i = 0; i <= MOMENTS; i += 4) {
          const t = i / MOMENTS;
          model.pose(k, easeStep(t), positions);
          analysis.boxAt(k, t, box);
          for (const aspect of ASPECTS) {
            const e = extent(positions, box, aspect, usable);
            // NDC y of the lower edge of the band is 1 - 2 (1 - usable).
            expect(e.top, `${step.id} t=${t} aspect=${aspect}`).toBeLessThan(1 - 2 * (1 - usable));
            expect(e.bottom, `${step.id} t=${t} aspect=${aspect}`).toBeGreaterThan(-1);
            expect(e.x, `${step.id} t=${t} aspect=${aspect}`).toBeLessThan(1);
          }
        }
      });
    });

    it('frames exactly the resting shape at both ends of every step', () => {
      model.steps.forEach((step, k) => {
        for (const [t, boundary] of [[0, k], [1, k + 1]]) {
          analysis.boxAt(k, t, box);
          const exact = analysis.boxes.subarray(6 * boundary, 6 * boundary + 6);
          // Never smaller than the shape; larger only by what the next few moments need.
          for (let i = 0; i < 3; i++) {
            expect(box[i], `${step.id} t=${t}`).toBeLessThanOrEqual(exact[i] + 1e-9);
            expect(box[i + 3], `${step.id} t=${t}`).toBeGreaterThanOrEqual(exact[i + 3] - 1e-9);
          }
          const grown = sphereOfBox(box).radius / sphereOfBox(exact).radius;
          expect(grown, `${step.id} t=${t}`).toBeLessThan(1.05);
        }
      });
    });

    it('moves the framing smoothly: no jump from one moment to the next', () => {
      const previous = new Float32Array(6);
      model.steps.forEach((step, k) => {
        const fine = 400;
        analysis.boxAt(k, 0, previous);
        for (let i = 1; i <= fine; i++) {
          analysis.boxAt(k, i / fine, box);
          const a = sphereOfBox(previous);
          const b = sphereOfBox(box);
          const moved = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + Math.abs(a.radius - b.radius);
          expect(moved, `${step.id} t=${i / fine}`).toBeLessThan(0.02);
          previous.set(box);
        }
      });
      // And across every step boundary.
      for (let k = 0; k + 1 < model.steps.length; k++) {
        const a = sphereOfBox(analysis.boxAt(k, 1, previous));
        const b = sphereOfBox(analysis.boxAt(k + 1, 0, box));
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) + Math.abs(a.radius - b.radius), `after ${model.steps[k].id}`).toBeLessThan(1e-6);
      }
    });

    it('never lets the paper dip into the ground under it', () => {
      model.steps.forEach((step, k) => {
        for (let i = 0; i <= 4 * MOMENTS; i++) {
          const t = i / (4 * MOMENTS);
          model.pose(k, easeStep(t), positions);
          let lowest = Infinity;
          for (let v = 1; v < positions.length; v += 3) lowest = Math.min(lowest, positions[v]);
          const ground = analysis.floorAt(k, t) - CLEARANCE;
          expect(lowest - ground, `${step.id} t=${t}`).toBeGreaterThan(CLEARANCE / 2);
          // And the ground follows the model: it is never far below the lowest point either.
          expect(lowest - ground, `${step.id} t=${t}`).toBeLessThan(2 * CLEARANCE);
        }
      });
    });
  });
}
