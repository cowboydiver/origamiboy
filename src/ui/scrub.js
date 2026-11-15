/**
 * The scrubber's behaviour without its DOM: what a drag and the slider's own
 * keys do to the player. timeline.js feeds it pointer and key events; keeping
 * it free of the document lets the tests drive it directly.
 */

/** Seconds moved by one arrow key press while the slider itself has focus. */
export const SLIDER_STEP = 0.25;

/**
 * @param {Object} options
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} options.clock
 * @param {ReturnType<typeof import('../core/player.js').createPlayer>} options.player
 */
export function createScrubber({ clock, player }) {
  /** The pointer that owns the drag in progress, or null. */
  let pointer = null;
  let resumeAfterDrag = false;

  return {
    get dragging() {
      return pointer !== null;
    },

    /**
     * A pointer went down on the track at `fraction` of its length.
     * @returns {boolean} false when another pointer already owns the drag
     */
    begin(pointerId, fraction) {
      if (pointer !== null) return false;
      pointer = pointerId;
      resumeAfterDrag = player.playing;
      player.pause();
      player.seek(fraction * clock.total);
      return true;
    },

    /** @returns {boolean} whether this pointer is the one dragging */
    move(pointerId, fraction) {
      if (pointerId !== pointer) return false;
      player.seek(fraction * clock.total);
      return true;
    },

    /**
     * The owning pointer was lifted, cancelled or lost its capture. Playback
     * that the drag interrupted carries on from the new position, but a scrub
     * to the very end stays there instead of starting over.
     * @returns {boolean} whether a drag ended
     */
    end(pointerId) {
      if (pointer === null || pointerId !== pointer) return false;
      pointer = null;
      if (resumeAfterDrag) player.resume();
      resumeAfterDrag = false;
      return true;
    },

    /**
     * Keys of the ARIA slider pattern, for when the slider itself has focus:
     * arrows nudge the value, Page Up / Page Down move by a whole step.
     * @param {string} key  KeyboardEvent.key
     * @returns {boolean} whether the key was handled
     */
    key(key) {
      switch (key) {
        case 'ArrowRight':
        case 'ArrowUp':
          player.seek(player.time + SLIDER_STEP);
          return true;
        case 'ArrowLeft':
        case 'ArrowDown':
          player.seek(player.time - SLIDER_STEP);
          return true;
        case 'PageUp':
          player.seek(clock.nextStepTime(player.time));
          return true;
        case 'PageDown':
          player.seek(clock.previousStepTime(player.time));
          return true;
        case 'Home':
          player.seek(0);
          return true;
        case 'End':
          player.seek(clock.total);
          return true;
        default:
          return false;
      }
    },
  };
}
