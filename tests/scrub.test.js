import { describe, expect, it } from 'vitest';
import { createClock } from '../src/core/clock.js';
import { createPlayer } from '../src/core/player.js';
import { SLIDER_STEP, createScrubber } from '../src/ui/scrub.js';

function make(options) {
  const clock = createClock([{ duration: 2 }, { duration: 4 }, { duration: 2 }]);
  const player = createPlayer(clock, options);
  return { clock, player, scrubber: createScrubber({ clock, player }) };
}

describe('scrubbing the timeline', () => {
  it('pauses during a drag and carries on from the new place afterwards', () => {
    const { player, scrubber } = make();
    player.play();
    player.advance(1);
    expect(scrubber.begin(1, 0.5)).toBe(true);
    expect(player.playing).toBe(false);
    expect(player.time).toBe(4);
    scrubber.move(1, 0.25);
    expect(player.time).toBe(2);
    expect(scrubber.end(1)).toBe(true);
    expect(player.playing).toBe(true);
    expect(player.time).toBe(2);
  });

  it('stays paused after a drag that started paused', () => {
    const { player, scrubber } = make();
    scrubber.begin(1, 0.5);
    scrubber.end(1);
    expect(player.playing).toBe(false);
    expect(player.time).toBe(4);
  });

  it('a drag to the far right while playing stays at the end instead of starting over', () => {
    const { player, scrubber } = make();
    player.play();
    player.advance(1);
    scrubber.begin(1, 0.4);
    scrubber.move(1, 1);
    scrubber.end(1);
    expect(player.time).toBe(8);
    expect(player.playing).toBe(false);
    // And nothing restarts it later.
    for (let i = 0; i < 60; i++) player.advance(0.05);
    expect(player.time).toBe(8);
    expect(player.playing).toBe(false);
  });

  it('a second pointer neither takes over the drag nor ends it', () => {
    const { player, scrubber } = make();
    player.play();
    scrubber.begin(1, 0.25);
    expect(scrubber.begin(2, 0.75)).toBe(false);
    expect(player.time).toBe(2);
    expect(scrubber.move(2, 0.9)).toBe(false);
    expect(player.time).toBe(2);
    expect(scrubber.end(2)).toBe(false);
    expect(scrubber.dragging).toBe(true);
    scrubber.move(1, 0.5);
    expect(player.time).toBe(4);
    scrubber.end(1);
    expect(scrubber.dragging).toBe(false);
    // Playback that the first touch interrupted resumes.
    expect(player.playing).toBe(true);
  });

  it('ending twice (pointerup, then lostpointercapture) is harmless', () => {
    const { player, scrubber } = make();
    player.play();
    scrubber.begin(7, 0.5);
    expect(scrubber.end(7)).toBe(true);
    player.pause();
    expect(scrubber.end(7)).toBe(false);
    expect(player.playing).toBe(false);
  });
});

describe('the slider keys', () => {
  it('nudges with the arrows and steps with Page Up / Page Down', () => {
    const { player, scrubber } = make();
    player.seek(3);
    expect(scrubber.key('ArrowRight')).toBe(true);
    expect(player.time).toBeCloseTo(3 + SLIDER_STEP, 9);
    scrubber.key('ArrowUp');
    expect(player.time).toBeCloseTo(3 + 2 * SLIDER_STEP, 9);
    scrubber.key('ArrowLeft');
    scrubber.key('ArrowDown');
    expect(player.time).toBeCloseTo(3, 9);
    scrubber.key('PageUp');
    expect(player.time).toBe(6);
    scrubber.key('PageDown');
    expect(player.time).toBe(2);
    scrubber.key('End');
    expect(player.time).toBe(8);
    scrubber.key('ArrowRight');
    expect(player.time).toBe(8);
    scrubber.key('Home');
    expect(player.time).toBe(0);
    scrubber.key('ArrowLeft');
    expect(player.time).toBe(0);
  });

  it('leaves every other key to the page', () => {
    const { player, scrubber } = make();
    for (const key of [' ', 'l', 'r', 'a', 'Tab', 'Enter', 'Escape']) expect(scrubber.key(key)).toBe(false);
    expect(player.time).toBe(0);
  });
});
