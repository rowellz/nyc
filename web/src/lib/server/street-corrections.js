/** Local map edits applied before scene geometry and planning/traffic diverge. */
const RIVERSIDE_TURNAROUND = 165423253000;

// Remove the small teardrop beside the GWB / Henry Hudson interchange. Keep
// Riverside Drive itself and the adjacent highway ramps in their original slots.
export const keepStreetRoad = road => road.id !== RIVERSIDE_TURNAROUND;

export function correctStreetTile(tile) {
  const roads = tile.roads.filter(keepStreetRoad);
  if (roads.length === tile.roads.length) return tile;

  // The turnaround also shares a ground-level asphalt polygon with Riverside
  // Drive. Join the existing approach curbs directly, removing the bulb and
  // its island, so a flat copy of the loop is not left below the removed deck.
  const roadbeds = tile.roadbeds.map(poly => {
    const ring = poly[0];
    const start = ring.findIndex(([x, z]) => x === 3383.59 && z === -10509.94);
    const end = ring.findIndex(([x, z]) => x === 3385.72 && z === -10567.65);
    if (start < 0 || end <= start) return poly;
    return [[...ring.slice(0, start + 1), ...ring.slice(end)]];
  });
  return { ...tile, roads, roadbeds };
}
