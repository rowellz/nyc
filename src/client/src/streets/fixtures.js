import { deckEdges } from './edges.js';

const vehicular = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'service']);
const highway = r => r.cls === 'motorway' || r.cls === 'trunk' || r.bridge;
const projection = (x, z, a, b) => {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return [a[0] + dx * t, a[1] + dz * t, t];
};
function inside(x, z, ring) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

/** Indexed pavement strips use the same tapered edges as the deck builder. */
export function roadFootprints(roads, profile = r => ({ hw: Math.max(3.2, r.width / 2), hAt: () => 0 })) {
  roads = [...new Map(roads.filter(r => !r.tunnel && r.pts.length > 1 && (vehicular.has(r.cls) || r.bridge)).map(r => [`${r.id}:${r.width}:${r.layer}:${JSON.stringify(r.pts)}`, r])).values()];
  const cells = new Map(), strips = [];
  for (const road of roads) {
    const { hw, hAt } = profile(road), edges = deckEdges(road, roads, hw);
    let s = 0;
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1], b = road.pts[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const count = Math.max(1, Math.ceil(length / 4));
      for (let j = 0; j < count; j++) {
        const s0 = s + length * j / count, s1 = s + length * (j + 1) / count;
        const [l0, r0] = edges(s0), [l1, r1] = edges(s1);
        const ring = [l0, l1, r1, r0], h0 = hAt(s0), h1 = hAt(s1);
        const strip = { road, ring, h0, h1, a: [(l0[0] + r0[0]) / 2, (l0[1] + r0[1]) / 2], b: [(l1[0] + r1[0]) / 2, (l1[1] + r1[1]) / 2] };
        strips.push(strip);
        const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
        for (let x = Math.floor((Math.min(...xs) - 6) / 32); x <= Math.floor((Math.max(...xs) + 6) / 32); x++)
          for (let z = Math.floor((Math.min(...zs) - 6) / 32); z <= Math.floor((Math.max(...zs) + 6) / 32); z++) {
            const key = `${x},${z}`; if (!cells.has(key)) cells.set(key, []); cells.get(key).push(strip);
          }
      }
      s += length;
    }
  }
  const near = (x, z) => cells.get(`${Math.floor(x / 32)},${Math.floor(z / 32)}`) ?? [];
  return {
    strips,
    obstructs(x, z, margin = 0, accept = () => true) {
      return near(x, z).some(q => {
        if (!accept(q.road, q.h0 + (q.h1 - q.h0) * projection(x, z, q.a, q.b)[2])) return false;
        if (inside(x, z, q.ring)) return true;
        return margin > 0 && q.ring.some((a, i) => {
          const p = projection(x, z, a, q.ring[(i + 1) % 4]); return Math.hypot(p[0] - x, p[1] - z) < margin;
        });
      });
    },
  };
}

/** Authored lamps are ground furniture. Reserve room for the mast AND its arm,
 * independent of whether the asynchronous street colliders have arrived yet. */
