/** Keep source and served pedestrian route validation aligned. Run after patch-pedestrian-height. */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const part = (s,a,b) => s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
function edit(code, from, to) {
  if (code.split(from).length!==2) throw new Error(`Missing unique path anchor ${from}`);
  return code.replace(from,()=>to);
}
let streets=read('public/world/assets/streets-CfYSUqyW.js');
if (!streets.includes('walkableAt:$walkableAt')) {
  const fn=stripTypeScriptTypes(part(read('src/client/src/streets/index.ts'),'  function walkableAt(', '  const groundHeight ='));
  const helper=`const $walkableAt=(()=>{const tiles=N,tileKey=p,TILE_SIZE=256,walkHeightIn=M;${fn}return walkableAt})();`;
  streets=edit(streets,'let z=new Set', helper+'let z=new Set');
  streets=edit(streets,'walkingHeight:$walkingHeight,','walkingHeight:$walkingHeight,walkableAt:$walkableAt,');
  writeFileSync(new URL('public/world/assets/streets-CfYSUqyW.js',root),streets);
}
let character=read('public/world/assets/character-O1u3Gxpp.js');
if (!character.includes('// NYC pedestrian paths v1')) {
  const src=read('src/client/src/character/peds.ts');
  const method=part(src,'  /** Reject little surviving islands', '  private trySpawn(');
  const wrapped=stripTypeScriptTypes('class Temp {\n'+method+'\n}');
  character=edit(character,'trySpawn(){','// NYC pedestrian paths v1\n'+wrapped.slice(wrapped.indexOf('{')+1,wrapped.lastIndexOf('}'))+'trySpawn(){');
  character=edit(character,'walkable(e,t,n){','walkable(e,t,n){const $streets=this.ctx.modules.get("streets");if($streets?.walkableAt)return !this.isInsideBuilding(e,t)&&$streets.walkableAt(e,t)===true;');
  character=edit(character,'this.canSpawn(s.x,s.z)&&!r.crossings','this.canSpawn(s.x,s.z)&&this.hasWalkingRoom(r,i,c)&&!r.crossings');
  character=edit(character,'!this.canSpawn(c.x,c.z))','!this.canSpawn(c.x,c.z)||!this.hasWalkingRoom(e,t,s))');
  character=edit(character,'if(k<e.speed*t*.2?', 'if((D-e.x)*_+(O-e.z)*v<e.speed*t*.2?');
  // Invalid corridors must be retried once their street tile finishes building.
  const bound=part(character,'bounds(e,t){','walkingLat(');
  const match=bound.match(/e\.widths\.set\(n,(\w+)\)/);
  if(!match)throw new Error('Missing bounds cache');
  character=edit(character,match[0],`(${match[1]}.lo!==${match[1]}.hi&&${match[0]})`);
  writeFileSync(new URL('public/world/assets/character-O1u3Gxpp.js',root),character);
}
console.log('Published rendered path validation, usable spawn corridors and blocked-route recovery.');
