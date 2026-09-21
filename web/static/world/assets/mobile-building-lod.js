// Spend roof-edge detail close to the camera, with one shared city budget.
// Walls, setbacks, roof shapes, foundations and collision survive every tier.
export function selectBuildingDetail(ctx, previous = new Set()) {
  if (ctx.quality.level !== 'mobile') return null;
  const camera = ctx.camera.position, candidates = [], seen = new Set();
  for (const tile of ctx.world.tiles.values()) for (const building of tile.buildings) {
    if (seen.has(building.id)) continue;
    seen.add(building.id);
    let x0=Infinity, x1=-Infinity, z0=Infinity, z1=-Infinity, edges=0;
    for (const ring of building.footprint) for (const [x,z] of ring) {
      x0=Math.min(x0,x);x1=Math.max(x1,x);z0=Math.min(z0,z);z1=Math.max(z1,z);edges++;
    }
    const held=previous.has(building.id);
    const distance=Math.hypot(Math.max(x0-camera.x,0,camera.x-x1),
      Math.max(z0-camera.z,0,camera.z-z1), (building.height || 3)-(camera.y || 0));
    if (distance <= (held ? 256 : 192)) candidates.push({id:building.id, edges,
      rank:distance-(held?24:0)});
  }
  candidates.sort((a,b)=>a.rank-b.rank || a.id-b.id);
  const selected=new Set();let edges=0;
  const limit=ctx.world.ios?192:320;
  for (const candidate of candidates) {
    if (edges+candidate.edges>limit) continue;
    selected.add(candidate.id);edges+=candidate.edges;
    if (selected.size >= (ctx.world.ios?24:40)) break;
  }
  return selected;
}

export function createBuildingDetailController(ctx, now = () => performance.now()) {
  let selected=new Set(), next=-Infinity;
  const signature = tile => tile.buildings.filter(b=>selected.has(b.id)).map(b=>b.id).join(',');
  return {
    input(rec) {
      if(ctx.quality.level!=='mobile')return {};
      if(next===-Infinity&&!ctx.world.stats?.fastTravel)selected=selectBuildingDetail(ctx,selected);
      rec.detailSignature=signature(rec.tile);
      return {mobile:true, detailedIds:rec.tile.buildings.filter(b=>selected.has(b.id)).map(b=>b.id)};
    },
    update(records, enqueue) {
      if(ctx.quality.level!=='mobile')return;
      const time=now();
      // These replacements only change parapets. Leave the current geometry
      // intact while driving; road/ground uploads and collision take priority.
      // Wait for a brief settled period before spending work after braking.
      if(ctx.world.stats?.fastTravel){next=time+750;return;}
      if(time<next)return;
      next=time+750;
      // Never overlap a second decoded replacement with an existing build.
      if((ctx.busy??0)>0||[...records.values()].some(r=>r.job?.pending))return;
      selected=selectBuildingDetail(ctx,selected);
      for(const rec of records.values()) if(rec.mesh && signature(rec.tile)!==rec.detailSignature) {
        enqueue(rec);break;
      }
    },
  };
}

/** Compact in the worker before transfer. Collision chunks already own their
 * arrays; the unsplit source and lookup scratch are redundant after indexing. */
export function compactBuildingGeometry(tile) {
  tile.normal=Int8Array.from(tile.normal,n=>Math.round(Math.max(-1,Math.min(1,n))*127));
  tile.color=Uint8Array.from(tile.color,n=>Math.round(Math.max(0,Math.min(1,n))*255));
  tile.colPos=null;tile.colIdx=null;tile.lookup=null;
  const buffers=new Set();
  const visit=value=>{
    if(ArrayBuffer.isView(value))buffers.add(value.buffer);
    else if(value&&typeof value==='object')for(const child of Object.values(value))visit(child);
  };
  visit(tile);
  tile.byteLength=[...buffers].reduce((n,b)=>n+b.byteLength,0);
  return tile;
}
