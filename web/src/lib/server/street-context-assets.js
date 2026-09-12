import { CLIENT_REVISION } from './client-cache.js';

export const streetContextAssetPaths = new Set([
  'world/assets/main-D_3aygO4.js', 'world/assets/streets-CfYSUqyW.js', 'world/assets/vehicles-_zJz3z3J.js',
]);

export function streetContextAssetTransform(rel, source) {
  if (!streetContextAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Street context anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel.endsWith('/main-D_3aygO4.js')) {
    replace('${this.baseUrl}/tiles/${e.key}.json.gz', '${this.baseUrl}/tiles/${e.key}.json.gz?v=' + CLIENT_REVISION);
  } else if (rel.endsWith('/streets-CfYSUqyW.js')) {
    replace('function te(t){let n=t.tile,r=new Map;',
      'function te(t){if(t.tile.streetContext){const c=t.tile.streetContext;return{tile:{...t.tile,crossings:c.crossings},roads:c.roads,pedestrianTiles:c.pedestrianTiles,quality:e.quality}}let n=t.tile,r=new Map;');
    replace('function Z(e){let t=[', 'function Z(e){const $changed=e;let t=[');
    // Geometry with complete context has no dependency on scene tile events.
    // Still rebuild the changed tile itself, including explicit replacements.
    replace('for(let e of N.values()){let n=e.tile.tx*256,',
      'for(let e of N.values()){if(e.tile.streetContext&&e.tile!==$changed)continue;let n=e.tile.tx*256,');
  } else {
    replace('class Roads {', 'class Roads {\n  streetContexts = new WeakMap();');
    replace('const key = roadKey(r);', 'const key = roadKey(r);if(tile.streetContext)this.streetContexts.set(r,tile.streetContext.roads);');
    replace('highwayLanePath(lane.road, roads, lane.segment',
      'highwayLanePath(lane.road, this.streetContexts.get(lane.road)??roads, lane.segment');
  }
  return source;
}
