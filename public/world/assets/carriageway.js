/**
 * The carriageway: every square metre of ground the street builders pave or paint for motor traffic —
 * planimetric roadbeds and parking lots, the asphalt ribbons a tile without roadbed polygons falls back to,
 * and the painted lane envelope of each at-grade centreline.
 *
 * Sidewalks, plazas and their curbs stop at its edge. Planimetric sidewalk polygons overhang the curb often
 * enough that ~2% of the city's sidewalk area lies inside a roadbed, and in places (the Trans-Manhattan
 * Expressway at Highbridge Park, the Bronx approaches) a whole slab crosses the lanes: the 15 cm concrete
 * buries the lane lines it covers and leaves a granite curb standing in live traffic.
 *
 * Convex cells in a uniform grid, so the sidewalk builder can subtract them from its triangles exactly and
 * put a curb on the trimmed edge instead of on the edge the data drew.
 */

const CELL = 8;
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service']);
/** half of the 0.12 m lane line, so the paint clears the curb rather than dying under it */
const LINE = 0.06;
/** the ribbon half-width buildRoadbed falls back to when a tile has no planimetric roadbeds */
const RIBBON = 2.4;

function area(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function bounds(ring) {
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, minZ, maxX, maxZ };
}

function inside(x, z, ring) {
  let yes = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) yes = !yes;
  }
  return yes;
}

/** halves a convex ring on the line a -> b: [kept side, other side] */
function split(poly, a, b, sign) {
  const near = [], far = [];
  const distance = p => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const dp = distance(p), dq = distance(q);
    (dp >= 0 ? near : far).push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const t = dp / (dp - dq);
      const hit = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      near.push(hit); far.push(hit);
    }
  }
  return [near, far];
}

/** convex difference as non-overlapping convex pieces; the subject itself back when the two do not meet */
function subtract(poly, clip) {
  let kept = poly;
  const result = [], sign = Math.sign(area(clip));
  for (let i = 0; i < clip.length && kept.length; i++) {
    const parts = split(kept, clip[i], clip[(i + 1) % clip.length], sign);
    kept = parts[0];
    if (parts[1].length >= 3 && Math.abs(area(parts[1])) > 1e-6) result.push(parts[1]);
  }
  return kept.length < 3 || Math.abs(area(kept)) < 1e-6 ? [poly] : result;
}

/**
 * The half-width a footpath ribbon can have here without laying itself over the roadway. A 6 m pedestrian
 * way beside a roadbed puts half its width on the lanes; narrowing it keeps the path continuous where
 * dropping the piece would leave a hole in it.
 */
export function pathHalfWidth(index, hw, px, pz, dx, dz) {
  if (!index) return hw;
  const len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len, nz = dx / len;
  while (hw > 0.6 && (index.covers(px + nx * hw, pz + nz * hw) || index.covers(px - nx * hw, pz - nz * hw))) hw -= 0.5;
  return Math.max(0.6, hw);
}

/** Check the whole short ribbon, including corners that midpoint tests miss. */
export function pathPieceClear(index, pts, hw) {
  if (!index) return true;
  const [a, b] = pts, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-6) return false;
  const nx = -(b[1] - a[1]) / length * hw, nz = (b[0] - a[0]) / length * hw;
  return index.clip([[a[0]+nx,a[1]+nz],[b[0]+nx,b[1]+nz],
    [b[0]-nx,b[1]-nz],[a[0]-nx,a[1]-nz]]) === null;
}

/**
 * Index the motor-traffic surface of one tile. `triangulate` is geom2d's, passed in so this module stays
 * free of the geometry stack the worker bundles.
 */
