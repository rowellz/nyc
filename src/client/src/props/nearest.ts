import type { Prop, Tile } from '@shared/world';

/** Retain at most `limit` records, including while selecting from a dense city tile. */
export function nearestProps(tiles: Iterable<Tile>, x: number, z: number, limit = 200): Prop[] {
  const selected: { prop: Prop; d: number }[] = [];
  if (limit <= 0) return [];
  for (const tile of tiles) for (const prop of tile.props) {
    const d = (prop.x - x) ** 2 + (prop.z - z) ** 2;
    if (!Number.isFinite(d) || (selected.length === limit && d >= selected[limit - 1].d)) continue;
    let i = selected.length;
    while (i > 0 && selected[i - 1].d > d) i--;
    selected.splice(i, 0, { prop, d });
    if (selected.length > limit) selected.pop();
  }
  return selected.map(row => row.prop);
}
