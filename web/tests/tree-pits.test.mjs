import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import vm from 'node:vm';
import {treePitYaw} from '../../public/world/assets/fixtures.js';

const close=(actual,expected,message)=>assert(Math.abs(Math.sin(actual-expected))<1e-7,message);
const road=(pts,extra={})=>({pts,cls:'residential',width:30,...extra});
const diagonal=road([[-100,-100],[100,100]]);
const wide={roads:[diagonal]};
close(treePitYaw(wide,-12,12),-Math.PI/4,'wide streets find their curb beyond the old 12 m centerline cutoff');
close(treePitYaw({roads:[],streetContext:{roads:[diagonal]}},-12,12),-Math.PI/4,'neighbor road context aligns boundary trees');
close(treePitYaw({roads:[road([[-100,12],[100,12]],{cls:'footway'}),
  road([[-12,-100],[-12,100]],{bridge:true}),diagonal]},-12,12),-Math.PI/4,'paths and overhead roads cannot rotate ground tree pits');

const pavement={roads:[road([[-100,0],[100,0]])],sidewalks:[[[[-10,-12],[12,10],[10,12],[-12,-10]]]]};
close(treePitYaw(pavement,0,0),-Math.PI/4,'actual sidewalk edges take precedence over mismatched centerlines');
close(treePitYaw({...pavement,sidewalks:pavement.sidewalks.map(poly=>poly.map(r=>r.slice().reverse()))},0,0),-Math.PI/4,'ring winding does not change alignment');
close(treePitYaw({tx:0,tz:0,sidewalks:[[[[252,0],[256,0],[256,2],[252,2]]]]},255,.8),0,'tile clipping seams are not curb directions');
close(treePitYaw({sidewalks:[[[[0,0],[10,0],[20,10],[18,12],[8,2],[0,2]]]]},15,6),-Math.PI/4,'a bent sidewalk uses its local edge');

// Check the entry points actually shipped to both pit/guard renderers.
for(const [name,fn] of [['environment-WQwLg8tn.js','Ut'],['props-coU--UuE.js','Nn']]) {
  const source=readFileSync(new URL(`../../public/world/assets/${name}`,import.meta.url),'utf8');
  const body=source.match(new RegExp(`function ${fn}\\(e,t,n\\)\\{[^}]+\\}`))[0];
  const ctx=vm.createContext({$treePitYaw:treePitYaw,tile:pavement});
  close(vm.runInContext(`${body};${fn}(tile,0,0)`,ctx),-Math.PI/4,`${name} uses shared alignment`);
}
// Real Highbridge/Washington Heights data must contain non-axis-aligned pits,
// including cases where the old road-only 12 m search returned its default yaw.
let corrected=0;
for(let tx=16;tx<=18;tx++)for(let tz=-42;tz<=-40;tz++) {
  const tile=JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`,import.meta.url))));
  for(const tree of tile.trees) {
    let nearest=Infinity;
    for(const r of tile.roads)for(let i=1;i<r.pts.length;i++) {
      if(r.tunnel)continue;
      const a=r.pts[i-1],b=r.pts[i],dx=b[0]-a[0],dz=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((tree.x-a[0])*dx+(tree.z-a[1])*dz)/(dx*dx+dz*dz||1)));
      nearest=Math.min(nearest,Math.hypot(tree.x-a[0]-t*dx,tree.z-a[1]-t*dz));
    }
    if(nearest>=12&&Math.abs(Math.sin(treePitYaw(tile,tree.x,tree.z)))>.1)corrected++;
  }
}
assert(corrected>0,'real trees no longer fall back to world-axis alignment');
console.log(`PASS sidewalk-aligned pits and guards: wide streets, curves, tile seams, road context; ${corrected} real 12 m cutoff cases corrected`);
