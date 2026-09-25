import { elevationData as grid } from './elevation-data.js';

export const TERRAIN_STEP = grid.step;
/** Metres above the city's sea-level datum. A fixed diagonal per cell makes
 * CPU support queries identical to the rendered and collidable terrain. */
export function terrainHeight(x, z) {
  const gx = (x - grid.x0) / grid.step, gz = (z - grid.z0) / grid.step;
  if (!Number.isFinite(gx + gz) || gx < 0 || gz < 0 || gx > grid.width - 1 || gz > grid.height - 1) return 0;
  const ix = Math.min(grid.width-2,Math.floor(gx)), iz = Math.min(grid.height-2,Math.floor(gz)), u = gx - ix, v = gz - iz, i = iz * grid.width + ix;
  const a = grid.values[i], b = grid.values[i + 1], c = grid.values[i + grid.width], d = grid.values[i + grid.width + 1];
  return (u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d)) / 10;
}

/** Lift vertices without changing their horizontal footprint. Used after
 * terrain/tunnel clipping, so all original water and access holes survive. */
export function liftPositions(position, ox = 0, oz = 0) {
  for (let i = 0; i < position.length; i += 3) position[i + 1] += terrainHeight(position[i] + ox, position[i + 2] + oz);
  return position;
}

function clip(poly, distance) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = distance(a), db = distance(b);
    if (da >= -1e-8) out.push(a);
    if ((da < -1e-8 && db > 1e-8) || (da > 1e-8 && db < -1e-8)) {
      const t = da / (da - db); out.push(a.map((v, k) => v + (b[k] - v) * t));
    }
  }
  return out;
}

/** Split long triangles at the height grid before displacement. Attributes are
 * interpolated together: decals, curbs and their colliders stay on the ground.
 * Positions use world x/z, or a supplied chunk origin for distant scenery. */
