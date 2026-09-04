/**
 * Full map (M): the whole indexed world drawn into one offscreen canvas at 0.5 px/m, filled progressively.
 * Tiles already streamed by core are drawn straight from ctx.world.tiles; the rest are fetched with the
 * same gzip/JSON decoder the streamer uses (3 in flight, nearest to the player first) only while the map
 * is open, and never retained after being drawn. Pan (drag) / zoom (wheel); Esc or M closes.
 */
import * as THREE from 'three';
import { isIOS } from '@/core/quality';
import { TILE_SIZE, tileKey } from '@shared/geo';
import { LANDMARKS } from '@shared/constants';
import { StateFlag } from '@shared/protocol';
import type { Tile } from '@shared/world';
import type { GameContext } from '@/core/context';
import { fetchAndDecode } from '@/core/streamer.worker';
import { FONT_BODY, FONT_HEAD } from './styles';
import { MAP_COLORS, drawArrow, drawDot, drawTile, headingOf } from './mapDraw';

const BASE = 0.5; // px per meter in the offscreen canvas
const IN_FLIGHT = 3;
const _dir = new THREE.Vector3();

export class FullMap {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private off: HTMLCanvasElement | null = null;
  private og: CanvasRenderingContext2D | null = null;
  private minTx = 0;
  private minTz = 0;
  private done = new Set<string>();
  private queue: string[] = [];
  private inFlight = 0;
  private total = 0;
  private open = false;
  private zoom = 1;
  private cx = 0;
  private cz = 0;
  private drag: { x: number; y: number; cx: number; cz: number } | null = null;
  private raf = 0;
  private lastDraw = 0;
  private status: HTMLElement;
  private dirty = true;
  private disposers: (() => void)[] = [];
  onClose: (() => void) | null = null;

