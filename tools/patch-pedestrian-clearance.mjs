/** Publish pedestrian-aware ramp profiles and the matching worker inputs. */
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
function patch(file, marker, edits, imports) {
  const path = new URL('public/world/assets/' + file, root);
  let code = readFileSync(path, 'utf8');
  if (code.includes(marker)) return;
  for (const [from,to] of edits) {
    if (code.split(from).length !== 2) throw new Error(`Missing pedestrian clearance anchor: ${from}`);
    code = code.replace(from, () => to);
  }
  writeFileSync(path, imports + '\n' + code);
}
patch('tile.worker-Ai2ZdmRL.js', 'pedestrianClearance as $pedestrianClearance', [
  ['roadTriangles:r=>$roadDeckTriangles(s.decks,r.id),', 'roadTriangles:r=>$roadDeckTriangles(s.decks,r.id),pedestrians:$pedestrianClearance(e.pedestrianTiles??[n],r,ir),'],
], "import { pedestrianClearance as $pedestrianClearance } from './pedestrian-clearance.js';");
patch('streets-CfYSUqyW.js', 'pedestrianTiles as $pedestrianTiles', [
  ['roads:Array.from(r.values()),quality:e.quality', 'roads:Array.from(r.values()),pedestrianTiles:$pedestrianTiles(e.world,n),quality:e.quality'],
], "import { pedestrianTiles as $pedestrianTiles } from './pedestrian-clearance.js';");
for (const file of ['ramps.js','supports.js','pedestrian-clearance.js'])
  writeFileSync(new URL('public/world/assets/'+file,root),readFileSync(new URL('src/client/src/streets/'+file,root)));
console.log('Published pedestrian clearance for ramps, approaches and support columns.');
