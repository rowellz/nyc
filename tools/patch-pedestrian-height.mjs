/** Publish pedestrian support selection without rebuilding the recovered client. */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
function replace(code, from, to) {
  if (code.split(from).length !== 2) throw new Error(`Expected one pedestrian height anchor: ${from}`);
  return code.replace(from, () => to);
}
const streetsPath = 'public/world/assets/streets-CfYSUqyW.js';
let streets = read(streetsPath);
if (!streets.includes('walkingHeight:$walkingHeight')) {
  const source = read('src/client/src/streets/index.ts');
  const fn = source.slice(source.indexOf('  function walkingHeight('), source.indexOf('  const groundHeight ='));
  const js = stripTypeScriptTypes(fn);
  const helper = `const $walkingHeight=(()=>{const ctx=e,baseGroundHeight=F,tiles=N,tileKey=p,TILE_SIZE=256,walkHeightIn=M;${js}return walkingHeight})();`;
  streets = replace(streets, 'e.physics.groundHeight=L;', 'e.physics.groundHeight=L;' + helper);
  streets = replace(streets, 'deckHeight:P,', 'deckHeight:P,walkingHeight:$walkingHeight,');
  writeFileSync(new URL(streetsPath, root), streets);
}
const characterPath = 'public/world/assets/character-O1u3Gxpp.js';
let character = read(characterPath);
if (!character.includes('// NYC pedestrian support v1')) {
  const source = read('src/client/src/character/peds.ts');
  const method = source.slice(source.indexOf('  private walkingHeight('), source.indexOf('  private buildEgresses('));
  const wrapped = stripTypeScriptTypes('class PedHeight {\n' + method + '\n}');
  const js = '// NYC pedestrian support v1\n' + wrapped.slice(wrapped.indexOf('{') + 1, wrapped.lastIndexOf('}'));
  character = replace(character, 'canSpawn(e,t){', js + 'canSpawn(e,t){');
  for (const [from, to] of [
    ['this.ctx.physics.groundHeight(e,t)', 'this.walkingHeight(e,t)'],
    ['this.ctx.physics.groundHeight(r.x,r.z)', 'this.walkingHeight(r.x,r.z)'],
    ['this.ctx.physics.groundHeight(this.seatFront(n).x,this.seatFront(n).z)', 'this.walkingHeight(this.seatFront(n).x,this.seatFront(n).z)'],
    ['r.gy=t.physics.groundHeight(r.x,r.z)', 'r.gy=this.walkingHeight(r.x,r.z)'],
  ]) character = replace(character, from, to);
  writeFileSync(new URL(characterPath, root), character);
}
console.log('Published ground-level pedestrian support for spawning, walking and seating.');