  constructor(private ctx: GameContext, private baseUrl: string) {
    this.el = document.createElement('div');
    this.el.className = 'screen map ia hidden';
    this.canvas = document.createElement('canvas');
    this.g = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    this.el.appendChild(this.canvas);
    const head = document.createElement('div');
    head.className = 'map-head';
    head.innerHTML = `<div class="t">Manhattan</div><div class="s">New York · present day</div>`;
    this.el.appendChild(head);
    const legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = `<div><i style="background:#fff"></i>You</div><div><i style="background:#ff4b4b"></i>Players</div><div><i style="background:#5cb2ff"></i>Safe zone</div><div><i style="background:#ffbe3d"></i>Landmarks</div>`;
    this.el.appendChild(legend);
    const foot = document.createElement('div');
    foot.className = 'map-foot';
    this.status = document.createElement('span');
    foot.appendChild(this.status);
    const keys = document.createElement('span');
    keys.innerHTML = `<b>Drag</b> pan &nbsp; <b>Wheel</b> zoom &nbsp; <b>M</b> / <b>Esc</b> close`;
    foot.appendChild(keys);
    this.el.appendChild(foot);

    const add = <K extends keyof HTMLElementEventMap>(ev: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      this.el.addEventListener(ev, fn, opts);
      this.disposers.push(() => this.el.removeEventListener(ev, fn, opts));
    };
    add('mousedown', (e) => {
      if (e.button !== 0) return;
      this.drag = { x: e.clientX, y: e.clientY, cx: this.cx, cz: this.cz };
      this.el.classList.add('drag');
      e.preventDefault();
    });
    add('mousemove', (e) => {
      if (!this.drag) return;
      const k = 1 / (BASE * this.zoom);
      this.cx = this.drag.cx - (e.clientX - this.drag.x) * k;
      this.cz = this.drag.cz - (e.clientY - this.drag.y) * k;
      this.dirty = true;
    });
    const endDrag = () => {
      this.drag = null;
      this.el.classList.remove('drag');
    };
    add('mouseup', endDrag);
    add('mouseleave', endDrag);
    add(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - rect.width / 2;
        const my = e.clientY - rect.top - rect.height / 2;
        const before = BASE * this.zoom;
        const wx = this.cx + mx / before, wz = this.cz + my / before;
        this.zoom = Math.max(0.18, Math.min(6, this.zoom * Math.exp(-e.deltaY * 0.0016)));
        const after = BASE * this.zoom;
        this.cx = wx - mx / after;
        this.cz = wz - my / after;
        this.dirty = true;
      },
      { passive: false },
    );
    add('dblclick', () => {
      this.zoom = Math.min(6, this.zoom * 1.8);
      this.dirty = true;
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  private ensureOffscreen(): boolean {
    if (this.off) return true;
    const idx = this.ctx.world.index;
    if (!idx) return false;
    const p = this.ctx.state.local.state;
    const tx = Math.floor(p.x / TILE_SIZE), tz = Math.floor(p.z / TILE_SIZE);
    const b = isIOS() ? { minTx: tx - 1, maxTx: tx + 1, minTz: tz - 1, maxTz: tz + 1 } : idx.bounds;
    this.minTx = b.minTx;
    this.minTz = b.minTz;
    const w = (b.maxTx - b.minTx + 1) * TILE_SIZE * BASE;
    const h = (b.maxTz - b.minTz + 1) * TILE_SIZE * BASE;
    this.off = document.createElement('canvas');
    this.off.width = Math.ceil(w);
    this.off.height = Math.ceil(h);
    this.og = this.off.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    this.og.fillStyle = MAP_COLORS.water;
    this.og.fillRect(0, 0, this.off.width, this.off.height);
    // land for every indexed tile up front, so tile fills never overdraw a neighbour's edge (no seams)
    this.og.fillStyle = MAP_COLORS.land;
    for (const key of isIOS() ? this.ctx.world.tiles.keys() : idx.tiles) {
      const [tx, tz] = key.split('_').map(Number);
      this.og.fillRect((tx - b.minTx) * TILE_SIZE * BASE, (tz - b.minTz) * TILE_SIZE * BASE, TILE_SIZE * BASE + 0.5, TILE_SIZE * BASE + 0.5);
    }
    this.total = isIOS() ? this.ctx.world.tiles.size : idx.tiles.length;
    return true;
  }

  private paint(tile: Tile): void {
    if (!this.og || this.done.has(tile.key)) return;
    drawTile(this.og, tile, BASE, this.minTx * TILE_SIZE, this.minTz * TILE_SIZE, true, true);
    this.done.add(tile.key);
    this.dirty = true;
  }

  private planFetches(): void {
    const idx = this.ctx.world.index;
    if (!idx) return;
    const p = this.ctx.state.local.state;
    const ptx = p.x / TILE_SIZE, ptz = p.z / TILE_SIZE;
    const todo: { key: string; d: number }[] = [];
    for (const key of isIOS() ? this.ctx.world.tiles.keys() : idx.tiles) {
      if (this.done.has(key)) continue;
      const [tx, tz] = key.split('_').map(Number);
      todo.push({ key, d: (tx + 0.5 - ptx) ** 2 + (tz + 0.5 - ptz) ** 2 });
    }
    todo.sort((a, b) => a.d - b.d);
    this.queue = todo.map((t) => t.key);
  }

  private pump(): void {
    while (this.open && this.inFlight < IN_FLIGHT && this.queue.length) {
      const key = this.queue.shift()!;
      if (this.done.has(key)) continue;
      const loaded = this.ctx.world.tiles.get(key);
      if (loaded) {
        this.paint(loaded);
        continue;
      }
      if (this.ctx.quality.level === 'mobile') continue; // Use resident tiles; one world decode at a time.
      this.inFlight++;
      fetchAndDecode(`${this.baseUrl}/tiles/${key}.json.gz`)
        .then((r) => {
          const tile = r.tile as Tile;
          if (tile && typeof tile.tx === 'number') this.paint(tile);
          else this.done.add(key);
        })
        .catch(() => {
          /* retried next open */
        })
        .finally(() => {
          this.inFlight--;
          this.pump();
        });
    }
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.el.classList.remove('hidden');
    const p = this.ctx.state.screenshotMode ? this.ctx.camera.position : this.ctx.state.local.state;
    this.cx = p.x;
    this.cz = p.z;
    this.zoom = 1;
    this.dirty = true;
    if (this.ensureOffscreen()) {
      for (const t of this.ctx.world.tiles.values()) this.paint(t);
      this.planFetches();
      this.pump();
    }
    const loop = (now: number) => {
      if (!this.open) return;
      this.raf = requestAnimationFrame(loop);
      const stale = now - this.lastDraw > 250;
      if (this.dirty || stale) {
        this.lastDraw = now;
        this.dirty = false;
        this.draw();
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    cancelAnimationFrame(this.raf);
    this.el.classList.add('hidden');
    this.queue.length = 0;
    if (isIOS()) {
      if (this.off) this.off.width = this.off.height = 1;
      this.off = null; this.og = null; this.done.clear();
    }
    this.onClose?.();
  }

  private draw(): void {
    const dpr = isIOS() ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const W = this.el.clientWidth || window.innerWidth;
    const H = this.el.clientHeight || window.innerHeight;
    if (this.canvas.width !== Math.round(W * dpr) || this.canvas.height !== Math.round(H * dpr)) {
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
    }
    const g = this.g;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = MAP_COLORS.water;
    g.fillRect(0, 0, W, H);
    const k = BASE * this.zoom; // screen px per meter
    const toX = (x: number) => W / 2 + (x - this.cx) * k;
    const toY = (z: number) => H / 2 + (z - this.cz) * k;
    if (this.off) {
      g.imageSmoothingEnabled = this.zoom < 1;
      g.drawImage(this.off, toX(this.minTx * TILE_SIZE), toY(this.minTz * TILE_SIZE), this.off.width * this.zoom, this.off.height * this.zoom);
    } else if (!this.ctx.world.index) {
      // no index yet: draw what is loaded directly
      for (const t of this.ctx.world.tiles.values()) drawTile(g, t, k, this.cx - W / 2 / k, this.cz - H / 2 / k, true);
    }
    const st = this.ctx.state;

    // safe zone
    const sz = st.safeZone;
    g.beginPath();
    g.arc(toX(sz.x), toY(sz.z), sz.radius * k, 0, Math.PI * 2);
    g.fillStyle = 'rgba(92,178,255,0.2)';
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = 'rgba(120,190,255,0.9)';
    g.stroke();
    g.font = `600 11px ${FONT_BODY}`;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    this.label(g, 'SAFE ZONE', toX(sz.x), toY(sz.z) + sz.radius * k + 4, '#9dd0ff');

    // landmarks
    g.font = `500 11px ${FONT_BODY}`;
    for (const lm of LANDMARKS) {
      const x = toX(lm.x), y = toY(lm.z);
      if (x < -60 || y < -20 || x > W + 60 || y > H + 20) continue;
      drawDot(g, x, y, 3.5, '#ffbe3d');
      if (this.zoom >= 0.5) this.label(g, lm.name, x, y + 6, 'rgba(255,255,255,0.85)');
    }

    // remote players
    g.font = `500 11px ${FONT_BODY}`;
    for (const r of st.remotes.values()) {
      const s = r.render;
      const x = toX(s.x), y = toY(s.z);
      if (x < -10 || y < -10 || x > W + 10 || y > H + 10) continue;
      const prot = (s.flags & StateFlag.Protected) !== 0;
      drawDot(g, x, y, 4, prot ? '#5cb2ff' : '#ff4b4b');
      if (this.zoom >= 1.4) this.label(g, r.name, x, y + 6, 'rgba(255,255,255,0.8)');
    }

    // you
    const p = st.screenshotMode ? this.ctx.camera.position : st.local.state;
    this.ctx.camera.getWorldDirection(_dir);
    const ph = st.screenshotMode ? headingOf(_dir.x, _dir.z) : -st.local.state.yaw;
    g.save();
    g.translate(toX(p.x), toY(p.z));
    g.rotate(ph);
    drawArrow(g, 9, '#ffffff');
    g.restore();

    // scale bar
    const meters = niceScale(120 / k);
    const px = meters * k;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(W - 30 - px, H - 46);
    g.lineTo(W - 30, H - 46);
    g.stroke();
    g.font = `600 11px ${FONT_HEAD}`;
    g.textAlign = 'right';
    g.textBaseline = 'bottom';
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(meters >= 1000 ? `${(meters / 1000).toFixed(meters % 1000 ? 1 : 0)} KM` : `${meters} M`, W - 30, H - 50);

    const pending = this.total - this.done.size;
    this.status.textContent = this.total ? (pending > 0 ? `loading map · ${this.done.size} / ${this.total} tiles` : `${this.total} tiles · ${st.remotes.size + 1} players nearby`) : 'no world index';
  }

  private label(g: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineJoin = 'round';
    g.strokeText(text, x, y);
    g.fillStyle = color;
    g.fillText(text, x, y);
  }

  dispose(): void {
    this.hide();
    for (const f of this.disposers) f();
    this.el.remove();
  }
}

function niceScale(m: number): number {
  const steps = [50, 100, 200, 250, 500, 1000, 2000, 5000];
  for (const s of steps) if (s >= m) return s;
  return 5000;
}
