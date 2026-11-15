/**
 * The written side of the guide: the card for the current step
 * ("Step n of N", title, instruction) and the clickable list of all steps.
 */
import { formatTime } from '../core/clock.js';
import { STEP_KIND_LABELS } from '../origami/types.js';

/**
 * @param {ParentNode} root
 * @param {Object} options
 * @param {import('../origami/types.js').OrigamiModel} options.model
 * @param {ReturnType<typeof import('../core/clock.js').createClock>} options.clock
 * @param {ReturnType<typeof import('../core/player.js').createPlayer>} options.player
 */
export function createStepPanel(root, { model, clock, player }) {
  const query = (selector) => root.querySelector(selector);
  const card = query('[data-step-card]');
  const count = query('[data-step-count]');
  const kind = query('[data-step-kind]');
  const title = query('[data-step-title]');
  const description = query('[data-step-description]');
  const container = query('[data-steps]');
  const toggle = query('[data-steps-toggle]');
  const list = query('[data-step-list]');
  const steps = model.steps;

  query('[data-model-name]').textContent = model.name;

  const items = steps.map((step, index) => {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'step';
    const number = document.createElement('span');
    number.className = 'step__number';
    number.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('span');
    name.className = 'step__title';
    name.textContent = step.title;
    const duration = document.createElement('span');
    duration.className = 'step__duration';
    duration.textContent = formatTime(clock.starts[index]);
    duration.setAttribute('aria-hidden', 'true');
    button.append(number, name, duration);
    button.addEventListener('click', () => player.seek(clock.stepStart(index)));
    item.append(button);
    list.append(item);
    return button;
  });

  // --- the list on narrow screens --------------------------------------------
  // There it is collapsed behind a toggle and opens as a sheet over the lower
  // part of the screen, so the paper above stays in view while a step is picked.
  const collapsible = () => getComputedStyle(toggle).display !== 'none';

  function setOpen(open) {
    if (open === container.hasAttribute('data-open')) return;
    container.toggleAttribute('data-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (open) keepRowInView(true);
  }
  toggle.addEventListener('click', () => setOpen(!container.hasAttribute('data-open')));
  // Picking a step puts the sheet away again; so does Escape, or a tap outside it.
  list.addEventListener('click', (event) => {
    if (collapsible() && event.target instanceof Element && event.target.closest('.step')) setOpen(false);
  });
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !collapsible() || !container.hasAttribute('data-open')) return;
    setOpen(false);
    toggle.focus();
    event.preventDefault();
  });
  document.addEventListener('pointerdown', (event) => {
    if (!container.hasAttribute('data-open') || !collapsible()) return;
    if (event.target instanceof Node && !container.contains(event.target)) setOpen(false);
  });

  const located = { index: 0, t: 0 };
  let currentIndex = -1;

  /** Scrolls the list (never the page) so that the active row shows. */
  function keepRowInView(centre = false) {
    const row = items[currentIndex];
    if (!row || list.clientHeight === 0) return;
    const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    if (centre) list.scrollTop = top - (list.clientHeight - row.offsetHeight) / 2;
    else if (top < list.scrollTop) list.scrollTop = top - 8;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top + row.offsetHeight - list.clientHeight + 8;
    }
  }
  // The list changes size when the layout switches between side panel and sheet.
  new ResizeObserver(() => keepRowInView()).observe(list);

  // --- the card ----------------------------------------------------------------
  // Where the card sits above the transport (narrow screens), its height must
  // not depend on how long the current instruction is, or the 3D view would
  // change size at every step. Reserve room for the longest one; the style
  // sheet caps that and lets the card scroll on very short screens.
  function reserveCard() {
    const fixed = getComputedStyle(card).getPropertyValue('--card-fixed').trim() === '1';
    if (!fixed) {
      card.style.removeProperty('--card-height');
      return;
    }
    // Measured on a hidden copy, so nothing is announced or seen to change.
    const copy = /** @type {HTMLElement} */ (card.cloneNode(true));
    copy.removeAttribute('aria-live');
    copy.setAttribute('aria-hidden', 'true');
    Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', height: 'auto', left: '0', top: '0', width: `${card.getBoundingClientRect().width}px` });
    card.parentNode.append(copy);
    const copyTitle = copy.querySelector('[data-step-title]');
    const copyText = copy.querySelector('[data-step-description]');
    let tallest = 0;
    for (const step of steps) {
      copyTitle.textContent = step.title;
      copyText.textContent = step.description;
      tallest = Math.max(tallest, copy.getBoundingClientRect().height);
    }
    copy.remove();
    card.style.setProperty('--card-height', `${Math.ceil(tallest)}px`);
  }
  let cardWidth = -1;
  new ResizeObserver(() => {
    const width = Math.round(card.getBoundingClientRect().width);
    if (width === cardWidth) return;
    cardWidth = width;
    reserveCard();
  }).observe(card);
  document.fonts?.ready.then(reserveCard);

  // While it plays, the card would be read out at every step, unasked; the
  // timeline slider's value text carries the step for whoever wants it. Paused,
  // a step change is something the user did, and is announced.
  const announce = () => card.setAttribute('aria-live', player.playing ? 'off' : 'polite');
  player.subscribe((_, change) => {
    if (change === 'playing') announce();
  });
  announce();

  return {
    /** @param {number} time */
    update(time) {
      clock.locate(time, located);
      const { index, t } = located;
      if (index !== currentIndex) {
        const step = steps[index];
        count.textContent = `Step ${index + 1} of ${steps.length}`;
        kind.textContent = STEP_KIND_LABELS[step.kind] ?? step.kind;
        title.textContent = step.title;
        description.textContent = step.description;
        card.scrollTop = 0;
        items.forEach((button, i) => {
          button.dataset.state = i < index ? 'done' : i === index ? 'current' : 'todo';
          if (i === index) button.setAttribute('aria-current', 'step');
          else button.removeAttribute('aria-current');
        });
        currentIndex = index;
        // Keep the active row in view without moving the page itself.
        keepRowInView();
      }
      items[index].style.setProperty('--step-progress', t.toFixed(4));
    },
  };
}
