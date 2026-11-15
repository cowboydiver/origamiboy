/**
 * The single swap point for the piece being shown.
 *
 * To show a different model, add a factory returning an OrigamiModel (see
 * ../origami/types.js) to MODELS and make it the default. Nothing else in the
 * app needs to change. `npm run check-model` validates whatever is wired in.
 *
 * The placeholder stays available for development and for the tests of the
 * app shell: open the app with ?model=demo, or call createModel('demo').
 */
import { createCraneModel } from './crane/crane.js';
import { createDemoModel } from './demo.js';

const MODELS = {
  crane: createCraneModel,
  demo: createDemoModel,
};

export const DEFAULT_MODEL = 'crane';
export const MODEL_NAMES = Object.freeze(Object.keys(MODELS));

/** The model asked for in the page address (?model=demo), if any. */
function requestedModel() {
  const search = globalThis.location?.search;
  if (!search) return null;
  return new URLSearchParams(search).get('model');
}

/**
 * @param {string} [name]  one of MODEL_NAMES; defaults to ?model=... in the
 *                         browser, else the crane. Unknown names fall back to the default.
 * @returns {import('../origami/types.js').OrigamiModel}
 */
export function createModel(name = requestedModel() ?? DEFAULT_MODEL) {
  const create = Object.hasOwn(MODELS, name) ? MODELS[name] : MODELS[DEFAULT_MODEL];
  return create();
}
