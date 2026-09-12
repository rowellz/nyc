import assert from 'node:assert/strict';
import { assets } from './sveltekit-assets.mjs';

const tunnels = await import(new URL('tunnels.js', assets));
const road = (id, pts, extra = {}) => ({ id, pts, cls: 'motorway', width: 12,
  lanes: 3, oneway: true, layer: 0, bridge: false, tunnel: false, ...extra });

// Two OSM ways form one 160 m approach. The slope must continue across the way
// boundary and meet the tunnel at its buried portal instead of resetting there.
const near = road(1, [[0, 0], [60, 0]]);
const far = road(2, [[60, 0], [160, 0]]);
const bore = road(3, [[0, 0], [-300, 0]], { tunnel: true, layer: -1 });
const profiles = tunnels.tunnelNetwork([near, far, bore]);

assert.equal(tunnels.tunnelHeight(profiles.get(near.id), 0), -tunnels.PORTAL_DEPTH);
assert.equal(tunnels.tunnelHeight(profiles.get(near.id), 60), -4.4);
assert.equal(tunnels.tunnelHeight(profiles.get(far.id), 0), -4.4);
assert.equal(tunnels.tunnelHeight(profiles.get(far.id), 100), 0);
assert.equal(tunnels.tunnelHeight(profiles.get(bore.id), 0), -tunnels.PORTAL_DEPTH);
assert.equal(tunnels.tunnelHeight(profiles.get(bore.id), 100), -tunnels.TUNNEL_DEPTH);

// Cross streets sharing the portal remain at street level: only motorway and
// trunk carriageways inherit the approach grade.
const cross = { ...road(4, [[0, 0], [0, 80]]), cls: 'secondary' };
const withCrossStreet = tunnels.tunnelNetwork([near, far, bore, cross]);
assert(!withCrossStreet.has(cross.id));

const holes = tunnels.tunnelHoles(profiles);
assert(holes.length > 0, 'the open part of the descent cuts the terrain');
const furthestHole = Math.max(...holes.flatMap(ring => ring.map(point => point[0])));
assert(furthestHole < 160 && furthestHole > 90, 'the opening ends after reaching tunnel clearance');

const world = { tiles: new Map([['0_0', { roads: [near, far, bore] }]]) };
assert.equal(tunnels.trafficHeight(world, near, 0, 0), -tunnels.PORTAL_DEPTH + 0.025);
assert.equal(tunnels.trafficHeight(world, far, 160, 0), 0);

console.log('PASS motorway approaches descend continuously to deeper tunnel portals');
