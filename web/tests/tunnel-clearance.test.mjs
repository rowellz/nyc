import { highwayLanePath, lanePoint } from '../../public/world/assets/lane-paths.js';
import { laneCount, laneWidth } from '../../public/world/assets/lane-layout.js';
import { pedestrianClearance } from '../../public/world/assets/pedestrian-clearance.js';
import { resolveRoadOverlaps } from '../../public/world/assets/road-overlap.js';
import { roadFootprints } from '../../public/world/assets/fixtures.js';
import { deckEdges, barrierRuns } from '../../public/world/assets/edges.js';
import { clearanceProfile } from '../../public/world/assets/ramps.js';
import { carriagewayIndex, pathHalfWidth, pathPieceClear } from '../../public/world/assets/carriageway.js';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import vm from 'node:vm';
import * as tunnels from '../../public/world/assets/tunnels.js';
import { supportPlanner, roadDeckHeight, roadDeckTriangles, triangleHeight } from '../../public/world/assets/supports.js';

import { buildingFoundation, foundationSlab } from '../../public/world/assets/foundations.js';
let result;
const sandbox = { console, performance, self: { postMessage: r => { result = r; } }, $roadFootprints: roadFootprints, $deckEdges: deckEdges, $barrierRuns: barrierRuns, $clearanceProfile: clearanceProfile, $roadDeckTriangles: roadDeckTriangles, $triangleHeight: triangleHeight, $roadDeckHeight: roadDeckHeight, $supportPlanner: supportPlanner,
  $tunnelFinish: tunnels.finishTunnelApproaches, $tunnelBuild: tunnels.buildTunnels, $tunnelNetwork: tunnels.tunnelNetwork, $tunnelCut: tunnels.cutBuilder, $carriagewayIndex: carriagewayIndex, $pathHalfWidth: pathHalfWidth, $pathPieceClear: pathPieceClear, $resolveRoadOverlaps: resolveRoadOverlaps, $pedestrianClearance: pedestrianClearance };
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../public/world/assets/tile.worker-Ai2ZdmRL.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '').replace('return buildBridges;', 'globalThis.nativeProfile = baseDeckProfile; return buildBridges;'), sandbox);

