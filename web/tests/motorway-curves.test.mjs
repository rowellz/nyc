import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { assets } from './sveltekit-assets.mjs';

const {highwayLayout,isHighway}=await import(new URL('lane-layout.js',assets));
const {deckEdges}=await import(new URL('edges.js',assets));
const tiles=[];
for(let tx=12;tx<=21;tx++)for(let tz=-45;tz<=-37;tz++) {
  try{tiles.push(JSON.parse(gunzipSync(readFileSync(new URL(`../../public/world/world/tiles/${tx}_${tz}.json.gz`,import.meta.url)))));}
  catch(error){if(error.code!=='ENOENT')throw error;}
}
const roads=[...new Map(tiles.flatMap(t=>t.roads).map(r=>[r.id,r])).values()];
const reported=new Set([46590812000,8119592000,1133431620000,46587576000,5669163000]);
let samples=0,worst=0;
const failures=[];
for(const road of roads.filter(isHighway)) {
  const layout=highwayLayout(road,roads);if(!layout)continue;
  for(let s=1;s<layout.length;s++) {
    const q=layout.count/2;
    const before=layout.offset(s-1,q)-layout.base(s-1,q),after=layout.offset(s,q)-layout.base(s,q);
    const jump=Math.abs(after-before);worst=Math.max(worst,jump);
    if(jump>(reported.has(road.id)?.2:.5))failures.push({id:road.id,s,jump,before,after});
    // The old finite/Infinity lookup switched at these halfway stations. The
    // lane and both barrier edges must remain continuous through that switch.
    const epsilon=1e-5;
    for(const position of [s=>layout.offset(s,q),s=>layout.edge(s,0),s=>layout.edge(s,1)])
      assert(Math.abs(position(s+epsilon)-position(s-epsilon))<.001,`discontinuous lane/edge on ${road.id} at ${s}m`);
    samples++;
  }
}
assert.equal(failures.length,0,`abrupt sideways corrections (worst ${worst}): ${JSON.stringify(failures.slice(0,8))}`);
// The reported ramps used to jump between 3 and 13 m in a single metre.
for(const id of reported)assert(roads.some(r=>r.id===id));
console.log(`PASS ${samples} real motorway correction samples; maximum sideways change ${worst.toFixed(3)} m per metre`);

// Build in either direction with the same whole-way joins. Arriving tiles must
// not choose a different taper or move a lane endpoint off its existing slot.
const reverse=[...roads].reverse();
for(const id of [46590812000,46587572000,46588502000,5669163000]) {
  const road=roads.find(r=>r.id===id),layout=highwayLayout(road,roads);
  const a=deckEdges(road,roads,Math.max(3.2,road.width/2)),b=deckEdges(road,reverse,Math.max(3.2,road.width/2));
  for(let s=0;s<=layout.length;s+=2)assert.deepEqual(a(s),b(s));
}
console.log('PASS motorway tapers are independent of tile/road arrival order');

const {taperGore}=await import(new URL('lane-transitions.js',assets));
const gap=d=>d<140?-3:d<190?Infinity:-8;
const chain=lengths=>{
  let from=0;
  return lengths.map(length=>{
    const entry={from,length,end:0,laneSpan:3.3,gaps:Array.from({length:length/2+1},(_,i)=>gap(from+i*2))};
    from+=length;return entry;
  });
};
const whole=chain([240]),split=chain([120,120]);
taperGore(whole,2,30,3.3);taperGore(split,2,30,3.3);
assert.equal(whole[0].gaps[0],-3,'keep the shared lane at the actual junction');
for(const entry of split)entry.gaps.forEach((g,i)=>assert.equal(g,whole[0].gaps[entry.from/2+i],
  'way boundaries must not restart the taper'));
assert(whole[0].gaps.slice(70).every(g=>g===30),'a separated sibling cannot pull the road sideways again');
console.log('PASS the taper crosses way boundaries and never reacquires a separated ramp');
