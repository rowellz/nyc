/** Final coordinate conversion, after the existing datum-based client patches. */
export const elevationAssetPaths = new Set([
  'world/assets/main-D_3aygO4.js','world/assets/environment-WQwLg8tn.js',
  'world/assets/tile.worker-Ai2ZdmRL.js','world/assets/streets-CfYSUqyW.js',
  'world/assets/foundations.js','world/assets/vehicles-_zJz3z3J.js',
  'world/assets/landmarks-KpQKy0CX.js',
  'world/assets/builder.worker-D9_Czkt3.js',
]);
export function elevationAssetTransform(rel,source) {
  if(!elevationAssetPaths.has(rel))return source;
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw Error(`Elevation anchor changed in ${rel}: ${before}`);
    source=source.replace(before,after);
  };
  source="import { terrainHeight as $terrainHeight, elevateMesh as $elevateMesh, elevateGeometry as $elevateGeometry, buildingElevation as $buildingElevation, updateGrassElevation as $updateGrassElevation, elevateLandmark as $elevateLandmark } from './elevation.js';\n"+source;
  if(rel.endsWith('/main-D_3aygO4.js')) {
    replace('k.modules.set(`telemetry`,ku(k))', 'k.terrainHeight=$terrainHeight,k.modules.set(`telemetry`,ku(k))');
    replace('if(!e.water.length&&!$holes.length)t=wc.cuboid', 'if(false)t=wc.cuboid');
    replace('if(!n.indices.length)return;t=wc.trimesh(n.vertices,n.indices)',
      'if(!n.indices.length)return;const lifted=$elevateMesh({position:{array:n.vertices,itemSize:3}},n.indices);t=wc.trimesh(lifted.attributes.position.array,lifted.index)');
    replace('r?.water.some(n=>Uc(e,t,n))?-100:0','r?.water.some(n=>Uc(e,t,n))?-100:$terrainHeight(e,t)');
  } else if(rel.endsWith('/environment-WQwLg8tn.js')) {
    replace('i.translate(n+128,0,r+128),i.computeBoundingSphere(),i','i.translate(n+128,0,r+128),$elevateGeometry(i)');
    replace('r.setPosition(a.x,o,a.z)','r.setPosition(a.x,o+$terrainHeight(a.x,a.z),a.z)');
    replace('r.setY(n*4+e,t?-100:-.25)', 'r.setY(n*4+e,t?-100:$terrainHeight(r.getX(n*4+e),r.getZ(n*4+e))-.25)');
    replace('r.set([s,l,c,s+256,l,c,s+256,l,c+256,s,l,c+256],u)',
      'r.set([s,l+(x.has(t)?0:$terrainHeight(s,c)),c,s+256,l+(x.has(t)?0:$terrainHeight(s+256,c)),c,s+256,l+(x.has(t)?0:$terrainHeight(s+256,c+256)),c+256,s,l+(x.has(t)?0:$terrainHeight(s,c+256)),c+256],u)');
    replace('E.position.set(n.x,0,n.z)','E.position.set(n.x,$terrainHeight(n.x,n.z),n.z)');
    replace('E.position.set(e.x,.034,e.z)','E.position.set(e.x,.034+$terrainHeight(e.x,e.z),e.z)');
    replace('E.position.set(t.tree.x,Kt,t.tree.z)','E.position.set(t.tree.x,Kt+$terrainHeight(t.tree.x,t.tree.z),t.tree.z)');
    replace('let d={uCamCell:', 'let d={uElevation:{value:new Float32Array(16)},uElevationOrigin:{value:new s},uCamCell:');
    replace('d.uCamCell.value.set(Math.floor(n/Ne),Math.floor(r/Ne));',
      'd.uCamCell.value.set(Math.floor(n/Ne),Math.floor(r/Ne));$updateGrassElevation(d,n,r);');
    replace('uniform vec2 uCamCell; uniform float uCell, uRadius, uPerCell, uSide;',
      `uniform float uElevation[16]; uniform vec2 uElevationOrigin;
float terrainGrass(vec2 p) {
  vec2 g=clamp((p-uElevationOrigin)/64.0,vec2(0.0),vec2(2.9999)),f=fract(g);
  int i=int(floor(g.y))*4+int(floor(g.x));
  float a=uElevation[i],b=uElevation[i+1],c=uElevation[i+4],d=uElevation[i+5];
  return f.x+f.y<=1.0?a+f.x*(b-a)+f.y*(c-a):d+(1.0-f.x)*(c-d)+(1.0-f.y)*(b-d);
}
uniform vec2 uCamCell; uniform float uCell, uRadius, uPerCell, uSide;`);
    replace('vec3 envWpos = vec3(envP.x, 0.0, envP.y)', 'vec3 envWpos = vec3(envP.x, terrainGrass(envP), envP.y)');
    replace('vec3 envNormalW = normalize(vec3((nrm.x * 2.0 - 1.0) * nStr, 1.0, -(nrm.y * 2.0 - 1.0) * nStr));',
      'vec3 envNormalW = normalize(inverseTransformDirection(vNormal, viewMatrix) + vec3((nrm.x * 2.0 - 1.0) * nStr, 0.0, -(nrm.y * 2.0 - 1.0) * nStr));');
  } else if(rel.endsWith('/tile.worker-Ai2ZdmRL.js')) {
    source="import { elevateStreetTile as $elevateStreetTile } from './elevation-streets.js';\n"+source;
    replace('let e=$railCuts(mi(n),n.tile);self.postMessage','let e=$elevateStreetTile($railCuts(mi(n),n.tile),n.tile);self.postMessage');
  } else if(rel.endsWith('/streets-CfYSUqyW.js')) {
    replace('return n?Math.max(k(n.decks,e,t),n.walkCollision?M(n.walkCollision,e,t,n.tile.tx*256,n.tile.tz*256):0):0',
      'if(!n)return 0;const deck=k(n.decks,e,t),walk=n.walkCollision?M(n.walkCollision,e,t,n.tile.tx*256,n.tile.tz*256):0;return Math.max(deck>0?deck+$terrainHeight(e,t):0,walk)');
    replace('return rec?$roadDeckHeight(rec.decks,r.id,x,z):0',
      'return $terrainHeight(x,z)+(rec?$roadDeckHeight(rec.decks,r.id,x,z):0)');
    replace('$tunnelSupport(e.world,t,n,y,i>0?Math.max(r,i):r)',
      '$tunnelSupport(e.world,t,n,y-$terrainHeight(t,n),(i>0?Math.max(r,i):r)-$terrainHeight(t,n))+$terrainHeight(t,n)');
  } else if(rel.endsWith('/foundations.js')) {
    // Serving already removes the obsolete tunnel foundation uplift.
    const start=source.indexOf('export function buildingFoundation('),end=source.indexOf('\n/** A thin foundation slab',start);
    if(start<0||end<0)throw Error('Building elevation anchor changed');
    source=source.slice(0,start)+'export function buildingFoundation(building) { return $buildingElevation(building); }\n'+source.slice(end);
    replace('if (!baker.baseY) return;', 'if (!baker.baseY) return; const bottom = -Math.max(.25, baker.baseY - Math.min(...poly[0].map(p=>$terrainHeight(p[0],p[1]))) + .25);');
    source=source.replaceAll('-0.25','bottom');
  } else if(rel.endsWith('/vehicles-_zJz3z3J.js')) {
    replace('if(road)return streets?.roadHeight?.(road,t,n)??0;return streets?.deckHeight?.(t,n)??e.physics.groundHeight(t,n)',
      'if(road)return streets?.roadHeight?.(road,t,n)??$terrainHeight(t,n);return Math.max(streets?.deckHeight?.(t,n)??0,e.physics.groundHeight(t,n))');
    // Tunnel helper consumes and returns the old local street datum.
    replace('trafficHeight=$tunnelHeight,',
      'trafficHeight=(world,road,x,z,fallback)=>$tunnelHeight(world,road,x,z,fallback-$terrainHeight(x,z))+$terrainHeight(x,z),');
  } else if(rel.endsWith('/landmarks-KpQKy0CX.js')) {
    replace('function j(n,r){let i=new f;', 'function j(n,r){let i=new f;$elevateLandmark(n,r,i);');
  } else if(rel.endsWith('/builder.worker-D9_Czkt3.js')) {
    replace('(C.commercial&&!l.baseY?2:0)','(C.commercial?2:0)');
    replace('C.commercial&&!l.baseY&&e.len>=4&&C.style!==9','C.commercial&&e.len>=4&&C.style!==9');
  }
  return source;
}