const tiles = [];
for (let x = 13; x <= 19; x++) for (let z = -43; z <= -39; z++) {
  try { tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${x}_${z}.json.gz`, import.meta.url))))); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
}
const roads = [...new Map(tiles.flatMap(t => t.roads).map(r => [r.id, r])).values()];
const profiles = tunnels.tunnelNetwork(roads), holes = tunnels.tunnelHoles(profiles);
// The reported Saint Nicholas Avenue approaches and their adjacent buried sections.
const keys = new Set(['16_-41', '15_-41', '15_-42']);
const rendered = new Map(), collision = new Map(), CELL = 16;
function index(target, name, pos, idx, ox = 0, oz = 0) {
  for (let i = 0; i < idx.length; i += 3) {
    const pts = [0,1,2].map(j => { const v=idx[i+j]*3; return [pos[v]+ox,pos[v+1],pos[v+2]+oz]; });
    const tri = { name, pts };
    for(let x=Math.floor(Math.min(...pts.map(p=>p[0]))/CELL);x<=Math.floor(Math.max(...pts.map(p=>p[0]))/CELL);x++)
      for(let z=Math.floor(Math.min(...pts.map(p=>p[2]))/CELL);z<=Math.floor(Math.max(...pts.map(p=>p[2]))/CELL);z++) {
        const key=`${x},${z}`, bucket=target.get(key)??[];bucket.push(tri);target.set(key,bucket);
      }
  }
}
let builtBuildings;
const buildings = { console, performance, self: { postMessage: r => { builtBuildings=r; } }, $foundation: buildingFoundation, $foundationSlab: foundationSlab };
vm.createContext(buildings);
vm.runInContext(readFileSync(new URL('../../public/world/assets/builder.worker-D9_Czkt3.js',import.meta.url),'utf8').replace(/^import .*$/gm,''),buildings);
for (const tile of tiles.filter(t => keys.has(t.key) || ['14_-42', '14_-41'].includes(t.key))) {
  await sandbox.self.onmessage({data:{id:1,input:{tile,roads,pedestrianTiles:tiles,quality:{level:'mobile',shadows:false}}}});
  assert(!result.error,result.error);
  const b=result.built;
  b.meshes.forEach((m,i)=>{if(m)index(rendered,`${tile.key}:${['road','walk','paint','structure'][i]}`,m.attributes.position.data,m.index);});
  index(collision,`${tile.key}:deck`,b.colliderPos,b.colliderIdx);
  index(collision,`${tile.key}:walk`,b.walkCollision.position,b.walkCollision.index);
  const x=tile.tx*256,z=tile.tz*256;
  const land=tunnels.cutGround({position:{array:[x,0,z,x+256,0,z,x+256,0,z+256,x,0,z+256],itemSize:3}},[0,2,1,0,3,2],holes);
  index(collision,`${tile.key}:land`,land.attributes.position.array,land.index);
  buildings.self.onmessage({data:{id:2,input:{key:tile.key,tx:tile.tx,tz:tile.tz,buildings:tile.buildings,roads:[],landmarkBins:[],quality:'mobile'}}});
  assert(!builtBuildings.error,builtBuildings.error);
  // Building meshes use tile-local coordinates; street meshes use world coordinates.
  index(collision,`${tile.key}:building`,builtBuildings.tile.colPos,builtBuildings.tile.colIdx,x,z);
}
const near=(map,x,z)=>map.get(`${Math.floor(x/CELL)},${Math.floor(z/CELL)}`)??[];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
function intersects(a,b,pts) {
  const d=sub(b,a), e=sub(pts[1],pts[0]), f=sub(pts[2],pts[0]), p=cross(d,f), det=dot(e,p);
  if(Math.abs(det)<1e-8)return false;
  const t=sub(a,pts[0]),u=dot(t,p)/det;if(u<0||u>1)return false;
  const q=cross(t,e),v=dot(d,q)/det;if(v<0||u+v>1)return false;
  const s=dot(f,q)/det;return s>1e-5&&s<=1;
}
let stations=0, rays=0;const checked=new Set();
for(const profile of profiles.values()) {
  const r=profile.road;if(!r.name?.startsWith('Trans-Manhattan'))continue;
  let acc=0,previous=null;
  for(let i=1;i<r.pts.length;i++) {
    const a=r.pts[i-1],b=r.pts[i],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
    for(let s=.5;s<L;s+=1) {
      const x=a[0]+(b[0]-a[0])*s/L,z=a[1]+(b[1]-a[1])*s/L,y=tunnels.tunnelHeight(profile,acc+s)+.025;
      if(!keys.has(`${Math.floor(x/256)}_${Math.floor(z/256)}`)){previous=null;continue;}
      const label=`road ${r.id} at ${x.toFixed(2)},${z.toFixed(2)} (floor ${y.toFixed(2)})`;
      const physical=near(collision,x,z);
      assert(physical.some(t=>{const h=triangleHeight(t.pts,x,z);return h?.inside&&Math.abs(h.height-y)<.2;}),`missing floor: ${label}; heights ${physical.map(t=>[t.name,triangleHeight(t.pts,x,z)]).filter(([n,h])=>h?.inside).map(([n,h])=>[n,h.height])}`);
      for(const tri of [...near(rendered,x,z),...physical]) {
        const h=triangleHeight(tri.pts,x,z);
        assert(!(h?.inside&&h.height>y+.2&&h.height<y+4.8),`${tri.name} seals ${label} at height ${h?.height}: ${JSON.stringify(tri.pts)}`);
      }
      if(previous) for(const height of [.4,1.4,2.4,4.5]) {
        const start=[previous.x,previous.y+height,previous.z],end=[x,y+height,z];
        const tris=new Set([...physical,...near(collision,previous.x,previous.z)]);
        for(const tri of tris)assert(!intersects(start,end,tri.pts),`${tri.name} blocks passage through ${label} at clearance ${height}`);
        rays++;
      }
      previous={x,y,z};stations++;checked.add(r.id);
    }
    acc+=L;
  }
}
for(const id of [1302764494000,1302763980000,1081031898000,1081031897000,46590832000,46591090000])assert(checked.has(id),`missing route ${id}`);
assert(stations>1000 && rays>4000,'exercise complete entrances, buried sections, and exits across tiles');
console.log(`PASS ${stations} real Trans-Manhattan floor/headroom samples and ${rays} passage rays through final road, curb, terrain, and building colliders`);

// Verify the actual traffic guides through every lane of the reported mouths.
const world = { tiles: new Map(tiles.map(t => [t.key, t])) };
let laneRays = 0;
for (const id of [1302764494000,1302763980000,1081031898000,1081031897000]) {
  const road = profiles.get(id).road, count = laneCount(road), width = laneWidth(road);
  for (let lane = 0; lane < count; lane++) {
    let previous;
    for (let segment = 0; segment + 1 < road.pts.length; segment++) {
      const a = road.pts[segment], b = road.pts[segment+1], length = Math.hypot(b[0]-a[0],b[1]-a[1]);
      const dx = (b[0]-a[0])/length, dz = (b[1]-a[1])/length, offset = (lane+.5-count/2)*width;
      const path = highwayLanePath(road, roads, segment, offset) ?? {ax:a[0]-dz*offset,az:a[1]+dx*offset,dx,dz,length};
      for (let along = .5; along < path.length; along++) {
        const p = lanePoint(path, along), y = tunnels.trafficHeight(world, road, p.x, p.z);
        const physical = near(collision, p.x, p.z);
        assert(physical.some(t => { const h = triangleHeight(t.pts,p.x,p.z); return h?.inside && Math.abs(h.height-y)<.2; }), `lane ${lane} on ${id} lacks road support`);
        if (previous) for (const height of [.4,1.4,2.4,4.5]) {
          const a = [previous.x,previous.y+height,previous.z], b = [p.x,y+height,p.z];
          for (const tri of new Set([...physical,...near(collision,previous.x,previous.z)]))
            assert(!intersects(a,b,tri.pts), `${tri.name} blocks lane ${lane} on ${id} at ${p.x},${p.z}, clearance ${height}`);
          laneRays++;
        }
        previous = {...p,y};
      }
    }
  }
}
console.log(`PASS ${laneRays} passage rays along actual traffic lanes at all four reported mouths`);

// Far-ground construction must agree with updates even if detailed tiles loaded first.
const envCode=readFileSync(new URL('../../public/world/assets/environment-WQwLg8tn.js',import.meta.url),'utf8');
const begin=envCode.indexOf('function k(e){if(b.clear()'),end=envCode.indexOf('return{addTile:',begin);
assert(begin>=0&&end>begin);
class Geometry { attributes={};setAttribute(k,v){this.attributes[k]=v;}setIndex(){}computeBoundingSphere(){} }
class Attribute { constructor(array,size){this.array=array;this.itemSize=size;} }
class Mesh { constructor(geometry){this.geometry=geometry;} }
const far={b:new Map(),y:null,x:new Set(['16_-41']),A:Geometry,M:Attribute,F:Mesh,v:{},t:{add(){},remove(){}}};
vm.createContext(far);vm.runInContext(envCode.slice(begin,end)+';k({tiles:["16_-41","16_-42"]});',far);
assert(far.y.geometry.attributes.position.array.slice(0,12).every((v,i)=>i%3!==1||v<-tunnels.TUNNEL_DEPTH));
assert.equal(far.y.geometry.attributes.position.array[13],-.25);
console.log('PASS far ground stays below tunnels when constructed after detailed tiles');
