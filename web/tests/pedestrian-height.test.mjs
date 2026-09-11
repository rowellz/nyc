/** Exercise source and shipped crowd methods against the real sidewalk height sampler. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const between = (code, start, end) => {
  const a = code.indexOf(start), b = code.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Missing code anchors ${start} / ${end}`);
  return code.slice(a, b);
};
const collision = stripTypeScriptTypes(read('src/client/src/streets/collision.ts').replace(/^import .*\n/gm, '').replace(/^export /gm, ''));
const { buildWalkCollision, walkHeightIn } = vm.runInNewContext(collision + '\n({buildWalkCollision,walkHeightIn})', { TILE_SIZE: 256, KIND: { curb: 99 }, WALK_Y: .15 });
// A curb cut rises from zero to 15 cm, followed by a sidewalk through an overpass.
const walkCollision = buildWalkCollision({ pos: [0,0,0, 2,.15,0, 2,.15,8, 0,0,8, 256,.15,0, 256,.15,8],
  idx: [0,1,2,0,2,3,1,4,5,1,5,2], aA: Array(24).fill(0) }, [], 0, 0);
const streetsSource = read('src/client/src/streets/index.ts');
const streetsServed = read('public/world/assets/streets-CfYSUqyW.js');
const pedSource = read('src/client/src/character/peds.ts');
const pedServed = read('public/world/assets/character-O1u3Gxpp.js');
const noOp = () => {};
class Vec {
  constructor(x=0,y=0,z=0) { this.set(x,y,z); }
  set(x,y,z) { Object.assign(this,{x,y,z}); return this; }
  copy(v) { return this.set(v.x,v.y,v.z); }
  sub(v) { this.x-=v.x; this.y-=v.y; this.z-=v.z; return this; }
  length() { return Math.hypot(this.x,this.y,this.z); }
  distanceToSquared() { return 0; }
  dot() { return 1; }
}
class Instance {
  root = { position:new Vec(), rotation:{}, scale:{y:1}, removeFromParent:noOp };
  mesh = {};
  state = 'walk';
  actions = {walk:{getClip:()=>({duration:1})}};
  setDetail(v) { this.detail=v; }
  setVisible() {}
  setShadows() {}
  play() {}
  update() {}
}
for (const variant of ['source','served']) {
  let base = 0;
  const tiles = new Map();
  const tileKey = (x,z) => `${x}_${z}`;
  const baseGroundHeight = () => base;
  const ctx = {physics:{groundHeight:()=>21}, modules:new Map(), time:{daylight:1,dayFraction:15/24},
    quality:{level:'mobile'}, state:{screenshotMode:true,local:{state:{x:0,z:0},vehicleKey:null}},
    camera:{position:new Vec(),getWorldDirection:noOp,updateMatrixWorld:noOp}};
  const scope = { ctx, tiles, tileKey, baseGroundHeight, walkHeightIn, TILE_SIZE:256,
    e:ctx, N:tiles, p:tileKey, F:baseGroundHeight, M:walkHeightIn };
  const heightCode = variant === 'source'
    ? stripTypeScriptTypes(between(streetsSource,'  function walkingHeight(', '  const groundHeight =')) + '\nwalkingHeight'
    : between(streetsServed,'const $walkingHeight=', 'let z=new Set') + '\n$walkingHeight';
  const walkingHeight = vm.runInNewContext(heightCode, scope);
  ctx.modules.set('streets',{walkingHeight});
  assert.equal(walkingHeight(100,4),0,'before street mesh loads use land, not the overpass');
  tiles.set('0_0',{tile:{tx:0,tz:0}, walkCollision, decks:[{height:21}]});
  const near = (actual, expected) => assert(Math.abs(actual-expected)<1e-6, `${variant}: ${actual} != ${expected}`);
  near(walkingHeight(1,4),.075);
  near(walkingHeight(100,4),.15);
  near(walkingHeight(100,12),0);
  base=-100; near(walkingHeight(100,12),-100); near(walkingHeight(100,4),.15);
  base=2; near(walkingHeight(100,4),2); // Preserve core landmark support.
  base=0;
  assert.equal(walkingHeight(NaN,4),0);
  let methods;
  if (variant === 'source') {
    methods = [between(pedSource,'  private walkingHeight(', '  private buildEgresses('),
      between(pedSource,'  private canSpawn(', '  private rebuildLaneList('),
      between(pedSource,'  private spawnAt(', '  private walkerCount('),
      between(pedSource,'  update(dt:', '  count():')].join('\n');
    methods = stripTypeScriptTypes(`class Crowd {${methods}}; Crowd`);
  } else {
    methods = 'class Crowd {' + [between(pedServed,'// NYC pedestrian support v1','canSpawn(e,t){'),
      between(pedServed,'canSpawn(e,t){','rebuildLaneList(){'),
      between(pedServed,'spawnAt(e,t,n,r,i,a,o=null,s=!1){','walkerCount(){'),
      between(pedServed,'update(e){if(this.benchmarking)','count(){')].join('\n') + '}; Crowd';
  }
  const Crowd = vm.runInNewContext(methods, { CharacterInstance:Instance, Kr:Instance, randomAppearance:noOp, Li:noOp,
    THREE:{MathUtils:{smoothstep:()=>0}}, l:{smoothstep:()=>0}, IN_VIEW_SPAWN_R:45,Zi:45,
    DESPAWN_R:140,Yi:140,PED_FULL:42,Qi:42,fullCap:()=>0,na:()=>0, PED_SHADOW:16,ea:16,
    PED_MID:55,$i:55,CROWD_SHADOW:60,ta:60 });
  const crowd = Object.create(Crowd.prototype);
  Object.assign(crowd,{ctx,rnd:()=>.9, group:{add:noOp}, peds:[],grid:{add:noOp,rebuild:noOp},
    populationCovered:()=>false,inView:()=>true,camPos:new Vec(),egresses:[],spawnRay:new Vec()});
  const rays=[];
  ctx.physics.raycast=(_origin,dir)=>{rays.push(dir.y); return {dist:5};};
  assert(crowd.canSpawn(100,4));
  near(rays[0],.75); near(rays[1],2.05);
  const ped = crowd.spawnAt({road:{id:1},side:1},0,0,{x:100,z:4,dx:1,dz:0},1,.5);
  near(ped.gy,.15); near(ped.inst.root.position.y,.15);
  Object.assign(crowd,{focus:new Vec(),camDirection:new Vec(),view:{multiplyMatrices:noOp},frustum:{setFromProjectionMatrix:noOp},
    seatClock:0,seatSyncIn:100,densityHour:30,laneFocus:new Vec(),laneDirection:new Vec(),
    targetCount:()=>1,lanes:new Map([['1:1',{}]]),walkerCount:()=>1,populateSeats:noOp,
    carTime:100,nearPeds:[],fullPeds:new Set(),crowdBatch:{begin:noOp,end:noOp,add:noOp},
    think:noOp,move:noOp,slot:0,maxPeds:1});
  // Walk into, through and out of a projected overhead deck; repair old cached heights too.
  for (const [x,z,expected] of [[1,4,.075],[50,4,.15],[100,4,.15],[180,4,.15],[180,12,0]]) {
    ped.x=x; ped.z=z; ped.gy=21; crowd.slot=0;
    crowd.update(1/60);
    near(ped.gy,expected); near(ped.inst.root.position.y,expected);
  }
  tiles.delete('0_0'); ped.x=100; ped.z=4; crowd.slot=0; crowd.update(1/60); near(ped.gy,0);
  tiles.set('0_0',{tile:{tx:0,tz:0},walkCollision}); crowd.slot=0; crowd.update(1/60); near(ped.gy,.15);
  // Seats with explicit landmark elevations still bypass the general support query.
  assert(variant==='source' ? pedSource.includes('seat.groundY ?? this.walkingHeight(')
    : pedServed.includes('n.groundY??this.walkingHeight('));
  console.log(`PASS ${variant}: crowd spawn, visibility rays and rendered updates stay below overpasses; curb cuts and streaming remain supported`);
}

for (const variant of ['source','served']) {
  const heightCode = variant === 'source'
    ? stripTypeScriptTypes(between(streetsSource,'  function walkableAt(', '  const groundHeight ='))+'\nwalkableAt'
    : between(streetsServed,'const $walkableAt=', 'let z=new Set')+'\n$walkableAt';
  const tiles=new Map(), tileKey=(x,z)=>`${x}_${z}`;
  const walkableAt=vm.runInNewContext(heightCode,{tiles,tileKey,TILE_SIZE:256,walkHeightIn,N:tiles,p:tileKey,M:walkHeightIn});
  assert.equal(walkableAt(100,4),null);
  tiles.set('0_0',{tile:{tx:0,tz:0},walkCollision,grid:{}});
  assert.equal(walkableAt(100,4),true,'sidewalk under an overpass is a valid route');
  assert.equal(walkableAt(100,12),false,'trimmed paving cannot authorize walking on asphalt');
  tiles.set('0_0',{tile:{tx:0,tz:0},grid:{}});
  assert.equal(walkableAt(100,4),false,'a completed tile without walking geometry is not a route');
  let methods;
  if(variant==='source') methods=stripTypeScriptTypes('class Crowd {'+[
    between(pedSource,'  private walkable(', '  private isInsideBuilding('),
    between(pedSource,'  private hasWalkingRoom(', '  private trySpawn('),
    between(pedSource,'  private trySpawn(', '  private spawnAt('),
    between(pedSource,'  private move(', '  update(dt:')].join('\n')+'}; Crowd');
  if(variant==='served') methods='class Crowd {'+[
    between(pedServed,'walkable(e,t,n){','isInsideBuilding(e,t){'),
    between(pedServed,'// NYC pedestrian paths v1','trySpawn(){'),
    between(pedServed,'trySpawn(){','spawnAt(e,t,n,r,i,a'),
    between(pedServed,'move(e,t,n,r,i){','update(e){if(this.benchmarking)')].join('\n')+'}; Crowd';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const Crowd=vm.runInNewContext(methods,{THREE:{MathUtils:{clamp}},l:{clamp},Xi:3,NEAR_SPAWN_R:3,
    BODY_SPACE:.62,ia:.62,lerpAngle:()=>0,oa:()=>0});
  const crowd=Object.create(Crowd.prototype), lane={road:{id:1},side:1,len:100,crossings:[]};
  let allowed=x=>x>=40&&x<=44, spawned=0;
  Object.assign(crowd,{ctx:{modules:new Map([['streets',{walkableAt:(x)=>allowed(x)}]]),world:{}},
    isInsideBuilding:()=>false,onSidewalk:()=>true,walkerCount:()=>0,maxPeds:20,peds:[],totalCapacity:20,
    laneList:[{lane,s0:42,s1:42,weight:1,ingress:true}],populationCovered:()=>true,populationPending:true,
    spawnWeight:1,rnd:()=>.5,focus:{x:0,z:0},walkingLat:()=>0,freeAt:()=>true,canSpawn:()=>true,
    spawnAt:()=>spawned++,sample:(_lane,s,lat,o)=>Object.assign(o,{x:s,z:lat,dx:1,dz:0})});
  assert.equal(crowd.walkable(50,0,lane),false,'raw sidewalk polygons no longer override the trimmed path');
  assert.equal(crowd.trySpawn(),false,'four-metre isolated fragment does not spawn a walker');
  assert.equal(spawned,0);
  allowed=x=>(x>=40&&x<=44)||(x>=47&&x<=90);
  assert.equal(crowd.trySpawn(),false,'nearby long path across a road gap does not count as connected');
  allowed=x=>x>=20&&x<=80;
  assert.equal(crowd.trySpawn(),true,'a usable continuous route can still populate');
  assert.equal(spawned,1);
  // A blocked actor can shuffle sideways freely; it must still recognize that its route is blocked.
  Object.assign(crowd,{grid:{near:()=>[],move:noOp},walkable:x=>x<=0,
    sample:(_lane,_s,_lat,o)=>Object.assign(o,{x:20,z:0,dx:1,dz:0})});
  const ped={x:0,z:0,s:20,lane,dir:1,lat:0,latCur:0,speed:1,state:'walk',blocked:0,inst:{},yaw:0};
  for(let frame=0;frame<185;frame++) crowd.move(ped,1/60,100,100,false);
  assert.equal(ped.dir,-1,'sideways shuffling no longer resets blocked-route recovery');
  Object.assign(ped,{x:0,z:0,state:'cross',crossing:{x:10,z:0,dx:1,dz:0,half:10},route:{x:20,z:0},dir:1});
  for(let frame=0;frame<60;frame++)crowd.move(ped,1/60,100,100,false);
  assert(ped.x>.5,'an authorized crossing still permits entering the roadway');
  console.log(`PASS ${variant}: rendered paths govern walking; isolated spawns rejected; lateral shuffling triggers recovery; crossings remain usable`);
}
