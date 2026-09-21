import {footprints} from './footprints-data.js?v=rail-portal-guards-76';
function index(holes) {
 const cells=new Map();
 for(const ring of holes) {
  const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);
  for(let x=Math.floor(Math.min(...xs)/256);x<=Math.floor(Math.max(...xs)/256);x++)
   for(let z=Math.floor(Math.min(...zs)/256);z<=Math.floor(Math.max(...zs)/256);z++) {
    const key=`${x}_${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(ring);
   }
 }
 return cells;
}
const surface=index(footprints.surface),water=index(footprints.water);
export const holesForTile=tile=>surface.get(`${tile.tx}_${tile.tz}`)??[];
export function waterHolesForTiles(tiles) {
 const holes=new Set();for(const tile of tiles)for(const ring of water.get(`${tile.tx}_${tile.tz}`)??[])holes.add(ring);
 return [...holes];
}
