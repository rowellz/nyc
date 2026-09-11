/** Publish the road-surface overlap cleanup into the existing worker. */
import { readFileSync, writeFileSync } from 'node:fs';
const root=new URL('../',import.meta.url), file=new URL('public/world/assets/tile.worker-Ai2ZdmRL.js',root);
let code=readFileSync(file,'utf8');
if(!code.includes('resolveRoadOverlaps as $resolveRoadOverlaps')) {
  const anchor='f.rasterize(c.pos,c.idx.slice(_),c.aA,1/0);';
  if(code.split(anchor).length!==2)throw new Error('Missing road finalization anchor');
  code=code.replace(anchor,anchor+'$resolveRoadOverlaps(c,a,o);');
  code="import { resolveRoadOverlaps as $resolveRoadOverlaps } from './road-overlap.js';\n"+code;
  writeFileSync(file,code);
}
writeFileSync(new URL('public/world/assets/road-overlap.js',root),readFileSync(new URL('src/client/src/streets/road-overlap.js',root)));
console.log('Published coplanar road-surface cleanup.');