export function lampPlanner(roads, obstacles = []) {
  const pavement = roadFootprints(roads);
  const blocked = (x, z) => pavement.obstructs(x, z, 4.8, highway) || pavement.obstructs(x, z, 0.7)
    || obstacles.some(rings => inside(x, z, rings[0]) && !rings.slice(1).some(ring => inside(x, z, ring)));
  return prop => {
    if (prop.kind !== 'street_lamp' || !pavement.obstructs(prop.x, prop.z, 4.8, highway)) return prop;
    const candidates = [];
    for (const q of pavement.strips) {
      if (!highway(q.road)) continue;
      for (const [a, b, opposite] of [[q.ring[0], q.ring[1], q.ring[3]], [q.ring[3], q.ring[2], q.ring[0]]]) {
        const p = projection(prop.x, prop.z, a, b), dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        let nx = -dz / len, nz = dx / len;
        if (nx * (opposite[0] - a[0]) + nz * (opposite[1] - a[1]) > 0) { nx = -nx; nz = -nz; }
        const x = p[0] + nx * 5, z = p[1] + nz * 5, distance = Math.hypot(x - prop.x, z - prop.z);
        if (distance <= 48) candidates.push({ ...prop, x, z, yaw: Math.atan2(nx, nz), distance });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.x - b.x || a.z - b.z);
    return candidates.find(p => !blocked(p.x, p.z)) ?? null;
  };
}

// Ground footprints, in each model's local X/Z frame. Flat road hardware and
// wall-mounted/subway structures deliberately do not use this sidewalk rule.
const furnitureSize = {
  street_lamp:[.35,.35], street_sign:[.5,.5], traffic_signal:[.5,.5], trash_can:[.5,.5],
  hydrant:[.4,.4], bench:[1.1,.55], mailbox:[.5,.5], bike_rack:[1,.5],
  bollard:[.25,.25], planter:[.8,.8], phone_booth:[.5,.5],
  newsstand:[1.8,1.1], food_cart:[1.3,.8], bus_stop:[.5,.5], citibike_dock:[.5,.5],
  signPost:[.5,.5], regSign:[.6,.6], stopSign:[.5,.5], wireBasket:[.5,.5], steelBasket:[.5,.5],
  newsRack:[.35,.4], muni:[.45,.4], link:[.5,.5], bikeRack:[1,.5], bikeLocked:[1.1,.5],
  hydrantRed:[.4,.4], signalCabinet:[.7,.5],
  busShelter:[2.5,1], shelterGlass:[2.5,1], busSign:[.4,.4],
  citiBike:[.4,1.1], citiEmpty:[.4,.55], citiKiosk:[.65,.65], foodCart:[1.3,.8],
};
const surfaceRoad = r => !r.tunnel && !r.bridge && !(r.layer > 0);
const inPolygon = (x,z,poly) => inside(x,z,poly[0]) && !poly.slice(1).some(r=>inside(x,z,r));

const treePitEdges = new WeakMap();
/** The long side of a pit follows the local paving edge, including curved curbs.
 * Ignore clipping seams; road context supplies a width-aware fallback at tile borders. */
export function treePitYaw(tile, x, z) {
  let edges=treePitEdges.get(tile);
  if(!edges) {
    edges=[];
    const seam=(a,b)=>[0,1].some(axis=>{
      const origin=(axis===0?tile.tx:tile.tz)*256;
      return [origin,origin+256].some(v=>Math.abs(a[axis]-v)<.15&&Math.abs(b[axis]-v)<.15);
    });
    for(const poly of tile.sidewalks??[])for(const ring of poly)for(let i=0;i<ring.length;i++) {
      const a=ring[i],b=ring[(i+1)%ring.length];
      if(Math.hypot(b[0]-a[0],b[1]-a[1])>=2&&!seam(a,b))edges.push([a,b]);
    }
    treePitEdges.set(tile,edges);
  }
  let best=6*6,yaw=null;
  const angle=(a,b)=>{
    // Rectangular pits are unchanged by a half-turn. Canonical angles make
    // reversed polygon rings and road directions agree exactly.
    const value=Math.atan2(a[1]-b[1],b[0]-a[0]);
    return (value+Math.PI)%Math.PI;
  };
  for(const [a,b] of edges) {
    const p=projection(x,z,a,b),d=(p[0]-x)**2+(p[1]-z)**2,next=angle(a,b);
    if(d<best-1e-8||(Math.abs(d-best)<1e-8&&(yaw===null||next<yaw))) {best=d;yaw=next;}
  }
  if(yaw!==null)return yaw;
  best=12;
  for(const road of tile.streetContext?.roads??tile.roads??[]) {
    if(!surfaceRoad(road)||!vehicular.has(road.cls)&&!['pedestrian','living_street'].includes(road.cls))continue;
    const half=Math.max(1,(road.width||6)/2);
    for(let i=1;i<road.pts.length;i++) {
      const a=road.pts[i-1],b=road.pts[i];
      if(Math.hypot(b[0]-a[0],b[1]-a[1])<.01)continue;
      const p=projection(x,z,a,b),distance=Math.hypot(p[0]-x,p[1]-z);
      const d=Math.abs(distance-half),next=angle(a,b);
      if(d<best-1e-8||(Math.abs(d-best)<1e-8&&(yaw===null||next<yaw))) {best=d;yaw=next;}
    }
  }
  return yaw??0;
}

/** Check entire furniture bases, including a road crossing between their corners.
 * Roadbed polygons supply broad junctions that centerline widths cannot describe. */
export function furniturePlanner(roads, tiles = []) {
  const polygons = tiles.flatMap(t => [...(t.roadbeds ?? []), ...(t.parking ?? [])]);
  const strips = roadFootprints(roads.filter(surfaceRoad)).strips;
  polygons.push(...strips.map(s=>[s.ring]));
  const cells = new Map();
  for(const poly of polygons) {
    if(!poly[0]?.length)continue;
    const xs=poly[0].map(p=>p[0]),zs=poly[0].map(p=>p[1]);
    for(let x=Math.floor(Math.min(...xs)/32);x<=Math.floor(Math.max(...xs)/32);x++)
      for(let z=Math.floor(Math.min(...zs)/32);z<=Math.floor(Math.max(...zs)/32);z++) {
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(poly);
      }
  }
  return (kind,x,z,yaw=0,scale=1) => {
    const size=furnitureSize[kind];if(!size)return true;
    if(![x,z,yaw,scale].every(Number.isFinite))return false;
    const hx=size[0]*Math.abs(scale)+.1,hz=size[1]*Math.abs(scale)+.1,c=Math.cos(yaw),s=Math.sin(yaw);
    const ring=[[-hx,-hz],[hx,-hz],[hx,hz],[-hx,hz]].map(([a,b])=>[x+a*c+b*s,z-a*s+b*c]);
    const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]),near=new Set();
    for(let tx=Math.floor(Math.min(...xs)/32);tx<=Math.floor(Math.max(...xs)/32);tx++)
      for(let tz=Math.floor(Math.min(...zs)/32);tz<=Math.floor(Math.max(...zs)/32);tz++)
        for(const poly of cells.get(`${tx},${tz}`)??[])near.add(poly);
    const local=p=>[(p[0]-x)*c-(p[1]-z)*s,(p[0]-x)*s+(p[1]-z)*c];
    const cutsBox=(a,b)=>{
      a=local(a);b=local(b);let lo=0,hi=1;
      for(const [axis,half] of [[0,hx],[1,hz]]) {
        const d=b[axis]-a[axis];
        if(Math.abs(d)<1e-9){if(Math.abs(a[axis])>half)return false;}
        else {const t0=(-half-a[axis])/d,t1=(half-a[axis])/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));}
      }
      return lo<=hi;
    };
    for(const poly of near) {
      if(ring.some(p=>inPolygon(...p,poly)))return false;
      if(poly.some(r=>r.some((a,i)=>cutsBox(a,r[(i+1)%r.length]))))return false;
    }
    return true;
  };
}

