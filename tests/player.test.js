import { describe, expect, it } from 'vitest';
import { createClock } from '../src/core/clock.js';
import { createPlayer } from '../src/core/player.js';

const make = (options) => createPlayer(createClock([{ duration: 2 }, { duration: 2 }]), options);

describe('createPlayer', () => {
  it('advances only while playing, scaled by speed', () => {
    const player = make();
    player.advance(1);
    expect(player.time).toBe(0);
    player.play();
    player.advance(0.5);
    expect(player.time).toBe(0.5);
    player.setSpeed(2);
    player.advance(0.5);
    expect(player.time).toBe(1.5);
  });

  it('stops at the end when not looping, and restarts from the beginning on play', () => {
    const player = make();
    player.play();
    player.advance(10);
    expect(player.time).toBe(4);
    expect(player.playing).toBe(false);
    player.play();
    expect(player.time).toBe(0);
    expect(player.playing).toBe(true);
  });

  it('rests on the last frame, then wraps, when looping', () => {
    const player = make({ loop: true });
    player.play();
    player.advance(10);
    expect(player.time).toBe(4);
    expect(player.playing).toBe(true);
    player.advance(0.5);
    expect(player.time).toBe(4);
    player.advance(1);
    expect(player.time).toBe(0);
    expect(player.playing).toBe(true);
  });

  it('stops when the end is reached by a seek while playing, with loop off', () => {
    const player = make();
    const changes = [];
    player.play();
    player.advance(0.5);
    player.subscribe((_, change) => changes.push(change));
    player.seek(player.total); // the End key, or "next step" on the last step
    for (let i = 0; i < 60; i++) player.advance(0.05); // three seconds: longer than the loop rest
    expect(player.time).toBe(4);
    expect(player.playing).toBe(false);
    expect(changes).toEqual(['time', 'playing']);
  });

  it('stops at the end when loop is switched off during the rest before a restart', () => {
    const player = make({ loop: true });
    player.play();
    player.advance(10);
    player.advance(0.5); // resting on the finished piece
    player.setLoop(false);
    for (let i = 0; i < 60; i++) player.advance(0.05);
    expect(player.time).toBe(4);
    expect(player.playing).toBe(false);
  });

  it('still wraps after a seek to the end when looping', () => {
    const player = make({ loop: true });
    player.play();
    player.seek(4);
    player.advance(1);
    expect(player.time).toBe(4);
    player.advance(0.5);
    expect(player.time).toBe(0);
    expect(player.playing).toBe(true);
  });

  it('resume() carries on after a scrub but never rewinds from the end', () => {
    const player = make();
    player.seek(1);
    player.resume();
    expect(player.playing).toBe(true);
    expect(player.time).toBe(1);
    player.pause();
    player.seek(4); // scrubbed to the far right
    player.resume();
    expect(player.playing).toBe(false);
    expect(player.time).toBe(4);
    // The play button, by contrast, starts over.
    player.play();
    expect(player.time).toBe(0);
    expect(player.playing).toBe(true);
  });

  it('clamps seeks and tells subscribers what changed', () => {
    const player = make();
    const changes = [];
    player.subscribe((_, change) => changes.push(change));
    player.seek(99);
    expect(player.time).toBe(4);
    player.seek(-1);
    expect(player.time).toBe(0);
    player.seek(0);
    player.setLoop(true);
    player.toggle();
    player.toggle();
    expect(changes).toEqual(['time', 'time', 'loop', 'playing', 'playing']);
  });

  it('scrubbing there and back returns to exactly the same time', () => {
    const player = make();
    player.seek(1.2345);
    player.seek(3.3);
    player.seek(1.2345);
    expect(player.time).toBe(1.2345);
  });
});
