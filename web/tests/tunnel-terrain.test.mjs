import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assets } from './sveltekit-assets.mjs';
import { CLIENT_REVISION } from '../src/lib/server/client-cache.js';

const { syncTunnelTerrain, worldTunnels } = await import(new URL('tunnels.js', assets));
const { triangleHeight } = await import(new URL('supports.js', assets));
const { holesForTile } = await import(new URL(`rail/footprints.js?v=${CLIENT_REVISION}`, assets));
assert((await readFile(new URL('streets-CfYSUqyW.js', assets), 'utf8'))
  .includes('e.events.on(`tileUnloaded`,t=>{ee(t);$tunnelTerrain(e)})'), 'tile removal refreshes terrain even without another road build');
class Attribute {
  constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
}
class Geometry {
  constructor(attributes = { position: new Attribute(new Float32Array([
    0, 0, 0, 256, 0, 0, 256, 0, 256, 0, 0, 256,
  ]), 3) }, index = [0, 2, 1, 0, 3, 2]) {
    this.attributes = Object.fromEntries(Object.entries(attributes).map(([name, a]) =>
      [name, new Attribute(new Float32Array(a.array), a.itemSize)]));
    this.index = { array: Uint32Array.from(index) };
  }
  clone() { return new Geometry(this.attributes, this.index.array); }
  getAttribute(name) { return this.attributes[name]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  setIndex(value) { this.index.array = Uint32Array.from(value); }
  computeBoundingSphere() {}
  dispose() {}
}
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12,
  lanes: 3, layer: 0, bridge: false, tunnel: false, ...extra });
const bore = road(1, [[-100, 128], [140, 128]], { tunnel: true, layer: -1 });
const approach = road(2, [[140, 128], [400, 128]]);
const tile = (tx, roads) => ({ key: `${tx}_0`, tx, tz: 0, roads });
function fixture(context = false) {
  const local = tile(0, [approach]), neighbor = tile(-1, [bore]);
  if (context) local.streetContext = { roads: [bore, approach] };
  const ground = { geometry: new Geometry() }, colliders = [];
  const ctx = { world: { tiles: new Map([[local.key, local]]) },
    scene: { getObjectByName: name => name === 'env-ground-0_0' ? ground : null },
    physics: { ready: true, loadLand: (tile, holes) => colliders.push({ key: tile.key, holes }) } };
  return { ctx, local, neighbor, ground, colliders };
}
function covered(mesh, x, z) {
  const { attributes, index } = mesh.geometry;
  for (let i = 0; i < index.array.length; i += 3) {
    const tri = [0, 1, 2].map(j => {
      const offset = index.array[i + j] * 3;
      return Array.from(attributes.position.array.slice(offset, offset + 3));
    });
    if (triangleHeight(tri, x, z)?.inside) return true;
  }
  return false;
}

// The road worker sees the complete context even when the bore's owner is
// outside scene residency. Terrain must cut the very same approach footprint.
{
  const f = fixture(true);
  syncTunnelTerrain(f.ctx, f.local);
  assert(worldTunnels(f.ctx.world).has(bore.id), 'terrain profiles include the worker road context');
  assert(!covered(f.ground, 200, 128), 'context-only tunnel cannot retain a ground sheet over its entrance');
  assert(covered(f.ground, 200, 160), 'neighboring surface remains intact');
  assert(f.colliders.some(c => c.key === f.local.key && c.holes.length), 'ground collision matches the opening');
}

// Legacy tiles without context still need cuts refreshed across tile owners.
{
  const f = fixture();
  syncTunnelTerrain(f.ctx, f.local);
  assert(covered(f.ground, 200, 128));
  f.ctx.world.tiles.set(f.neighbor.key, f.neighbor);
  syncTunnelTerrain(f.ctx, f.neighbor);
  assert(!covered(f.ground, 200, 128), 'late neighbor recuts an already-built approach tile');
  const geometry = f.ground.geometry, calls = f.colliders.length;
  syncTunnelTerrain(f.ctx, f.neighbor);
  assert.equal(f.ground.geometry, geometry, 'unchanged holes do not recreate geometry');
  assert.equal(f.colliders.length, calls, 'unchanged holes do not recreate colliders');
  f.ctx.world.tiles.delete(f.neighbor.key);
  syncTunnelTerrain(f.ctx);
  assert(covered(f.ground, 200, 128), 'removing a profile restores the original surface');
  assert.deepEqual(f.colliders.at(-1), {key:f.local.key,holes:holesForTile(f.local)},
    'restored road ground has matching collision while permanent railway openings remain');
}
// Unrelated arrivals must not reallocate correct terrain; a newly created
// ground mesh must still receive cuts when profiles have not changed.
{
  const f = fixture(true);
  syncTunnelTerrain(f.ctx, f.local);
  const geometry = f.ground.geometry, calls = f.colliders.length;
  const far = tile(50, []);
  f.ctx.world.tiles.set(far.key, far);
  syncTunnelTerrain(f.ctx, far);
  assert.equal(f.ground.geometry, geometry);
  assert.equal(f.colliders.length, calls);
  const replacement = { geometry: new Geometry() };
  f.ctx.scene.getObjectByName = name => name === 'env-ground-0_0' ? replacement : null;
  syncTunnelTerrain(f.ctx, f.local);
  assert(!covered(replacement, 200, 128), 'late/replaced ground gets the existing cuts');
}
console.log('PASS tunnel entrance terrain follows complete road context, neighboring arrivals/removals and stable geometry');
