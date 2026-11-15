/**
 * Transport buttons: previous / play-pause / next, the speed selector, the
 * loop toggle and the time read-out. The markup lives in index.html; this
 * module wires it to the player and keeps its state in sync.
 */
import { formatTime } from '../core/clock.js';

/**
 * @param {ParentNode} root
 * @param {Object} options
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} options.clock
 * @param {ReturnType<typeof import('../core/player.js').createPlayer>} options.player
 * @param {() => void} options.onResetView
 */
export function createControls(root, { clock, player, onResetView }) {
  const query = (selector) => root.querySelector(selector);
  const play = query('[data-action="play"]');
  const loop = query('[data-action="loop"]');
  const speeds = [...root.querySelectorAll('[data-speed]')];
  const timeNow = query('[data-time-now]');
  const timeTotal = query('[data-time-total]');

  query('[data-action="previous"]').addEventListener('click', () => player.seek(clock.previousStepTime(player.time)));
  query('[data-action="next"]').addEventListener('click', () => player.seek(clock.nextStepTime(player.time)));
  play.addEventListener('click', () => player.toggle());
  loop.addEventListener('click', () => player.setLoop(!player.loop));
  query('[data-action="reset-view"]').addEventListener('click', onResetView);
  for (const button of speeds) {
    button.addEventListener('click', () => player.setSpeed(Number(button.dataset.speed)));
  }

  timeTotal.textContent = formatTime(clock.total);
  let shownTime = '';

  return {
    /** Syncs everything that is not the time: play state, speed, loop. */
    updateState() {
      play.toggleAttribute('data-playing', player.playing);
      play.setAttribute('aria-label', player.playing ? 'Pause' : 'Play');
      loop.setAttribute('aria-pressed', String(player.loop));
      for (const button of speeds) {
        button.setAttribute('aria-pressed', String(Number(button.dataset.speed) === player.speed));
      }
    },
    /** @param {number} time */
    updateTime(time) {
      const text = formatTime(time);
      if (text !== shownTime) {
        shownTime = text;
        timeNow.textContent = text;
      }
    },
  };
}
