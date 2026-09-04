/**
 * Debug world renderer. Used ONLY when the buildings module is missing or ?debug=1.
 * Per loaded tile: buildings extruded from their footprints (one merged BufferGeometry, flat-shaded
 * grey), roads as dark ribbons at y=0.02 from centerlines + width, water blue, parks green.
 * Also (when the environment / atmosphere modules are missing) a ground plane, a sky colour and lights,
 * so the data can be eyeballed immediately.
 */
import * as THREE from 'three';
import type { Polygon, RoadSegment, Tile } from '@shared/world';
import type { GameContext, GameModule } from './context';

export interface DebugWorldOptions {
  buildings: boolean;
  roads: boolean;
  areas: boolean; // water / parks
  ground: boolean;
  lights: boolean;
}

const COLORS = {
  building: 0x9a9a96,
  roofTint: 0xb5b3ad,
  road: 0x2b2b2e,
  footway: 0x5a5651,
  water: 0x1f4f7a,
  park: 0x3f6b35,
  ground: 0x6b6862,
  plaza: 0x8a8580,
};

export function createDebugWorld(ctx: GameContext, opts: Partial<DebugWorldOptions> = {}): GameModule {
  const o: DebugWorldOptions = { buildings: true, roads: true, areas: true, ground: false, lights: false, ...opts };
  const group = new THREE.Group();
  group.name = 'debugWorld';
  ctx.worldGroup.add(group);
  const perTile = new Map<string, THREE.Object3D[]>();

  const matBuilding = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, flatShading: true, vertexColors: true });
  const matRoad = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  const matWater = new THREE.MeshStandardMaterial({ color: COLORS.water, roughness: 0.2, metalness: 0.1 });
  const matPark = new THREE.MeshStandardMaterial({ color: COLORS.park, roughness: 1 });
  const matPlaza = new THREE.MeshStandardMaterial({ color: COLORS.plaza, roughness: 1 });

  let sun: THREE.DirectionalLight | null = null;
  let hemi: THREE.HemisphereLight | null = null;
  if (o.ground) {
    const g = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
    g.rotation.x = -Math.PI / 2;
    g.position.y = -0.01;
    g.receiveShadow = true;
    g.name = 'debugGround';
    group.add(g);
  }
  if (o.lights) {
    // sky fill: real shadow sides of buildings sit ~1/4 to 1/8 of the sunlit side, not 1/35
    hemi = new THREE.HemisphereLight(0xbfd4ff, 0x6b665c, 2.0);
    group.add(hemi);
    sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.castShadow = ctx.quality.shadows;
    const s = sun.shadow;
    s.mapSize.set(Math.min(ctx.quality.shadowMapSize, 2048), Math.min(ctx.quality.shadowMapSize, 2048));
    s.camera.near = 1;
    s.camera.far = 1200;
    s.camera.left = s.camera.bottom = -350;
    s.camera.right = s.camera.top = 350;
    s.bias = -0.0004;
    s.normalBias = 0.6;
    group.add(sun);
    group.add(sun.target);
    ctx.scene.background = new THREE.Color(0x8fb4e3);
    ctx.scene.fog = new THREE.Fog(0xc9d6e6, 600, Math.max(2500, ctx.quality.farDistance));
  }

  function build(tile: Tile): void {
    const objs: THREE.Object3D[] = [];
    if (o.buildings && tile.buildings.length) {
      const geo = buildingsGeometry(tile);
      if (geo) {
        const m = new THREE.Mesh(geo, matBuilding);
        m.castShadow = true;
        m.receiveShadow = true;
        m.name = `dbg-bld-${tile.key}`;
        objs.push(m);
      }
    }
    if (o.roads && tile.roads.length) {
      const geo = roadsGeometry(tile);
      if (geo) {
        const m = new THREE.Mesh(geo, matRoad);
        m.receiveShadow = true;
        m.name = `dbg-road-${tile.key}`;
        objs.push(m);
      }
    }
    if (o.areas) {
      const water = flatPolygons(tile.water, 0.01);
      if (water) objs.push(named(new THREE.Mesh(water, matWater), `dbg-water-${tile.key}`));
      const parks = flatPolygons(tile.parks, 0.012);
      if (parks) objs.push(named(new THREE.Mesh(parks, matPark), `dbg-park-${tile.key}`));
      const plazas = flatPolygons(tile.plazas, 0.011);
      if (plazas) objs.push(named(new THREE.Mesh(plazas, matPlaza), `dbg-plaza-${tile.key}`));
    }
    for (const obj of objs) group.add(obj);
    perTile.set(tile.key, objs);
  }

  function drop(key: string): void {
    const objs = perTile.get(key);
    if (!objs) return;
    perTile.delete(key);
    for (const obj of objs) {
      group.remove(obj);
      if (obj instanceof THREE.Mesh) obj.geometry.dispose();
    }
  }

  for (const t of ctx.world.tiles.values()) build(t);
  const offLoad = ctx.events.on('tileLoaded', build);
  const offUnload = ctx.events.on('tileUnloaded', drop);

  const tmp = new THREE.Vector3();
  return {
    name: 'debugWorld',
    update() {
      if (sun) {
        const d = ctx.time.daylight;
        const dir = ctx.time.sunElevation > -0.05 ? ctx.time.sunDir : ctx.time.moonDir;
        const anchor = ctx.camera.position;
        sun.target.position.copy(anchor);
        sun.position.copy(anchor).addScaledVector(tmp.copy(dir), 500);
        sun.intensity = 0.15 + 2.3 * d;
        sun.color.setHSL(0.09, 0.5, 0.55 + 0.45 * Math.min(1, ctx.time.sunElevation * 4));
        if (hemi) hemi.intensity = 0.25 + 1.9 * d;
        const sky = ctx.scene.background as THREE.Color;
        sky.setHSL(0.6, 0.55, 0.06 + 0.56 * d);
        if (ctx.scene.fog instanceof THREE.Fog) ctx.scene.fog.color.copy(sky).lerp(new THREE.Color(0xffffff), 0.25 * d);
      }
    },
    dispose() {
      offLoad();
      offUnload();
      for (const k of Array.from(perTile.keys())) drop(k);
      ctx.worldGroup.remove(group);
    },
  };
}

