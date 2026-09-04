/**
 * Minimap: 280x180 canvas, rotates with the camera. The static city (tiles) is drawn into a cached layer
 * (~1.8 km square around the player) that is rebuilt only when the player drifts 300 m from its centre or
 * tiles changed (debounced). The visible frame (layer blit + safe zone + players + pickups + arrow + the two
 * nearest street names at the frame edge + north) is redrawn at most 15 Hz. Zoom follows speed: on foot
 * 0.5 px/m, driving 0.3 px/m, eased between the two.
 */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import { TILE_SIZE, tileIndex } from '@shared/geo';
import { StateFlag } from '@shared/protocol';
import type { GameContext } from '@/core/context';
import { MAP_COLORS, drawArrow, drawDot, drawTile, headingOf } from './mapDraw';
import { FONT_HEAD } from './styles';

export const MINIMAP_W = 280;
export const MINIMAP_H = 180;
const LAYER_SCALE = 0.5; // css px per meter in the cached layer
const WALK_SCALE = 0.5;
const DRIVE_SCALE = 0.3;
const DRIVE_SPEED = 4; // m/s: above this the map zooms out
const LAYER_M = isIOS() ? 768 : 1800; // meters covered by the cached layer (square)
const REBUILD_DIST = 300;
const HZ = 15;
const LABEL_EVERY = 5; // ticks between street-label refreshes (~3 Hz)
const MINOR = new Set(['footway', 'steps', 'cycleway', 'pedestrian', 'service']);
const EDGE = 9; // label / north inset from the frame

interface StreetLabel { name: string; x: number; z: number; dx: number; dz: number }