export function elevateMesh(attributes, index, ox = 0, oz = 0) {
  const entries = Object.entries(attributes), offsets = []; let stride = 0;
  for (const [, a] of entries) { offsets.push(stride); stride += a.itemSize ?? a.size; }
  const pi = entries.findIndex(([name]) => name === 'position'), p0 = offsets[pi];
  const outputs = entries.map(([,a]) => Array.from(a.array??a.data)), indices = [];
  const originalPosition=entries[pi][1].array??entries[pi][1].data;
  liftPositions(outputs[pi],ox,oz);
  const ni=entries.findIndex(([name])=>name==='normal');
  const transformNormal=(part,x,z)=>{
    const dx=(terrainHeight(x+.1,z)-terrainHeight(x-.1,z))/.2,dz=(terrainHeight(x,z+.1)-terrainHeight(x,z-.1))/.2;
    part[0]-=dx*part[1];part[2]-=dz*part[1];
    const length=Math.hypot(...part)||1;return part.map(v=>v/length);
  };
  if(ni>=0)for(let i=0;i<originalPosition.length;i+=3){
    const n=transformNormal(outputs[ni].slice(i,i+3),originalPosition[i]+ox,originalPosition[i+2]+oz);
    for(let j=0;j<3;j++)outputs[ni][i+j]=n[j];
  }
  const vertex = n => entries.flatMap(([, a]) => Array.from((a.array ?? a.data).slice(n * (a.itemSize ?? a.size), (n + 1) * (a.itemSize ?? a.size))));
  const emit = poly => {
    if (poly.length < 3) return;
    for (let i = 1; i < poly.length - 1; i++) {
      const tri = [poly[0], poly[i], poly[i + 1]];
      // Avoid zero-area slivers along exact grid boundaries.
      const a = tri[0], b = tri[1], c = tri[2];
      const cross = [ (b[p0+1]-a[p0+1])*(c[p0+2]-a[p0+2])-(b[p0+2]-a[p0+2])*(c[p0+1]-a[p0+1]),
        (b[p0+2]-a[p0+2])*(c[p0]-a[p0])-(b[p0]-a[p0])*(c[p0+2]-a[p0+2]),
        (b[p0]-a[p0])*(c[p0+1]-a[p0+1])-(b[p0+1]-a[p0+1])*(c[p0]-a[p0]) ];
      if (Math.hypot(...cross) < 1e-9) continue;
      for (const v of tri) {
        const n = outputs[pi].length / 3;
        for (let k = 0; k < entries.length; k++) {
          const a = entries[k][1], size = a.itemSize ?? a.size, part = v.slice(offsets[k], offsets[k] + size);
          if (k === pi) part[1] += terrainHeight(part[0] + ox, part[2] + oz);
          if(entries[k][0]==='normal') {
            const x=v[p0]+ox,z=v[p0+2]+oz;
            const normal=transformNormal(part,x,z);for(let j=0;j<3;j++)part[j]=normal[j];
          }
          outputs[k].push(...part);
        }
        indices.push(n);
      }
    }
  };
  for (let i = 0; i < index.length; i += 3) {
    // Most road detail and rail furniture fits inside one terrain face. Retain
    // its indexed vertices; only triangles crossing a grid line need clipping.
    const a=index[i]*3,b=index[i+1]*3,c=index[i+2]*3,p=originalPosition;
    const cx=Math.floor((p[a]+ox)/TERRAIN_STEP),cz=Math.floor((p[a+2]+oz)/TERRAIN_STEP);
    const inside=n=>p[n]+ox>=cx*TERRAIN_STEP-1e-7&&p[n]+ox<=(cx+1)*TERRAIN_STEP+1e-7&&p[n+2]+oz>=cz*TERRAIN_STEP-1e-7&&p[n+2]+oz<=(cz+1)*TERRAIN_STEP+1e-7;
    const side=n=>(p[n]+ox-cx*TERRAIN_STEP)+(p[n+2]+oz-cz*TERRAIN_STEP)-TERRAIN_STEP;
    if(inside(b)&&inside(c)&&((side(a)<=1e-7&&side(b)<=1e-7&&side(c)<=1e-7)||(side(a)>=-1e-7&&side(b)>=-1e-7&&side(c)>=-1e-7))){indices.push(index[i],index[i+1],index[i+2]);continue;}
    const tri = [vertex(index[i]), vertex(index[i+1]), vertex(index[i+2])];
    const x0 = Math.floor((Math.min(...tri.map(p=>p[p0])) + ox) / TERRAIN_STEP), x1 = Math.floor((Math.max(...tri.map(p=>p[p0])) + ox - 1e-7) / TERRAIN_STEP);
    const z0 = Math.floor((Math.min(...tri.map(p=>p[p0+2])) + oz) / TERRAIN_STEP), z1 = Math.floor((Math.max(...tri.map(p=>p[p0+2])) + oz - 1e-7) / TERRAIN_STEP);
    for (let z = z0; z <= Math.max(z0,z1); z++) for (let x = x0; x <= Math.max(x0,x1); x++) {
      const left = x * TERRAIN_STEP - ox, top = z * TERRAIN_STEP - oz;
      let poly = clip(tri,p=>p[p0]-left); poly = clip(poly,p=>left+TERRAIN_STEP-p[p0]);
      poly = clip(poly,p=>p[p0+2]-top); poly = clip(poly,p=>top+TERRAIN_STEP-p[p0+2]);
      const diagonal = p => TERRAIN_STEP - (p[p0]-left) - (p[p0+2]-top);
      if(poly.every(p=>Math.abs(diagonal(p))<1e-8))emit(poly);
      else {emit(clip(poly,diagonal)); emit(clip(poly,p=>-diagonal(p)));}
    }
  }
  const result = {};
  entries.forEach(([name,a],i)=>{result[name]={array:new Float32Array(outputs[i]),itemSize:a.itemSize??a.size};});
  return { attributes: result, index: new Uint32Array(indices) };
}

export function elevateGeometry(geometry) {
  const result = elevateMesh(geometry.attributes, geometry.index.array);
  const Attribute = geometry.attributes.position.constructor;
  for (const [name,a] of Object.entries(result.attributes)) geometry.setAttribute(name,new Attribute(a.array,a.itemSize));
  // PlaneGeometry's position constructor forces Float32Array, which WebGL
  // cannot use for element indices. Let Three choose an unsigned index type.
  geometry.setIndex(Array.from(result.index));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function buildingElevation(building) {
  const ring = building.footprint?.[0]; if (!ring?.length) return 0;
  // Level roofs and floors; foundations meet the highest point on the lot.
  return Math.max(...ring.map(p=>terrainHeight(p[0],p[1])));
}

export function updateGrassElevation(uniforms,x,z) {
  const ox=(Math.floor(x/64)-1)*64,oz=(Math.floor(z/64)-1)*64;
  uniforms.uElevationOrigin.value.set(ox,oz);
  for(let j=0;j<4;j++)for(let i=0;i<4;i++)uniforms.uElevation.value[j*4+i]=terrainHeight(ox+i*64,oz+j*64);
}

/** Rigid landmark models retain level floors and their matching support data. */
export function elevateLandmark(landmark,parts,root) {
  const h=terrainHeight(...landmark.center);root.position.y=h;
  for(const p of parts.colliders??[]){p.y0+=h;p.y1+=h;}
  for(const p of parts.decks??[])p.height+=h;
  for(const p of parts.seats??[]){p.y+=h;p.groundY=(p.groundY??0)+h;}
  for(const p of parts.screens?.sources??[]){p.y+=h;if(p.groundY!==undefined)p.groundY+=h;}
}
