#!/usr/bin/env node
/**
 * Renders contact sheets of the wired-in model to PNG, for looking at a motion
 * without a browser (development only; uses only the public model contract).
 *
 * Usage:
 *   node scripts/render-model.js                     every step: 5 moments x front + three-quarter view, plus the final pose
 *   node scripts/render-model.js <step>[+<step>...]  those steps (id or index), stacked in one sheet
 * Options:
 *   --model=crane|demo   which model (default: the wired-in one)
 *   --t=0,0.25,...       moments, as linear progress through the step
 *   --eased              pass t through the viewer's ease-in-out first, as the app does
 *   --views=front,q,...  see VIEWS in scripts/lib/raster.js
 *   --tile=300           tile size in pixels
 *   --zoom=cx,cy,cz,r    frame a fixed region instead of the whole step
 *   --follow             re-centre every tile on the model
 *   --guides             draw the fold guides on the t = 0 front tile
 *   --noedges            do not ink the folded edges
 *   --grid=N             wrap the tiles N per row
 *   --name=x  --out=dir  output file name and directory (default out/render)
 */
import fs from 'node:fs';
import path from 'node:path';
import { easeStep } from '../src/core/clock.js';
import { createModel } from '../src/models/index.js';
import { VIEWS, contactSheet, createRasterizer, encodePng } from './lib/raster.js';

const args = process.argv.slice(2);
const opt = (n, d) => { const a = args.find((x) => x.startsWith('--' + n + '=')); return a ? a.slice(n.length + 3) : d; };
const flag = (n) => args.includes('--' + n);
const model = createModel(opt('model', undefined));
const nv = model.vertexCount;
const pos = new Float32Array(3 * nv);
const raster = createRasterizer(model);
const outDir = path.resolve(opt('out', 'out/render'));
fs.mkdirSync(outDir, { recursive: true });
const TILE = +opt('tile', 300);
const timing = (t) => (flag('eased') ? easeStep(t) : t);

const stepIndex = (x) => {
  const i = /^\d+$/.test(x) ? +x : model.steps.findIndex((s) => s.id === x);
  if (i < 0 || i >= model.steps.length) throw new Error(`no step "${x}"`);
  return i;
};
const bounds = (into) => {
  for (let v = 0; v < nv; v++) for (let d = 0; d < 3; d++) { into.mn[d] = Math.min(into.mn[d], pos[3 * v + d]); into.mx[d] = Math.max(into.mx[d], pos[3 * v + d]); }
  return into;
};
const fresh = () => ({ mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] });

function renderSteps(stepList, { TS, views, name, grid = 0 }) {
  const tiles = [];
  const labels = [];
  for (const k of stepList) {
    const box = fresh();
    for (const t of TS) { model.pose(k, timing(t), pos); bounds(box); }
    let ctr = [0, 1, 2].map((d) => (box.mn[d] + box.mx[d]) / 2);
    let rad = Math.hypot(box.mx[0] - box.mn[0], box.mx[1] - box.mn[1], box.mx[2] - box.mn[2]) / 2;
    const zo = opt('zoom', null);
    if (zo) { const z = zo.split(',').map(Number); ctr = z.slice(0, 3); rad = z[3]; }
    for (const vn of views) for (const t of TS) {
      model.pose(k, timing(t), pos);
      let cc = ctr;
      if (flag('follow')) { const b = bounds(fresh()); cc = [0, 1, 2].map((d) => (b.mn[d] + b.mx[d]) / 2); }
      const guides = flag('guides') && t === 0 && vn === 'front' ? model.guides(k) : null;
      tiles.push(raster.renderTile(pos, VIEWS[vn], 0.47 / rad, cc, { tile: TILE, guides, edges: !flag('noedges') }));
      labels.push(t === TS[0] && vn === views[0] ? `${k + 1}` : String(t));
    }
  }
  const sheet = contactSheet(tiles, labels, grid || TS.length, TILE);
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, encodePng(sheet.width, sheet.height, sheet.rgb));
  console.log(file);
}

const TS = opt('t', '0,0.25,0.5,0.75,1').split(',').map(Number);
const views = opt('views', 'front,q').split(',');
for (const v of views) if (!VIEWS[v]) throw new Error(`no view "${v}" (have ${Object.keys(VIEWS).join(', ')})`);
const wanted = args.filter((a) => !a.startsWith('--'));

if (wanted.length) {
  const list = wanted.flatMap((a) => a.split('+')).map(stepIndex);
  renderSteps(list, { TS, views, name: opt('name', model.steps[list[list.length - 1]].id), grid: +opt('grid', 0) });
} else {
  for (let k = 0; k < model.steps.length; k += 2) {
    const list = [k, k + 1].filter((x) => x < model.steps.length);
    renderSteps(list, { TS, views, name: `steps-${String(k + 1).padStart(2, '0')}-${String(list[list.length - 1] + 1).padStart(2, '0')}` });
  }
  // The finished piece from all round.
  const k = model.steps.length - 1;
  model.pose(k, 1, pos);
  const b = bounds(fresh());
  const ctr = [0, 1, 2].map((d) => (b.mn[d] + b.mx[d]) / 2);
  const rad = Math.hypot(b.mx[0] - b.mn[0], b.mx[1] - b.mn[1], b.mx[2] - b.mn[2]) / 2;
  const names = ['front', 'q', 'q2', 'side', 'top', 'back', 'qb', 'low'];
  const tiles = names.map((v) => raster.renderTile(pos, VIEWS[v], 0.47 / rad, ctr, { tile: 400 }));
  const sheet = contactSheet(tiles, names.map(() => ''), 4, 400);
  const file = path.join(outDir, 'final.png');
  fs.writeFileSync(file, encodePng(sheet.width, sheet.height, sheet.rgb));
  console.log(file);
}