const furniturePlanners = new WeakMap();
export function furnitureClearance(world,tile) {
  const tiles=[...(world.tiles?.values()??[])],key=tile??world;
  let entry=furniturePlanners.get(key);
  if(!entry||entry.tiles.length!==tiles.length||tiles.some((t,i)=>t!==entry.tiles[i])) {
    const nearby=tile?tiles.filter(t=>Math.abs(t.tx-tile.tx)<=1&&Math.abs(t.tz-tile.tz)<=1):tiles;
    if(tile&&!nearby.includes(tile))nearby.push(tile);
    const roads=nearby.flatMap(t=>t.streetContext?.roads??t.roads??[]);
    entry={tiles,clear:furniturePlanner(roads,nearby)};furniturePlanners.set(key,entry);
  }
  return entry.clear;
}

const planners = new WeakMap();
export function streetLampPlacement(world, tile, prop) {
  tile ??= world.tiles?.get(`${Math.floor(prop.x / 256)}_${Math.floor(prop.z / 256)}`);
  if (prop.kind !== 'street_lamp') return furnitureClearance(world,tile)(prop.kind,prop.x,prop.z,prop.yaw) ? prop : null;
  const key = tile ?? world, tiles = [...(world.tiles?.values() ?? [])];
  let entry = planners.get(key);
  if (!entry || entry.tiles.length !== tiles.length || tiles.some((t, i) => t !== entry.tiles[i])) {
    const cx = tile ? (tile.tx + 0.5) * 256 : prop.x, cz = tile ? (tile.tz + 0.5) * 256 : prop.z;
    const roads = [...(tile?.roads ?? []), ...(world.roadsNear?.(cx, cz, 280) ?? [])];
    const obstacles = tiles.flatMap(t => [...(t.buildings ?? []).map(b => b.footprint), ...(t.water ?? [])]);
    entry = { tiles, plan: lampPlanner(roads, obstacles) }; planners.set(key, entry);
  }
  const placed=entry.plan(prop);
  return placed && furnitureClearance(world,tile)(placed.kind,placed.x,placed.z,placed.yaw) ? placed : null;
}

/** Neighbouring lamps may already exist when a crossing road tile arrives. */
export function fixtureTiles(world, tile) {
  const result = [tile];
  if (!tile.roads.some(r => !r.tunnel) && !tile.roadbeds?.length && !tile.parking?.length) return result;
  for (const other of world.tiles.values()) {
    if (other.key !== tile.key && Math.abs(other.tx - tile.tx) <= 1 && Math.abs(other.tz - tile.tz) <= 1
      && other.props.some(p => p.kind === 'street_lamp' || furnitureSize[p.kind])) result.push(other);
  }
  return result;
}