const _dir = new THREE.Vector3();

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private layer: HTMLCanvasElement;
  private lg: CanvasRenderingContext2D;
  // Zero forces first allocation at DPR 1; a new canvas already has a nonzero default width.
  private dpr = 0;
  private width = MINIMAP_W;
  private height = MINIMAP_H;
  private layerCx = NaN;
  private layerCz = NaN;
  private layerDirty = true;
  private lastLayerBuild = -Infinity;
  private acc = 0;
  private scale = WALK_SCALE;
  private labels: StreetLabel[] = [];
  private labelTick = 0;
  private off: (() => void)[] = [];

  constructor(private ctx: GameContext) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'minimap';
    this.g = this.canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.layer = document.createElement('canvas');
    this.lg = this.layer.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.resize();
    const dirty = () => {
      this.layerDirty = true;
    };
    this.off.push(ctx.events.on('tileLoaded', dirty), ctx.events.on('tileUnloaded', dirty));
  }

  private resize(): void {
    const dpr = isIOS() ? 1 : Math.min(2, window.devicePixelRatio || 1);
    if (dpr === this.dpr && this.canvas.width) return;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    const lp = Math.round(LAYER_M * LAYER_SCALE * dpr);
    this.layer.width = lp;
    this.layer.height = lp;
    this.layerDirty = true;
    this.layerCx = NaN;
  }

  /** Match the active touch layer; draw at native logical size so icons stay readable. */
  setCompact(compact: boolean): void {
    const width = compact ? 140 : MINIMAP_W, height = compact ? 90 : MINIMAP_H;
    if (this.width === width && this.height === height) return;
    this.width = width; this.height = height; this.dpr = 0;
    this.resize();
  }

  /** @param speed local ground speed in m/s (0 on foot) drives the zoom */
  update(dt: number, t: number, speed = 0): void {
    this.acc += dt;
    if (this.acc < 1 / HZ) return;
    const step = this.acc;
    this.acc = 0;
    this.resize();
    const st = this.ctx.state;
    const p = st.screenshotMode ? this.ctx.camera.position : st.local.state;
    const px = p.x, pz = p.z;
    const target = speed > DRIVE_SPEED ? DRIVE_SCALE : WALK_SCALE;
    this.scale += (target - this.scale) * Math.min(1, step * 2.5);
    if (Math.abs(this.scale - target) < 0.002) this.scale = target;
    // layer
    const far = !Number.isFinite(this.layerCx) || Math.hypot(px - this.layerCx, pz - this.layerCz) > REBUILD_DIST;
    if (far || (this.layerDirty && t - this.lastLayerBuild > 0.6)) {
      this.buildLayer(px, pz);
      this.lastLayerBuild = t;
    }
    if (++this.labelTick >= LABEL_EVERY) {
      this.labelTick = 0;
      this.pickLabels(px, pz);
    }
    this.draw(px, pz);
  }

  private buildLayer(px: number, pz: number): void {
    const world = this.ctx.world;
    const s = LAYER_SCALE * this.dpr;
    const cx = px, cz = pz;
    const ox = cx - LAYER_M / 2, oz = cz - LAYER_M / 2;
    const g = this.lg;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = MAP_COLORS.water;
    g.fillRect(0, 0, this.layer.width, this.layer.height);
    // land for every indexed tile in range (loaded or not), then detail for loaded ones
    const tx0 = tileIndex(ox), tx1 = tileIndex(ox + LAYER_M), tz0 = tileIndex(oz), tz1 = tileIndex(oz + LAYER_M);
    if (world.hasTile) {
      g.fillStyle = MAP_COLORS.land;
      for (let tx = tx0; tx <= tx1; tx++)
        for (let tz = tz0; tz <= tz1; tz++) if (world.hasTile(tx, tz)) g.fillRect((tx * TILE_SIZE - ox) * s, (tz * TILE_SIZE - oz) * s, TILE_SIZE * s + 0.6, TILE_SIZE * s + 0.6);
    }
    for (const tile of world.tiles.values()) {
      if (tile.tx < tx0 || tile.tx > tx1 || tile.tz < tz0 || tile.tz > tz1) continue;
      drawTile(g, tile, s, ox, oz, false, !!world.hasTile);
    }
    this.layerCx = cx;
    this.layerCz = cz;
    this.layerDirty = false;
  }

  /** the two nearest distinct named streets: closest point + direction of the closest segment */
  private pickLabels(px: number, pz: number): void {
    const r = Math.hypot(this.width * 0.5, this.height * 0.6) / this.scale + 20;
    const best: (StreetLabel & { d: number })[] = [];
    for (const road of this.ctx.world.roadsNear(px, pz, r)) {
      if (!road.name || road.tunnel || MINOR.has(road.cls)) continue;
      const pts = road.pts;
      let bd = Infinity, bx = 0, bz = 0, bdx = 0, bdz = 1;
      for (let i = 1; i < pts.length; i++) {
        const ax = pts[i - 1][0], az = pts[i - 1][1], dx = pts[i][0] - ax, dz = pts[i][1] - az;
        const l2 = dx * dx + dz * dz;
        if (l2 < 1e-6) continue;
        const tt = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
        const qx = ax + dx * tt, qz = az + dz * tt;
        const d = (qx - px) * (qx - px) + (qz - pz) * (qz - pz);
        if (d < bd) {
          bd = d;
          bx = qx;
          bz = qz;
          const l = Math.sqrt(l2);
          bdx = dx / l;
          bdz = dz / l;
        }
      }
      if (!Number.isFinite(bd) || bd > r * r) continue;
      const seen = best.find((b) => b.name === road.name);
      if (seen) {
        if (bd < seen.d) Object.assign(seen, { d: bd, x: bx, z: bz, dx: bdx, dz: bdz });
        continue;
      }
      best.push({ name: road.name, d: bd, x: bx, z: bz, dx: bdx, dz: bdz });
    }
    best.sort((a, b) => a.d - b.d);
    this.labels = best.slice(0, 2);
  }

  private draw(px: number, pz: number): void {
    const ctx = this.ctx;
    const st = ctx.state;
    const g = this.g;
    const dpr = this.dpr;
    const W = this.width, H = this.height;
    const scale = this.scale;
    ctx.camera.getWorldDirection(_dir);
    const heading = headingOf(_dir.x, _dir.z);
    const cx = W / 2, cy = H * 0.6;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = MAP_COLORS.water;
    g.fillRect(0, 0, W, H);
    g.save();
    g.translate(cx, cy);
    g.rotate(-heading);
    // cached city layer
    const lx = this.layerCx - LAYER_M / 2, lz = this.layerCz - LAYER_M / 2;
    g.drawImage(this.layer, (lx - px) * scale, (lz - pz) * scale, LAYER_M * scale, LAYER_M * scale);

    // safe zone
    const sz = st.safeZone;
    if (sz) {
      const sx = (sz.x - px) * scale, sy = (sz.z - pz) * scale, r = sz.radius * scale;
      if (Math.hypot(sx, sy) < r + 260) {
        g.beginPath();
        g.arc(sx, sy, r, 0, Math.PI * 2);
        g.fillStyle = 'rgba(92,178,255,0.2)';
        g.fill();
        g.lineWidth = 1;
        g.strokeStyle = 'rgba(120,190,255,0.8)';
        g.stroke();
      }
    }
    // pickups
    for (const pk of st.pickups.values()) {
      const sx = (pk.x - px) * scale, sy = (pk.z - pz) * scale;
      if (sx * sx + sy * sy > 200 * 200) continue;
      g.save();
      g.translate(sx, sy);
      g.rotate(heading); // icons stay upright
      if (pk.kind === 'health') {
        g.fillStyle = '#5fd977';
        g.fillRect(-3.5, -1, 7, 2);
        g.fillRect(-1, -3.5, 2, 7);
      } else if (pk.kind === 'armor') {
        g.fillStyle = '#5cb2ff';
        g.fillRect(-2.5, -2.5, 5, 5);
      } else {
        g.beginPath();
        g.moveTo(0, -3.5);
        g.lineTo(3.5, 0);
        g.lineTo(0, 3.5);
        g.lineTo(-3.5, 0);
        g.closePath();
        g.fillStyle = '#ffffff';
        g.fill();
      }
      g.restore();
    }
    // remote players
    for (const r of st.remotes.values()) {
      const s = r.render;
      const sx = (s.x - px) * scale, sy = (s.z - pz) * scale;
      if (sx * sx + sy * sy > 260 * 260) continue;
      const prot = (s.flags & StateFlag.Protected) !== 0;
      const dead = (s.flags & StateFlag.Dead) !== 0;
      drawDot(g, sx, sy, 3.2, dead ? 'rgba(255,255,255,0.35)' : prot ? '#5cb2ff' : '#ff4b4b');
    }
    g.restore();

    // player arrow (rotated by player heading relative to the camera)
    g.save();
    g.translate(cx, cy);
    const ph = st.screenshotMode ? heading : -st.local.state.yaw;
    g.rotate(ph - heading);
    drawArrow(g, 7, '#ffffff');
    g.restore();

    // street names: along the road, sitting at the frame edge on the side away from the player
    const ca = Math.cos(-heading), sa = Math.sin(-heading);
    g.font = `600 11px ${FONT_HEAD}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    for (const lb of this.labels) {
      const vx = (lb.x - px) * scale, vy = (lb.z - pz) * scale;
      const qx = cx + vx * ca - vy * sa, qy = cy + vx * sa + vy * ca;
      let dx = lb.dx * ca - lb.dz * sa, dy = lb.dx * sa + lb.dz * ca;
      if (dx < 0) {
        dx = -dx;
        dy = -dy;
      } // text reads left to right
      // where the road line crosses the inset frame (slab test)
      const in0 = EDGE + 4;
      let t0 = -Infinity, t1 = Infinity;
      for (const [q, d, lo, hi] of [[qx, dx, in0, W - in0], [qy, dy, in0, H - in0]] as [number, number, number, number][]) {
        if (Math.abs(d) < 1e-6) {
          if (q < lo || q > hi) t1 = -Infinity;
          continue;
        }
        const ta = (lo - q) / d, tb = (hi - q) / d;
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      const text = lb.name.toUpperCase();
      const tw = g.measureText(text).width;
      if (!(t1 - t0 > tw + 16)) continue;
      // the frame end farther from the player marker; pull the text inward by half its width
      const ax = qx + dx * t0, ay = qy + dy * t0, bx = qx + dx * t1, by = qy + dy * t1;
      const useB = Math.hypot(bx - cx, by - cy) >= Math.hypot(ax - cx, ay - cy);
      const pull = tw / 2 + 6;
      const tx = useB ? bx - dx * pull : ax + dx * pull;
      const ty = useB ? by - dy * pull : ay + dy * pull;
      g.save();
      g.translate(tx, ty);
      g.rotate(Math.atan2(dy, dx));
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(8,10,14,0.8)';
      g.strokeText(text, 0, 0);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillText(text, 0, 0);
      g.restore();
    }

    // north: a small pointer on the frame edge where the north ray leaves, the letter just inside it
    const nx = Math.sin(-heading), ny = -Math.cos(-heading);
    const kx = Math.abs(nx) > 1e-6 ? (nx > 0 ? W - EDGE - cx : EDGE - cx) / nx : Infinity;
    const ky = Math.abs(ny) > 1e-6 ? (ny > 0 ? H - EDGE - cy : EDGE - cy) / ny : Infinity;
    const k = Math.min(kx, ky);
    const mx = cx + nx * k, my = cy + ny * k;
    g.save();
    g.translate(mx, my);
    g.rotate(Math.atan2(ny, nx) + Math.PI / 2); // pointer up = outward
    g.beginPath();
    g.moveTo(0, -5);
    g.lineTo(4, 3);
    g.lineTo(-4, 3);
    g.closePath();
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(8,10,14,0.85)';
    g.lineWidth = 1.5;
    g.fill();
    g.stroke();
    g.font = `700 10px ${FONT_HEAD}`;
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(8,10,14,0.8)';
    g.strokeText('N', 0, 11);
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.fillText('N', 0, 11);
    g.restore();

    // subtle vignette edge
    const grad = g.createRadialGradient(cx, cy, Math.min(W, H) * 0.4, cx, cy, Math.max(W, H) * 0.78);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.32)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);
  }

  dispose(): void {
    for (const f of this.off) f();
  }
}
