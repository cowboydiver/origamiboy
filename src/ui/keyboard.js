/**
 * Keyboard shortcuts, active anywhere on the page:
 *   Space                play / pause
 *   Left / Right         previous / next step
 *   Shift + Left/Right   fine scrub
 *   Home / End           start / end of the sequence
 * (While the timeline slider itself has focus, its own keys come first: plain
 * arrows nudge the playhead, Page Up / Page Down move by a step; see scrub.js.)
 *   L                    toggle loop
 *   A / D, W / S         turn the view left / right, tilt it up / down
 *   + / -                zoom in / out
 *   R                    reset the view
 */

/** Seconds moved by one fine-scrub key press. */
const FINE_STEP = 0.1;

const TURN = Math.PI / 12;
const TILT = Math.PI / 18;
const ZOOM = 1.2;

/**
 * @param {Object} options
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} options.clock
 * @param {ReturnType<typeof import('../core/player.js').createPlayer>} options.player
 * @param {() => void} options.onResetView
 * @param {(by: { azimuth?: number, polar?: number, zoom?: number }) => void} [options.onNudgeView]
 * @param {EventTarget} [options.target]
 * @returns {() => void} removes the listener
 */
export function installKeyboard({ clock, player, onResetView, onNudgeView = () => {}, target = window }) {
  function onKeyDown(event) {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const element = /** @type {HTMLElement|null} */ (event.target instanceof HTMLElement ? event.target : null);
    if (element?.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;

    // A held key repeats: fine for stepping and turning, not for toggles.
    const toggles = event.key === ' ' || event.key === 'Spacebar' || /^[lLrR]$/.test(event.key);
    if (event.repeat && toggles) {
      if (!element?.closest('button, a[href], summary')) event.preventDefault();
      return;
    }

    switch (event.key) {
      case ' ':
      case 'Spacebar':
        // A focused button handles Space itself; do not toggle twice.
        if (element?.closest('button, a[href], summary')) return;
        player.toggle();
        break;
      case 'ArrowLeft':
        if (event.shiftKey) player.seek(player.time - FINE_STEP);
        else player.seek(clock.previousStepTime(player.time));
        break;
      case 'ArrowRight':
        if (event.shiftKey) player.seek(player.time + FINE_STEP);
        else player.seek(clock.nextStepTime(player.time));
        break;
      case 'Home':
        player.seek(0);
        break;
      case 'End':
        player.seek(clock.total);
        break;
      case 'l':
      case 'L':
        player.setLoop(!player.loop);
        break;
      case 'r':
      case 'R':
        onResetView();
        break;
      case 'a':
      case 'A':
        onNudgeView({ azimuth: -TURN });
        break;
      case 'd':
      case 'D':
        onNudgeView({ azimuth: TURN });
        break;
      case 'w':
      case 'W':
        onNudgeView({ polar: -TILT });
        break;
      case 's':
      case 'S':
        onNudgeView({ polar: TILT });
        break;
      case '+':
      case '=':
        onNudgeView({ zoom: 1 / ZOOM });
        break;
      case '-':
      case '_':
        onNudgeView({ zoom: ZOOM });
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
