# origamiboy

An interactive origami folding guide. A sheet of paper is folded step by step in
3D; you scrub a timeline to fold and unfold it and drag to look at it from any side.

The piece is the traditional crane (orizuru), twenty steps from a flat square.
A small placeholder model ("Practice folds") is kept for development: open the
app with `?model=demo`. Both plug in through one module, see
[Swapping the model](#swapping-the-model).

## Running it

```sh
npm install
npm run dev        # development server
npm run build      # production build into dist/
npm run preview    # serve the production build
npm test           # unit tests (vitest)
npm run check-model     # run the wired-in model through the contract check
npm run validate-model  # physical validity report: strain, hinges, interpenetration, layer order
npm run render-model    # contact sheets of every step as PNGs in out/render/ (no browser needed)
```

`validate-model` and `render-model` are development tools that see a model only
through the contract; both take `--model=demo`. `render-model <step> --guides
--eased --views=front,q --t=0,0.5,1` renders single steps (see the header of
`scripts/render-model.js`).

Requires Node 22 or newer.

## Controls

| Action | Mouse / touch | Keyboard |
| --- | --- | --- |
| Rotate the model | drag | `A` `D` turn, `W` `S` tilt |
| Zoom | wheel / pinch | `+` `-` |
| Reset the view | "Reset view" button | `R` |
| Play / pause | play button | `Space` |
| Previous / next step | transport buttons, step list | `←` `→` |
| Scrub | drag or click the timeline | `Shift` + `←` `→` (0.1 s) |
| With the timeline focused | | `←` `→` `↑` `↓` nudge (0.25 s), `Page Up` / `Page Down` step |
| Start / end | | `Home` / `End` |
| Loop | loop button | `L` |

## Layout

```
src/
  main.js              wiring and the on-demand frame loop
  models/
    index.js           the swap point: createModel()
    demo.js            placeholder model (?model=demo)
    crane/
      crane.js         the crane as an OrigamiModel: mesh, pose(), guides()
      sequence.js      the folding sequence: flat-state operations + a motion per step
      motions.js       closed-form rigid kinematics (folds, collapse, petal, reverse fold, wings)
      guides.js        fold guides derived from the motions
      text.js          step titles and instructions
  origami/
    types.js           JSDoc typedef of the model contract
    contract.js        runtime contract check (dev, tests, CLI)
    flatSheet.js       exact flat-fold state engine (faces, isometries, layer order)
    geom.js            small 2D / 3D helpers
  core/
    clock.js           time <-> (step, t) mapping, easing
    player.js          play / pause / speed / loop state
  viewer/
    viewer.js          ties the 3D pieces together
    scene.js           renderer, camera, lights, resize
    paperMesh.js       the two-sided sheet; positions rewritten by model.pose()
    edges.js           ink outline and crease lines
    guides.js          valley / mountain fold guides
    shadow.js          soft ground shadow (no shadow maps)
    adjacency.js       which triangles are neighbours on the paper (from the uvs)
    foldBacks.js       strips that close every folded crease, so a stack of layers shows one edge
    cameraRig.js       orbiting plus automatic framing
    framing.js         the arithmetic of framing: bounding sphere, fitted distance
    analysis.js        bounding boxes and lowest points through every step, computed once at load
  ui/
    timeline.js        the scrubber (an ARIA slider)
    scrub.js           what a drag and the slider's keys do to the player (no DOM)
    controls.js        transport, speed, loop, time read-out
    stepPanel.js       current step card and the step list
    keyboard.js        shortcuts
  styles/              design tokens and layout
tests/                 vitest suites and model helpers
scripts/
  check-model.js       CLI contract check
  validate-model.js    CLI validity report with hard limits (scripts/lib/limits.js)
  render-model.js      CLI software renderer
  lib/                 contract-only metrics, fold-sense probes, speed profiles, rasterizer
```

## The crane

`src/models/crane/sequence.js` folds an exact model of the sheet: convex faces,
each with a 2D isometry and a layer key, snapshotted after every fold. Each
step pairs that with a closed-form rigid motion from `motions.js`, and
`crane.js` adds the paper thickness (0.0018 per layer) when it writes a pose.

- **Crease sense.** The two book creases are made with the white side up, the
  paper is turned over, then the two diagonals: exactly the sense in which the
  collapse into the square base folds them, so the colour ends up outside.
- **Guides are derived, not typed.** `guides.js` compares the signed fold angle
  of every crease before and after the step's motion. A crease folded from flat
  is drawn where it is visible from the front; a crease turned inside out (the
  spine of a reverse fold) is drawn along the edge. Collinear pieces are merged
  into whole lines, and valley / mountain is the sense seen from the front.
- **Timing.** `pose()` moves at an even pace in `t`; the viewer applies the one
  ease-in-out per step. Inside a step only a few things are timed: a
  fold-and-unfold follows `sin(pi t)` so it rests folded flat half way; the
  two stages of a reverse fold (open, then swing and close) come to rest
  between them, and in the second stage the swing of the point and the closing
  of the pages share the time instead of the pages snapping shut at the end.
  Re-centring on the new shape waits until the guides have faded
  (`GUIDE_FADE_END` in `src/origami/types.js`, shared with the viewer).
- **Reverse folds.** Neck and tail are exact rigid motions: the half of the
  model that holds the point opens like a book, the point swings through
  between the two pages, and they close again. That is edge-on from the front,
  so during those two steps `pose()` also turns the whole model about its
  spine (44 degrees, after the guides have faded) and back again by the end of
  the step.
- **The head** is a small inside reverse fold of its own. A closed point
  cannot open at one end only while its faces stay rigid, so the top of the
  neck gets two soft creases per side that let it open like a mouth (a
  one-degree-of-freedom linkage, `mouthReverseFold` in `motions.js`): the head
  stays attached along its crease, passes between the two sides when they are
  flat, and the mouth shuts around it. Nothing below the mouth moves.
- **Layers.** Stacked sheets sit on locally compacted levels, 0.0018 apart:
  no step ends with more levels in use than its deepest stack has layers (24
  in the finished body). Where a sheet has room to spare it lies against its
  coloured-side neighbour, so open edges do not show white slits.
- **The last step** leaves the finished crane turned 20 degrees and tipped 10
  degrees toward the viewer. The default camera itself stands 20 degrees to the
  right, so that is a three-quarter view of 40: neck and beak in profile on the
  right, the tail apart from them on the left, both wings showing.
  `buildCraneModel({ turns: false })` gives tooling the same model without the
  presentation turns.
- **Known limitations.**
  - Two places have a step across a crease that is not folded, because rigid
    plane faces cannot bend round the thickness of the paper: the top of the
    neck stands four layers (0.0072) out around the head tucked into it, and
    the second "crease the top triangle" step, folded flat, wraps one sheet
    round six others (0.0108). Both are pinned by the tests.
  - Hinges of the neck and tail open by up to 0.025 beyond their resting gap
    while the model stands open (0.033 and 0.041 in all, 3 to 4% of the sheet's
    side), again the thickness of the opened stack. The viewer bridges the gap
    with a strip of paper (see below), so it does not show as a slit.
  - Faces joined by a crease or a vertex cut into each other by up to a third
    of a layer (0.0006) in the collapse and around the mouth of the head fold.
    Faces that are not neighbours on the paper never touch.
  - Seen from the side, the bare geometry shows the white inside of the paper
    between the layers of every stack (6% of the silhouette averaged over all
    directions). The viewer closes the folds, which leaves 0.2%.
  - The body stays flat-faceted; it is not inflated.

## Swapping the model

A model is a plain object described in `src/origami/types.js`: steps, a fixed
triangle list, uvs, `pose(stepIndex, t, out)` and `guides(stepIndex)`.

1. Add the model as an ES module that exports a factory returning that object.
2. Register it in `MODELS` in `src/models/index.js` and make it `DEFAULT_MODEL`
   (any registered model can also be opened with `?model=<name>`).
3. Run `npm run check-model`. It reports contract violations (flat start,
   winding, continuity between steps, finite output, guide shape) and warns
   about stretching faces or a slow `pose()`. `npm run validate-model` goes
   further: hinge gaps, interpenetration, z-fighting and layer order.

In development the same check runs in the browser and logs to the console.

What the viewer assumes beyond the contract:

- It eases every step once (`easeStep` in `src/core/clock.js`) and hands the
  eased value to `pose()`. A model should move at an even pace in `t` and not
  ease the ends of a step itself.

- Two faces are treated as joined by a crease when they share an edge on the
  unfolded square, so vertices on a shared crease must have matching uvs
  (to 1e-5). That adjacency drives the ink crease lines.
- Fold guides are drawn where `guides()` puts them at the start of the step,
  fade in over the last fifth of a second of the step before, and fade out by
  `GUIDE_FADE_END` of the step itself. Every dash is tied to the face it lies
  on and rides with it, so a guide stays on its crease while the paper folds.
  A step that also re-centres or turns the whole model should still do that
  only after `GUIDE_FADE_END`.
- The camera frames a blend of the bounding boxes at the two ends of a step,
  widened by whatever the pose needs at the moment (the pass in `analysis.js`
  samples every step 32 times); the ground follows the lowest point of the
  model. On a small stage the model is kept below the title.
- At every crease that is folded flat with the coloured side out, the viewer
  adds a narrow strip from the edge of one face to the edge of the other
  (`foldBacks.js`): the model's layers sit a little apart, and without it the
  edge of a stack shows as stripes of white. A fold with the white side out is
  left open. Ink lines that lie inside a closed stack are drawn faintly.
