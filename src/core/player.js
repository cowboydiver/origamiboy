/**
 * Playback state for the timeline: current time, playing, speed and loop.
 * It owns no timer. The app's frame loop calls advance(dt) while playing, so
 * the same object works under requestAnimationFrame and in tests.
 */

/** How long a looping playback rests on the finished piece before restarting (seconds). */
const LOOP_REST = 1.4;

/**
 * @param {ReturnType<typeof import('./clock.js').createClock>} clock
 * @param {{ speed?: number, loop?: boolean }} [initial]
 */
export function createPlayer(clock, initial = {}) {
  let time = 0;
  let playing = false;
  let speed = initial.speed ?? 1;
  let loop = initial.loop ?? false;
  let rest = 0;

  /** @type {Set<(player: object, change: string) => void>} */
  const listeners = new Set();
  const emit = (change) => {
    for (const listener of listeners) listener(api, change);
  };

  const atEnd = () => time >= clock.total - 1e-9;

  const api = {
    get time() {
      return time;
    },
    get playing() {
      return playing;
    },
    get speed() {
      return speed;
    },
    get loop() {
      return loop;
    },
    get total() {
      return clock.total;
    },

    /** @param {(player: typeof api, change: 'time'|'playing'|'speed'|'loop') => void} listener */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    play() {
      if (playing) return;
      if (atEnd()) {
        time = 0;
        emit('time');
      }
      rest = 0;
      playing = true;
      emit('playing');
    },

    /**
     * Carries on from where the playhead is, as after a scrub that interrupted
     * playback. Unlike play() it never rewinds: at the end of the timeline it
     * stays paused there.
     */
    resume() {
      if (playing || atEnd()) return;
      api.play();
    },

    pause() {
      if (!playing) return;
      playing = false;
      emit('playing');
    },

    toggle() {
      if (playing) api.pause();
      else api.play();
    },

    /** Jumps to a time in seconds, clamped to the timeline. */
    seek(next) {
      const clamped = clock.clamp(next);
      rest = 0;
      if (clamped === time) return;
      time = clamped;
      emit('time');
    },

    setSpeed(next) {
      if (!(next > 0) || next === speed) return;
      speed = next;
      emit('speed');
    },

    setLoop(next) {
      if (Boolean(next) === loop) return;
      loop = Boolean(next);
      emit('loop');
    },

    /**
     * Moves time forward by `dt` real seconds. Call once per frame while playing.
     * @returns {boolean} whether playback is still running
     */
    advance(dt) {
      if (!playing || !(dt > 0)) return playing;

      if (atEnd()) {
        // The end was reached by a seek (End key, "next" on the last step), or
        // looping was switched off during the rest: without loop, stop here.
        if (!loop) {
          rest = 0;
          playing = false;
          emit('playing');
          return false;
        }
        // Resting on the finished piece before a loop restarts.
        rest += dt;
        if (rest >= LOOP_REST) {
          rest = 0;
          time = 0;
          emit('time');
        }
        return true;
      }

      time = Math.min(clock.total, time + dt * speed);
      emit('time');
      if (atEnd() && !loop) {
        playing = false;
        emit('playing');
      }
      return playing;
    },
  };

  return api;
}
