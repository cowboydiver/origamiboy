/**
 * Test helper: stretches a model into a long sequence by folding it, unfolding
 * it step by step in reverse, and repeating. Poses stay continuous, so the
 * result still satisfies the contract. Useful for checking the timeline and
 * step list at the length of a real piece (twenty-odd steps).
 */

/**
 * @param {import('../../src/origami/types.js').OrigamiModel} source
 * @param {number} [cycles]  each cycle is every step forwards, then every step backwards
 * @returns {import('../../src/origami/types.js').OrigamiModel}
 */
export function createLongModel(source, cycles = 2) {
  const count = source.steps.length;
  const plan = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    for (let i = 0; i < count; i++) plan.push({ from: i, reversed: false, cycle });
    for (let i = count - 1; i >= 0; i--) plan.push({ from: i, reversed: true, cycle });
  }
  // End on a forward pass so the sequence finishes folded.
  for (let i = 0; i < count; i++) plan.push({ from: i, reversed: false, cycle: cycles });

  const steps = plan.map(({ from, reversed, cycle }, index) => {
    const step = source.steps[from];
    return {
      id: `${index}-${step.id}${reversed ? '-undo' : ''}`,
      title: reversed ? `Undo: ${step.title.toLowerCase()}` : step.title,
      description: reversed ? `Reverse step ${from + 1}. (Pass ${cycle + 1}.)` : step.description,
      duration: reversed ? step.duration * 0.6 : step.duration,
      kind: reversed ? (step.kind === 'turn-over' ? 'turn-over' : 'unfold') : step.kind,
    };
  });

  return {
    name: `${source.name} (long)`,
    steps,
    vertexCount: source.vertexCount,
    indices: source.indices,
    uvs: source.uvs,
    pose(stepIndex, t, out) {
      const { from, reversed } = plan[Math.min(plan.length - 1, Math.max(0, Math.trunc(stepIndex)))];
      source.pose(from, reversed ? 1 - t : t, out);
    },
    guides(stepIndex) {
      const entry = plan[stepIndex];
      return entry && !entry.reversed ? source.guides(entry.from) : [];
    },
  };
}
