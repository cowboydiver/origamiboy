import { describe, expect, it } from 'vitest';
import { createClock, easeStep, formatTime } from '../src/core/clock.js';

const steps = [{ duration: 2 }, { duration: 1 }, { duration: 3 }];

describe('createClock', () => {
  const clock = createClock(steps);

  it('lays the steps end to end', () => {
    expect(clock.stepCount).toBe(3);
    expect(clock.total).toBe(6);
    expect(Array.from(clock.starts)).toEqual([0, 2, 3, 6]);
  });

  it('maps a time to its step and linear local progress', () => {
    expect(clock.locate(0)).toEqual({ index: 0, t: 0 });
    expect(clock.locate(1)).toEqual({ index: 0, t: 0.5 });
    expect(clock.locate(2.5)).toEqual({ index: 1, t: 0.5 });
    expect(clock.locate(4.5)).toEqual({ index: 2, t: 0.5 });
  });

  it('gives a boundary to the step that starts there, and the end to the last step', () => {
    expect(clock.locate(2)).toEqual({ index: 1, t: 0 });
    expect(clock.locate(3)).toEqual({ index: 2, t: 0 });
    expect(clock.locate(6)).toEqual({ index: 2, t: 1 });
  });

  it('clamps times outside the timeline', () => {
    expect(clock.locate(-5)).toEqual({ index: 0, t: 0 });
    expect(clock.locate(99)).toEqual({ index: 2, t: 1 });
    expect(clock.clamp(-1)).toBe(0);
    expect(clock.clamp(7)).toBe(6);
    expect(clock.clamp(NaN)).toBe(0);
  });

  it('reuses the object it is given', () => {
    const out = { index: -1, t: -1 };
    expect(clock.locate(2.5, out)).toBe(out);
    expect(out).toEqual({ index: 1, t: 0.5 });
  });

  it('maps (step, progress) back to a time', () => {
    expect(clock.timeAt(0, 0)).toBe(0);
    expect(clock.timeAt(1, 0.5)).toBe(2.5);
    expect(clock.timeAt(2, 1)).toBe(6);
    expect(clock.stepStart(2)).toBe(3);
    expect(clock.stepEnd(0)).toBe(2);
    expect(clock.timeAt(9, 2)).toBe(6);
    expect(clock.timeAt(-3, -1)).toBe(0);
  });

  it('round-trips time -> (step, t) -> time everywhere on the timeline', () => {
    for (let i = 0; i <= 600; i++) {
      const time = (i / 600) * clock.total;
      const { index, t } = clock.locate(time);
      expect(clock.timeAt(index, t)).toBeCloseTo(time, 12);
      expect(t).toBeGreaterThanOrEqual(0);
      expect(t).toBeLessThanOrEqual(1);
    }
  });

  it('is monotonic: a later time never maps to an earlier (step, t)', () => {
    let previous = -1;
    for (let i = 0; i <= 600; i++) {
      const { index, t } = clock.locate((i / 600) * clock.total);
      const position = index + t * 0.999999;
      expect(position).toBeGreaterThanOrEqual(previous);
      previous = position;
    }
  });

  it('steps forwards to the start of the next step, then to the end', () => {
    expect(clock.nextStepTime(0)).toBe(2);
    expect(clock.nextStepTime(1.9)).toBe(2);
    expect(clock.nextStepTime(2)).toBe(3);
    expect(clock.nextStepTime(4)).toBe(6);
    expect(clock.nextStepTime(6)).toBe(6);
  });

  it('steps backwards to the start of this step, or the previous one when already there', () => {
    expect(clock.previousStepTime(1.5)).toBe(0);
    expect(clock.previousStepTime(2.9)).toBe(2);
    expect(clock.previousStepTime(2)).toBe(0);
    expect(clock.previousStepTime(2.1)).toBe(0);
    expect(clock.previousStepTime(6)).toBe(3);
    expect(clock.previousStepTime(0)).toBe(0);
  });

  it('rejects empty or zero-length timelines', () => {
    expect(() => createClock([])).toThrow();
    expect(() => createClock([{ duration: 0 }])).toThrow();
  });
});

describe('easeStep', () => {
  it('is fixed at the ends and the middle, and clamps', () => {
    expect(easeStep(0)).toBe(0);
    expect(easeStep(1)).toBe(1);
    expect(easeStep(0.5)).toBe(0.5);
    expect(easeStep(-1)).toBe(0);
    expect(easeStep(2)).toBe(1);
  });

  it('is monotonic, so scrubbing backwards exactly undoes scrubbing forwards', () => {
    let previous = 0;
    for (let i = 1; i <= 1000; i++) {
      const value = easeStep(i / 1000);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('eases in and out', () => {
    expect(easeStep(0.1)).toBeLessThan(0.1);
    expect(easeStep(0.9)).toBeGreaterThan(0.9);
  });
});

describe('formatTime', () => {
  it('prints minutes and zero-padded seconds', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(9.99)).toBe('0:09');
    expect(formatTime(75)).toBe('1:15');
    expect(formatTime(-3)).toBe('0:00');
  });
});