function named<T extends THREE.Object3D>(obj: T, name: string): T {
  obj.name = name;
  return obj;
}

/** merged extruded footprints for a tile; vertex colours darken walls slightly vs roofs and vary per building */
function buildingsGeometry(tile: Tile): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (const b of tile.buildings) {
    const outer = b.footprint[0];
    if (!outer || outer.length < 3) continue;
    const h = Math.max(3, b.height || 3);
    // per-building tint from id so adjacent buildings separate visually
    const tint = 0.82 + ((b.id * 2654435761) % 1000) / 1000 * 0.18;
    c.setHex(COLORS.building).multiplyScalar(tint);
    const ccw = signedArea(outer) < 0; // in x/z with z south, "counter-clockwise from above" has negative signed area in (x,z)
    for (const ring of b.footprint) {
      const n = ring.length;
      if (n < 3) continue;
      for (let i = 0; i < n; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % n];
        const ex = bx - ax, ez = bz - az;
        const len = Math.hypot(ex, ez) || 1;
        // outward normal: for outer ring wound CCW (from above, x east z south) it is (ez, -ex) rotated; flip if CW
        let nx = ez / len, nz = -ex / len;
        if (!ccw) { nx = -nx; nz = -nz; }
        const base = pos.length / 3;
        pos.push(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az);
        for (let k = 0; k < 4; k++) {
          nrm.push(nx, 0, nz);
          col.push(c.r * 0.9, c.g * 0.9, c.b * 0.9);
        }
        // (b-a)x(c-a) for (a,b,c)=(bottom-start,bottom-end,top-end) points INWARD for a CCW ring, so wind the other way
        if (ccw) idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    // roof
    const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = b.footprint.slice(1).filter((r) => r.length >= 3).map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
    let tris: number[][] = [];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      tris = [];
    }
    if (tris.length) {
      const all = [...contour, ...holes.flat()];
      const base = pos.length / 3;
      for (const p of all) {
        pos.push(p.x, h, p.y);
        nrm.push(0, 1, 0);
        col.push(c.r * 1.05, c.g * 1.05, c.b * 1.02);
      }
      for (const t of tris) {
        // ensure the roof faces up (+y): in x/z space with y up, an (x,z) triangle CCW when seen from above has negative signed area
        const a = all[t[0]], bb = all[t[1]], cc = all[t[2]];
        const area = (bb.x - a.x) * (cc.y - a.y) - (cc.x - a.x) * (bb.y - a.y);
        if (area < 0) idx.push(base + t[0], base + t[1], base + t[2]);
        else idx.push(base + t[0], base + t[2], base + t[1]);
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function signedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** ribbons along road centerlines. Bridges lifted by 6 m per layer so they read; tunnels skipped. */
function roadsGeometry(tile: Tile): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const seen = new Set<number>();
  for (const r of tile.roads) {
    if (r.tunnel) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const w = Math.max(1.5, r.width || widthByClass(r));
    const y = 0.02 + (r.bridge ? Math.max(1, r.layer) * 6 : 0);
    const isFoot = r.cls === 'footway' || r.cls === 'steps' || r.cls === 'pedestrian' || r.cls === 'cycleway';
    c.setHex(isFoot ? COLORS.footway : COLORS.road);
    if (r.cls === 'primary' || r.cls === 'trunk' || r.cls === 'motorway') c.multiplyScalar(0.85);
    ribbon(r.pts, w, y, pos, nrm, col, idx, c);
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function widthByClass(r: RoadSegment): number {
  switch (r.cls) {
    case 'motorway': return 22;
    case 'trunk': return 18;
    case 'primary': return 16;
    case 'secondary': return 13;
    case 'tertiary': return 11;
    case 'residential': return 9;
    case 'service': return 5;
    case 'pedestrian': return 4;
    default: return 2.5;
  }
}

/** polyline -> flat strip with mitered joins (clamped) */
function ribbon(pts: [number, number][], width: number, y: number, pos: number[], nrm: number[], col: number[], idx: number[], c: THREE.Color): void {
  if (pts.length < 2) return;
  const hw = width / 2;
  const base = pos.length / 3;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    // direction at this vertex: average of adjacent segment directions
    let dx = 0, dz = 0;
    if (i > 0) { dx += x - pts[i - 1][0]; dz += z - pts[i - 1][1]; }
    if (i < n - 1) { dx += pts[i + 1][0] - x; dz += pts[i + 1][1] - z; }
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    // perpendicular (left of travel), miter scale clamped to 2x
    let px = -dz, pz = dx;
    let scale = 1;
    if (i > 0 && i < n - 1) {
      const ax = x - pts[i - 1][0], az = z - pts[i - 1][1];
      const al = Math.hypot(ax, az) || 1;
      const cosHalf = Math.abs((ax / al) * dx + (az / al) * dz);
      scale = Math.min(2, 1 / Math.max(0.5, cosHalf));
    }
    px *= hw * scale; pz *= hw * scale;
    pos.push(x + px, y, z + pz, x - px, y, z - pz);
    nrm.push(0, 1, 0, 0, 1, 0);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let i = 0; i + 1 < n; i++) {
    const a = base + i * 2, b = a + 1, cc = a + 2, d = a + 3;
    // (x,z) plane with y up: winding chosen so the face normal is +y
    idx.push(a, cc, b, b, cc, d);
  }
}

function flatPolygons(polys: Polygon[], y: number): THREE.BufferGeometry | null {
  if (!polys || !polys.length) return null;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const poly of polys) {
    const outer = poly[0];
    if (!outer || outer.length < 3) continue;
    const contour = outer.map(([x, z]) => new THREE.Vector2(x, z));
    const holes = poly.slice(1).filter((r) => r.length >= 3).map((r) => r.map(([x, z]) => new THREE.Vector2(x, z)));
    let tris: number[][];
    try {
      tris = THREE.ShapeUtils.triangulateShape(contour, holes);
    } catch {
      continue;
    }
    const all = [...contour, ...holes.flat()];
    const base = pos.length / 3;
    for (const p of all) pos.push(p.x, y, p.y);
    for (const t of tris) {
      const a = all[t[0]], b = all[t[1]], c = all[t[2]];
      const area = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
      if (area < 0) idx.push(base + t[0], base + t[1], base + t[2]);
      else idx.push(base + t[0], base + t[2], base + t[1]);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
