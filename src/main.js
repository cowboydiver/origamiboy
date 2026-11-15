import '@fontsource-variable/fraunces/opsz.css';
import './styles/tokens.css';
import './styles/app.css';

import { createClock } from './core/clock.js';
import { createPlayer } from './core/player.js';
import { createModel } from './models/index.js';
import { createControls } from './ui/controls.js';
import { installKeyboard } from './ui/keyboard.js';
import { createStepPanel } from './ui/stepPanel.js';
import { createTimeline } from './ui/timeline.js';
import { createViewer } from './viewer/viewer.js';

const model = createModel();
if (import.meta.env.DEV) {
  // Development only: list any way the model departs from the contract.
  import('./origami/contract.js').then(({ reportModel }) => reportModel(model));
}

const clock = createClock(model.steps);
const player = createPlayer(clock);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

document.title = `${model.name} · Origami folding guide`;

// Frame-loop state, declared before anything that can ask for a frame.
let frameHandle = 0;
let lastFrame = 0;

// --- 3D view ---------------------------------------------------------------
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
/** @type {ReturnType<typeof createViewer> | null} */
let viewer = null;
try {
  viewer = createViewer({ canvas, model, clock, onInvalidate: requestFrame });
  viewer.setScheme(darkScheme.matches ? 'dark' : 'light');
  darkScheme.addEventListener('change', (event) => viewer.setScheme(event.matches ? 'dark' : 'light'));
} catch (error) {
  console.error('[origami] the 3D view could not start', error);
  canvas.hidden = true;
  document.querySelector('[data-stage-error]').hidden = false;
}

// On a small stage the title reaches toward the middle, where the model is:
// keep the model below it. On a wide stage it sits in a corner and costs nothing.
const masthead = document.querySelector('.masthead');
function reserveTitle() {
  if (!viewer) return;
  const stage = canvas.getBoundingClientRect();
  const title = masthead.getBoundingClientRect();
  const inTheWay = stage.width > 0 && title.right - stage.left > 0.38 * stage.width;
  viewer.setTopInset(inTheWay ? title.bottom - stage.top + 6 : 0);
}
new ResizeObserver(reserveTitle).observe(canvas);
document.fonts?.ready.then(reserveTitle);

function resetView() {
  viewer?.resetView({ immediate: reducedMotion.matches });
}

function nudgeView(by) {
  viewer?.nudgeView({ ...by, immediate: reducedMotion.matches });
}

// --- interface -------------------------------------------------------------
const timeline = createTimeline(document.querySelector('[data-timeline]'), { steps: model.steps, clock, player });
const controls = createControls(document, { clock, player, onResetView: resetView });
const stepPanel = createStepPanel(document, { model, clock, player });
installKeyboard({ clock, player, onResetView: resetView, onNudgeView: nudgeView });

function showTime() {
  const time = player.time;
  viewer?.setTime(time);
  timeline.update(time);
  controls.updateTime(time);
  stepPanel.update(time);
}

player.subscribe((_, change) => {
  if (change === 'time') {
    // A jump while paused should not glide the camera for users who asked for less motion.
    if (reducedMotion.matches && !player.playing) viewer?.snapCamera();
    showTime();
  } else {
    controls.updateState();
  }
  requestFrame();
});

// The hint has done its job once the model has been turned.
const hint = document.querySelector('[data-hint]');
canvas.addEventListener('pointerdown', () => hint.setAttribute('data-dismissed', ''), { once: true });

// --- frame loop: runs only while something is changing -----------------------
function requestFrame() {
  if (!frameHandle) frameHandle = requestAnimationFrame(onFrame);
}

function onFrame(now) {
  frameHandle = 0;
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0;
  lastFrame = now;
  if (player.playing) player.advance(dt);
  const settling = viewer ? viewer.frame(dt) : false;
  if (player.playing || settling) requestFrame();
  else lastFrame = 0;
}

controls.updateState();
showTime();
requestFrame();

// Play once on arrival, unless the visitor prefers reduced motion or has already taken over.
if (!reducedMotion.matches) {
  const start = window.setTimeout(() => {
    if (player.time === 0) player.play();
  }, 900);
  window.addEventListener('pointerdown', () => window.clearTimeout(start), { once: true, capture: true });
  window.addEventListener('keydown', () => window.clearTimeout(start), { once: true, capture: true });
}

if (import.meta.env.DEV) {
  // Handy in the console while developing: __origami.player.seek(3)
  window.__origami = { model, clock, player, viewer };
}
