/** Lane joins and gore continuations only follow shared, snapped endpoints.
 * Plan the requested connected component, and reuse it when another decoded
 * tile supplies identical roads. Bound retained plans during long journeys.
 */
export function createLanePlanCache(plan, isHighway, endpointKey, limit = 64) {
  const networks = new WeakMap(), fingerprints = new WeakMap(), recent = new Map();
  const fingerprint = road => {
    let value = fingerprints.get(road);
    if (value === undefined) {
      value = JSON.stringify([road.id, road.cls, road.oneway, road.tunnel, road.bridge,
        road.lanes, road.width, road.pts]);
      fingerprints.set(road, value);
    }
    return value;
  };
  return (road, roads) => {
    if (!isHighway(road)) return null;
    let network = networks.get(roads);
    if (!network) {
      const byId = new Map(), endpoints = new Map();
      for (const r of roads) {
        if (!isHighway(r) || r.pts.length < 2 || byId.has(r.id)) continue;
        byId.set(r.id, r);
        for (const p of [r.pts[0], r.pts.at(-1)]) {
          const key = endpointKey(p), bucket = endpoints.get(key) ?? [];
          bucket.push(r); endpoints.set(key, bucket);
        }
      }
      network = { byId, endpoints, layouts: new Map() };
      networks.set(roads, network);
    }
    if (network.layouts.has(road.id)) return network.layouts.get(road.id);
    const first = network.byId.get(road.id);
    if (!first) return null;
    const found = new Set([first.id]), component = [first];
    for (let i = 0; i < component.length; i++) {
      const r = component[i];
      for (const p of [r.pts[0], r.pts.at(-1)]) {
        for (const next of network.endpoints.get(endpointKey(p))) {
          if (!found.has(next.id)) { found.add(next.id); component.push(next); }
        }
      }
    }
    component.sort((a, b) => a.id - b.id);
    const signature = component.map(fingerprint).join('\n');
    let layouts = recent.get(signature);
    if (layouts) recent.delete(signature);
    else layouts = plan(component);
    recent.set(signature, layouts);
    while (recent.size > limit) recent.delete(recent.keys().next().value);
    for (const [id, layout] of layouts) network.layouts.set(id, layout);
    return layouts.get(road.id) ?? null;
  };
}
