/**
 * The scrubber: one segment per step, as wide as the step is long, with a
 * draggable playhead. It is a single ARIA slider over the whole timeline.
 *
 * Pointer handling uses pointer events with capture, so mouse, pen and touch
 * all drag the same way and keep dragging when the pointer leaves the track.
 */
import { createScrubber } from './scrub.js';

const el = (tag, className) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
};

/**
 * @param {HTMLElement} root
 * @param {Object} options
 * @param {import('../origami/types.js').OrigamiStep[]} options.steps
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} options.clock
 * @param {ReturnType<typeof import('../core/player.js').createPlayer>} options.player
 */
export function createTimeline(root, { steps, clock, player }) {
  const stepCount = steps.length;
  const total = clock.total;

  const track = el('div', 'timeline__track');
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'Folding timeline');
  track.setAttribute('aria-orientation', 'horizontal');
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', total.toFixed(1));
  track.tabIndex = 0;

  const rail = el('div', 'timeline__rail');
  const segments = steps.map((step, index) => {
    const segment = el('div', 'timeline__segment');
    segment.style.left = `${(clock.starts[index] / total) * 100}%`;
    segment.style.width = `${(step.duration / total) * 100}%`;
    const bar = el('span', 'timeline__bar');
    const fill = el('span', 'timeline__fill');
    bar.append(fill);
    const number = el('span', 'timeline__number');
    number.textContent = String(index + 1);
    segment.append(bar, number);
    rail.append(segment);
    return { segment, fill, number };
  });
  const playhead = el('div', 'timeline__playhead');
  rail.append(playhead);
  track.append(rail);

  const tooltip = el('div', 'timeline__tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  const tooltipNumber = el('b');
  const tooltipTitle = el('span');
  tooltip.append(tooltipNumber, tooltipTitle);

  root.replaceChildren(track, tooltip);

  // --- mapping between pointer position and time ---------------------------
  const fractionAt = (clientX) => {
    const rect = rail.getBoundingClientRect();
    return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) : 0;
  };

  let hovered = -1;
  function showTooltip(fraction, index) {
    tooltipNumber.textContent = String(index + 1);
    tooltipTitle.textContent = steps[index].title;
    const rootRect = root.getBoundingClientRect();
    const railRect = rail.getBoundingClientRect();
    const half = tooltip.offsetWidth / 2;
    const x = railRect.left - rootRect.left + fraction * railRect.width;
    const clamped = Math.min(rootRect.width - half - 4, Math.max(half + 4, x));
    tooltip.style.transform = `translateX(${clamped - half}px)`;
    tooltip.toggleAttribute('data-visible', true);
    if (index !== hovered) {
      if (hovered >= 0) segments[hovered].segment.removeAttribute('data-hover');
      segments[index].segment.setAttribute('data-hover', '');
      hovered = index;
    }
  }
  function hideTooltip() {
    tooltip.removeAttribute('data-visible');
    if (hovered >= 0) segments[hovered].segment.removeAttribute('data-hover');
    hovered = -1;
  }

  // --- dragging ------------------------------------------------------------
  const scrubber = createScrubber({ clock, player });

  function scrubTo(event) {
    const fraction = fractionAt(event.clientX);
    showTooltip(fraction, clock.indexAt(fraction * total));
    return fraction;
  }

  function endDrag(event) {
    if (!scrubber.end(event.pointerId)) return;
    track.removeAttribute('data-dragging');
    if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
    if (event.pointerType !== 'mouse') hideTooltip();
  }

  track.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    // A second finger does not take over a drag that is under way.
    if (!scrubber.begin(event.pointerId, scrubTo(event))) return;
    // No preventDefault: the browser focuses the slider itself, and because that
    // focus came from a pointer it does not draw the keyboard focus ring.
    try {
      track.setPointerCapture(event.pointerId);
    } catch {
      // Capture is a nicety; without it the drag simply ends at the track's edge.
    }
    track.setAttribute('data-dragging', '');
  });
  track.addEventListener('pointermove', (event) => {
    if (scrubber.dragging) {
      const fraction = fractionAt(event.clientX);
      if (scrubber.move(event.pointerId, fraction)) showTooltip(fraction, clock.indexAt(fraction * total));
    } else if (event.pointerType === 'mouse') {
      const fraction = fractionAt(event.clientX);
      showTooltip(fraction, clock.indexAt(fraction * total));
    }
  });
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  // Capture can be lost without a pointerup (window blur, a system dialog).
  track.addEventListener('lostpointercapture', endDrag);
  track.addEventListener('pointerleave', (event) => {
    if (!scrubber.dragging) hideTooltip();
    else if (!track.hasPointerCapture(event.pointerId)) endDrag(event);
  });

  // With the slider itself focused, the arrow keys nudge the value as on any
  // slider; the page-wide shortcuts (keyboard.js) skip events handled here.
  track.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (scrubber.key(event.key)) event.preventDefault();
  });

  // --- rendering -----------------------------------------------------------
  const located = { index: 0, t: 0 };
  let currentIndex = -1;
  let announced = '';

  function update(time) {
    clock.locate(time, located);
    const { index, t } = located;
    rail.style.setProperty('--progress', (time / total).toFixed(5));

    if (index !== currentIndex) {
      segments.forEach(({ segment, fill }, i) => {
        segment.dataset.state = i < index ? 'done' : i === index ? 'current' : 'todo';
        if (i !== index) fill.style.setProperty('--fill', i < index ? '1' : '0');
      });
      currentIndex = index;
    }
    segments[index].fill.style.setProperty('--fill', t.toFixed(4));

    // Screen readers get the step and a coarse percentage, not a stream of decimals.
    const percent = Math.round(t * 20) * 5;
    const text = `Step ${index + 1} of ${stepCount}: ${steps[index].title}, ${percent}% done`;
    if (text !== announced) {
      announced = text;
      track.setAttribute('aria-valuetext', text);
    }
    track.setAttribute('aria-valuenow', time.toFixed(1));
  }

  // Step numbers only where there is room for them.
  function fitNumbers() {
    const width = rail.getBoundingClientRect().width;
    let lastRight = -Infinity;
    segments.forEach(({ number }, index) => {
      const centre = ((clock.starts[index] + clock.starts[index + 1]) / 2 / total) * width;
      const needed = 7 * String(index + 1).length + 6;
      const fits = centre - needed / 2 >= lastRight;
      number.hidden = !fits;
      if (fits) lastRight = centre + needed / 2;
    });
  }
  const observer = new ResizeObserver(fitNumbers);
  observer.observe(rail);
  fitNumbers();

  return {
    element: track,
    update,
    dispose() {
      observer.disconnect();
    },
  };
}
