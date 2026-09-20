import { CHUNK_SIZE } from './scenery-format.js';

export function sceneryBudget(mobile, farDistance, ios = false) {
  if (ios) return { distance: Math.min(farDistance,2500), middle:256,
    triangles:80000, chunks:16, bytes:8*1024*1024, requests:1,
    decodeBytes:2*1024*1024, peakBytes:14*1024*1024 };
  return { distance: farDistance, middle: mobile ? 512 : 2200,
    triangles: mobile ? 160000 : Infinity,
    chunks: mobile ? 48 : 192, bytes: (mobile ? 24 : 96) * 1024 * 1024, requests: mobile ? 1 : 2,
    decodeBytes:(mobile?4:32)*1024*1024, peakBytes:(mobile?36:288)*1024*1024 };
}
const distance = (key, x, z) => {
  const [cx,cz] = key.split('_').map(Number);
  return Math.hypot(Math.max(cx*CHUNK_SIZE-x,0,x-(cx+1)*CHUNK_SIZE), Math.max(cz*CHUNK_SIZE-z,0,z-(cz+1)*CHUNK_SIZE));
};

/** Transport and residency policy, independent of Three and the frame loop.
 * Decoded replies retain their slots until one per frame can be published. */
export function createSceneryStream({ budget, fetchChunk, publish, remove, now = () => performance.now() }) {
  const resident = new Map(), pending = new Map(), failed = new Map(), coarse = new Set();
  let entries = [], wanted = new Map(), disposed = false, planned = -Infinity, lastX = Infinity, lastZ = Infinity, bytes = 0, triangles = 0, retiredLast = false;
  const triangleLimit = budget.triangles ?? Infinity;
  // Includes compressed/inflated staging, index copies and the upload while the
  // previous mesh is still alive. One request cannot grow beyond decodeBytes.
  const reservation=(budget.decodeBytes??0)*3, peakLimit=budget.peakBytes??Infinity;
  const stats = { chunks: 0, bytes: 0, triangles: 0, inFlight: 0, fetched: 0, failed: 0,
    reservedBytes:0, peakBudgetBytes:peakLimit, downgraded:0 };
  function downgrade(key,tier) {
    if(tier!=='mid')return;
    coarse.add(key);stats.downgraded++;
    const target=wanted.get(key);if(target)target.tier='far';
  }
  function drop(key) { const rec=resident.get(key); if (!rec) return; remove(rec.handle); bytes-=rec.bytes; triangles-=rec.triangles; resident.delete(key); }
  function plan(x,z) {
    const targets = entries.map(e => ({ ...e, distance: distance(e.key,x,z) }))
      .filter(e => e.distance <= budget.distance).sort((a,b) => a.distance-b.distance).slice(0,budget.chunks);
    wanted = new Map(targets.map(e => {
      const old = resident.get(e.key);
      // A wider exit boundary prevents repeated mid/far replacements on turns.
      const middle = budget.middle + (old?.tier === 'mid' ? 256 : 0);
      return [e.key, { ...e, tier: !coarse.has(e.key)&&e.distance <= middle ? 'mid' : 'far' }];
    }));
    for (const [key, rec] of pending) if (!wanted.has(key) || wanted.get(key).tier !== rec.tier) {
      rec.controller.abort(); clearTimeout(rec.timer); pending.delete(key);
    }
    for(const [key,time] of failed)if(now()-time>=10000)failed.delete(key);
  }
  return {
    stats, resident,
    setManifest(manifest) { entries = manifest.chunks; planned=-Infinity; },
    update(x,z,allowed=true) {
      if (disposed) return;
      const time=now();
      if (time-planned>=250 || Math.hypot(x-lastX,z-lastZ)>=256) { plan(x,z); planned=time; lastX=x; lastZ=z; }
      // One retirement OR publication per update. Close chunks win the budget.
      let changed=false;
      const obsolete=[...resident.keys()].filter(k=>!wanted.has(k)).sort((a,b)=>distance(b,x,z)-distance(a,x,z))[0];
      const haveReply=[...pending.values()].some(p=>p.data);
      if (obsolete!==undefined && (!retiredLast || !allowed || !haveReply)) { drop(obsolete); changed=true; retiredLast=true; }
      if (!changed && allowed) {
        const ready=[...pending.entries()].filter(([,p])=>p.data).sort((a,b)=>wanted.get(a[0]).distance-wanted.get(b[0]).distance)[0];
        if (ready) {
          const [key,p]=ready, old=resident.get(key), cost=p.data.residentBytes??p.data.byteLength, tris=p.data.triangles??0;
          if (cost>budget.bytes || tris>triangleLimit) { pending.delete(key); failed.set(`${key}.${p.tier}`,time); downgrade(key,p.tier); }
          else if (bytes-(old?.bytes??0)+cost>budget.bytes || triangles-(old?.triangles??0)+tris>triangleLimit || (!old && resident.size>=budget.chunks)) {
            const farthest=[...resident.keys()].filter(k=>k!==key).sort((a,b)=>distance(b,x,z)-distance(a,x,z))[0];
            if (farthest && distance(farthest,x,z)>distance(key,x,z)) {
              failed.set(`${farthest}.${resident.get(farthest).tier}`,time);drop(farthest);retiredLast=true;
            }
            else { pending.delete(key); failed.set(`${key}.${p.tier}`,time); downgrade(key,p.tier); }
          } else {
            // Publish the replacement first; remove its predecessor only on success.
            try {
              const handle=publish(p.data);
              if (old) drop(key);
              resident.set(key,{handle,tier:p.tier,bytes:cost,triangles:tris}); bytes+=cost; triangles+=tris; stats.fetched++;
              retiredLast=false;
            } catch { failed.set(`${key}.${p.tier}`,time); stats.failed++; }
            pending.delete(key);
          }
        }
      }
      for (const [key, target] of wanted) {
        if (pending.size>=budget.requests) break;
        if(bytes+(pending.size+1)*reservation>peakLimit)break;
        if (resident.get(key)?.tier===target.tier || pending.has(key) || time-(failed.get(`${key}.${target.tier}`)??-Infinity)<10000) continue;
        const rec={controller:new AbortController(),tier:target.tier,data:null}; pending.set(key,rec);
        rec.timer=setTimeout(()=>rec.controller.abort(),15000);
        fetchChunk(key,rec.tier,rec.controller.signal).then(data=>{
          if (!disposed && pending.get(key)===rec) rec.data=data;
        }).catch(error=>{
          if (pending.get(key)!==rec) return;
          pending.delete(key); failed.set(`${key}.${rec.tier}`,now()); stats.failed++;
          if(/budget exceeded/.test(error?.message??''))downgrade(key,rec.tier);
        }).finally(()=>clearTimeout(rec.timer));
      }
      stats.chunks=resident.size; stats.bytes=bytes; stats.triangles=triangles; stats.inFlight=pending.size;
      stats.reservedBytes=bytes+pending.size*reservation;
    },
    dispose() {
      disposed=true;
      for (const p of pending.values()) {p.controller.abort();clearTimeout(p.timer);} pending.clear();
      for (const key of resident.keys()) drop(key);
      stats.chunks=stats.bytes=stats.triangles=stats.inFlight=0;
      stats.reservedBytes=0;failed.clear();coarse.clear();wanted.clear();entries=[];
    },
  };
}
