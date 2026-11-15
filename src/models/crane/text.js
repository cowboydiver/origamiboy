/**
 * Step titles and folding instructions, keyed by step id: [title, description].
 *
 * Each description says what the animation of that step really does, as seen
 * by the viewer at the start of the step. The valley / mountain guides are not
 * written here: they are derived from the motion (see guides.js), and the
 * tests check both against the animated fold.
 */
export const STEP_TEXT = {
  'book-1': [
    'Crease in half, side to side',
    'Start with the white side facing you. Fold the right edge over to meet the left edge, like closing a book. Press the fold flat, then open the paper again.',
  ],
  'book-2': [
    'Crease in half, top to bottom',
    'Fold the top edge down to meet the bottom edge, press flat, then open the paper again. You now have two creases that cross in the middle.',
  ],
  'turn-over-1': ['Turn the paper over', 'Flip the paper over like a page, so the coloured side faces you.'],
  'diagonal-1': [
    'Crease the first diagonal',
    'Fold the bottom-right corner up to meet the top-left corner, press flat, then open the paper again.',
  ],
  'diagonal-2': [
    'Crease the second diagonal',
    'Fold the bottom-left corner up to meet the top-right corner, press flat, then open the paper again. Four creases now cross in the middle.',
  ],
  'preliminary-base': [
    'Collapse into a square base',
    'Now use all four creases at once. Push the middle of the paper up toward you. The two straight creases bend toward you (mountain folds) and the diagonal from top left to bottom right bends away (a valley fold), so its two corners tuck in between the others. Bring all four corners down to meet at the bottom and press flat: a small square, closed at the top and open at the bottom.',
  ],
  'kite-crease-1': [
    'Crease the sides to the centre',
    'Using the top layer only, fold the lower-left and lower-right edges in so they meet on the centre line. Press both folds flat, then open them again.',
  ],
  'top-crease-1': [
    'Crease the top triangle',
    'Fold the top point down toward you, along the line that joins the upper ends of the two creases you just made. Press hard through all the layers, then lift the point back up.',
  ],
  'petal-fold-1': [
    'Petal fold',
    'Lift the bottom corner of the top layer and swing it all the way up, hinging on the crease across the top triangle. As the flap opens, its two side creases bend the other way and the sides swing in until they meet on the centre line. Press flat into a long diamond that reaches up past the top point.',
  ],
  'turn-over-2': ['Turn the model over', 'Flip the model over like a page. You will repeat the last three steps on this side.'],
  'kite-crease-2': [
    'Crease the sides to the centre',
    'As before: using the top layer only, fold the lower-left and lower-right edges in to the centre line, press flat, then open them again.',
  ],
  'top-crease-2': [
    'Crease the top triangle',
    'Fold the short top point down toward you along the line joining the upper ends of the two creases, press hard, then lift it back up. The long flap behind it stays standing.',
  ],
  'petal-fold-2': [
    'Petal fold again',
    'Lift the bottom corner of the top layer all the way up, let the sides swing in to the centre line, and press flat. You now have a long diamond with two separate points at the bottom: the bird base.',
  ],
  'narrow-1': [
    'Narrow the lower points',
    'The two separate points are at the bottom. Using the top layer only, fold the lower-left and lower-right edges in to meet on the centre line, and leave them folded. These thin points will become the neck and the tail.',
  ],
  'turn-over-3': ['Turn the model over', 'Flip the model over like a page, so you can narrow the points on the other side.'],
  'narrow-2': [
    'Narrow the other side',
    'Fold the lower-left and lower-right edges in to the centre line on this side too, and leave them folded.',
  ],
  neck: [
    'Reverse fold the neck',
    'The right-hand point becomes the neck. Open the right half of the model like a book (the model turns so you can look inside). Swing the thin point up and out to the right between the two halves, letting the crease along its back edge turn inside out. Then close the model flat again with the point held in between.',
  ],
  tail: [
    'Reverse fold the tail',
    'Do the same with the left-hand point: open the left half, swing the point up and out to the left between the two halves so its back crease turns inside out, and close the model flat.',
  ],
  head: [
    'Fold the head',
    'Make a small reverse fold at the tip of the neck. Let the top of the neck open slightly, push the tip down between the two sides so it points forward and down, and pinch the neck shut again. This is the beak.',
  ],
  wings: [
    'Spread the wings',
    'Fold the front wing down toward you and the back wing down away from you, creasing straight across each wing just above the body, until the wings spread out almost level. The model turns to show you the finished crane.',
  ],
};