export function carriagewayIndex(tile, roads, triangulate) {
  const grid = new Map(), cells = [];
  const add = ring => {
    if (!ring || ring.length < 3) return;
    const bb = bounds(ring);
    if (!(bb.maxX > bb.minX) || !(bb.maxZ > bb.minZ)) return;
    const cell = { ring, bb };
    cells.push(cell);
    for (let x = Math.floor(bb.minX / CELL); x <= Math.floor(bb.maxX / CELL); x++)
      for (let z = Math.floor(bb.minZ / CELL); z <= Math.floor(bb.maxZ / CELL); z++) {
        const key = `${x},${z}`;
        const list = grid.get(key);
        if (list) list.push(cell); else grid.set(key, [cell]);
      }
  };
  // Planimetric asphalt, holes respected: a roadbed's traffic island is not carriageway.
  for (const poly of [...tile.roadbeds, ...tile.parking]) {
    const tri = triangulate(poly);
    if (!tri) continue;
    for (let i = 0; i < tri.tris.length; i += 3) {
      add([0, 1, 2].map(k => {
        const v = tri.tris[i + k];
        return [tri.verts[v * 2], tri.verts[v * 2 + 1]];
      }));
    }
  }
  const covered = (x, z) => {
    const list = grid.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`);
    if (!list) return false;
    for (const cell of list) {
      if (x < cell.bb.minX || x > cell.bb.maxX || z < cell.bb.minZ || z > cell.bb.maxZ) continue;
      if (inside(x, z, cell.ring)) return true;
    }
    return false;
  };
  // Centrelines cover what the polygons miss: paint is drawn from them regardless, and a tile with no
  // roadbed polygons is paved from them too. Elevated roadways pass over the sidewalk, not through it.
  const seen = new Set();
  const ribbons = tile.roadbeds.length === 0;
  for (const r of roads) {
    if (seen.has(r.id) || r.tunnel || r.bridge || r.layer > 0) continue;
    seen.add(r.id);
    if (!DRIVABLE.has(r.cls) || !r.pts || r.pts.length < 2) continue;
    const lanes = Math.max(1, Math.min(10, r.lanes || 1));
    const painted = r.lanes > 0 && r.cls !== 'service' ? (lanes * Math.min(3.3, r.width / lanes)) / 2 + LINE : 0;
    // Only where the ribbons ARE the road surface. A service ribbon crossing a sidewalk is a driveway
    // apron: it is drawn under the slab at road level and stays hidden there, so it trims nothing.
    const paved = ribbons ? Math.max(RIBBON, r.width / 2) : 0;
    const hw = Math.max(painted, paved);
    if (hw <= 0) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.01) continue;
      const dx = (b[0] - a[0]) / len, dz = (b[1] - a[1]) / len;
      // Square ends butt at the bends, so the miter wedge on the outside of a turn is covered too.
      const s0 = i > 1 ? hw : 0, s1 = i < r.pts.length - 1 ? hw : 0;
      const ax = a[0] - dx * s0, az = a[1] - dz * s0, bx = b[0] + dx * s1, bz = b[1] + dz * s1;
      const rx = -dz * hw, rz = dx * hw;
      add([[ax - rx, az - rz], [bx - rx, bz - rz], [bx + rx, bz + rz], [ax + rx, az + rz]]);
    }
  }
  // One list when the ring sits in a single grid square, which is most of them.
  const near = bb => {
    const x0 = Math.floor(bb.minX / CELL), x1 = Math.floor(bb.maxX / CELL);
    const z0 = Math.floor(bb.minZ / CELL), z1 = Math.floor(bb.maxZ / CELL);
    if (x0 === x1 && z0 === z1) return grid.get(`${x0},${z0}`) ?? null;
    let found = null;
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const list = grid.get(`${x},${z}`);
        if (!list) continue;
        if (!found) found = new Set(list); else for (const cell of list) found.add(cell);
      }
    return found;
  };
  return {
    empty: cells.length === 0,
    cells,
    /** is this ground given over to motor traffic? */
    covers: covered,
    /**
     * The parts of a convex ring left outside the carriageway, or null when the carriageway does not reach
     * it — the common case, and the one that must cost nothing.
     */
    clip(ring) {
      const bb = bounds(ring);
      const list = near(bb);
      if (!list) return null;
      let parts = [ring], cut = false;
      for (const cell of list) {
        if (cell.bb.maxX <= bb.minX || cell.bb.minX >= bb.maxX || cell.bb.maxZ <= bb.minZ || cell.bb.minZ >= bb.maxZ) continue;
        const next = [];
        for (const part of parts) {
          const pieces = subtract(part, cell.ring);
          if (pieces.length === 1 && pieces[0] === part) { next.push(part); continue; }
          cut = true;
          for (const piece of pieces) if (piece.length >= 3) next.push(piece);
        }
        parts = next;
        if (!parts.length) break;
      }
      return cut ? parts : null;
    },
  };
}
