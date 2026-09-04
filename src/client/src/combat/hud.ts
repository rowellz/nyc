/**
 * Combat-owned HUD feedback drawn on one 2D canvas over the game (the ui module owns the crosshair itself):
 *  - hit marker: four ticks flaring from the center (white body hit, red headshot); a kill confirm adds a short
 *    expanding ring and holds a little longer
 *  - floating damage numbers at the victim's head (server-confirmed only): small, clean, one per hit
 *  - damage direction arcs around the center pointing at whoever hit you, fading over ~1.6 s
 *  - low-health blood vignette (CSS radial gradient) that beats with a heartbeat below 30 hp; each beat
 *    dispatches `combat:heartbeat` on window ({ strength }) so audio can follow it, and pulse() exposes the envelope
 *  - a red flash when hit
 * Redraws only while something is animating. Markers / numbers / arcs come from small fixed pools.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';

interface Marker { born: number; kind: 'hit' | 'head' | 'kill' | 'protected' }
interface DmgNum { born: number; value: number; head: boolean; pos: THREE.Vector3; ox: number }
interface Arc { born: number; from: THREE.Vector3; strength: number }

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const MAX_NUMS = 12;
const MAX_ARCS = 8;

export class CombatHud {
  private root: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private vignette: HTMLDivElement;
  private markers: Marker[] = [];
  private nums: DmgNum[] = [];
  private numPool: DmgNum[] = [];
  private arcs: Arc[] = [];
  private arcPool: Arc[] = [];
  private hitFlash = 0;
  private t = 0;
  private lastVig = -1;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private idle = true;
  private beatPhase = 0;
  private beatEnv = 0;
  private beatFired = false;

  constructor(private ctx: GameContext) {
    this.root = document.createElement('div');
    this.root.id = 'combat-hud';
    this.root.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;';
    this.vignette = document.createElement('div');
    this.vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at center, rgba(120,0,0,0) 42%, rgba(110,0,0,0.55) 76%, rgba(60,0,0,0.92) 100%);transition:opacity .08s linear;';
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    this.g = this.canvas.getContext('2d')!;
    this.root.append(this.vignette, this.canvas);
    ctx.uiRoot.appendChild(this.root);
    for (let i = 0; i < MAX_NUMS; i++) this.numPool.push({ born: 0, value: 0, head: false, pos: new THREE.Vector3(), ox: 0 });
    for (let i = 0; i < MAX_ARCS; i++) this.arcPool.push({ born: 0, from: new THREE.Vector3(), strength: 0 });
    this.resize();
    window.addEventListener('resize', this.resize);
  }

  private resize = (): void => {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.idle = false;
  };

  hitMarker(kind: Marker['kind']): void {
    // a kill replaces the hit marker of the same shot instead of stacking on it
    if (kind === 'kill') this.markers = this.markers.filter((m) => this.t - m.born > 0.05);
    this.markers.push({ born: this.t, kind });
    if (this.markers.length > 6) this.markers.shift();
    this.idle = false;
  }

  damageNumber(value: number, head: boolean, worldPos: THREE.Vector3): void {
    if (this.nums.length >= MAX_NUMS) this.numPool.push(this.nums.shift()!);
    const n = this.numPool.pop() ?? { born: 0, value: 0, head: false, pos: new THREE.Vector3(), ox: 0 };
    n.born = this.t;
    n.value = value;
    n.head = head;
    n.pos.copy(worldPos);
    n.ox = (Math.random() - 0.5) * 26;
    this.nums.push(n);
    this.idle = false;
  }

  /** you were hit from `from` (world position of the shooter) */
  damaged(from: THREE.Vector3 | null, amount: number): void {
    if (from) {
      if (this.arcs.length >= MAX_ARCS) this.arcPool.push(this.arcs.shift()!);
      const a = this.arcPool.pop() ?? { born: 0, from: new THREE.Vector3(), strength: 0 };
      a.born = this.t;
      a.from.copy(from);
      a.strength = Math.min(1, 0.4 + amount / 40);
      this.arcs.push(a);
    }
    this.hitFlash = Math.min(1, 0.35 + amount / 60);
    this.idle = false;
  }

  /** 0..1 heartbeat envelope (0 above 30 hp) */
  pulse(): number {
    return this.beatEnv;
  }

  update(t: number): void {
    const dt = this.t > 0 ? Math.min(0.1, t - this.t) : 1 / 60;
    this.t = t;
    const st = this.ctx.state;
    // vignette from health (+ heartbeat + hit flash)
    const hp = st.local.dead ? 0 : st.local.state.health;
    let vig = 0;
    if (hp < 45 && !st.local.dead) {
      const k = 1 - hp / 45;
      if (hp < 30) {
        // lub-dub: a sharp beat then a softer echo, faster the lower the health (60..130 bpm)
        const bpm = 60 + (1 - hp / 30) * 70;
        this.beatPhase += dt * (bpm / 60);
        if (this.beatPhase >= 1) {
          this.beatPhase -= 1;
          this.beatFired = false;
        }
        const ph = this.beatPhase;
        const lub = Math.exp(-ph * 9);
        const dub = ph > 0.3 ? Math.exp(-(ph - 0.3) * 11) * 0.55 : 0;
        this.beatEnv = Math.min(1, (lub + dub) * (0.4 + 0.6 * (1 - hp / 30)));
        if (!this.beatFired && ph < 0.05) {
          this.beatFired = true;
          window.dispatchEvent(new CustomEvent('combat:heartbeat', { detail: { strength: 0.4 + 0.6 * (1 - hp / 30), bpm } }));
        }
      } else {
        this.beatEnv = 0;
        this.beatPhase = 0;
      }
      vig = 0.22 + k * 0.5 + this.beatEnv * 0.25 * k;
    } else {
      this.beatEnv = 0;
      this.beatPhase = 0;
    }
    if (st.local.dead) vig = 0.85;
    vig = Math.min(1, vig + this.hitFlash * 0.8);
    if (Math.abs(vig - this.lastVig) > 0.008) {
      this.vignette.style.opacity = vig.toFixed(3);
      this.lastVig = vig;
    }
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt / 0.35);
      this.idle = false;
    }
    // prune (pooled entries go back to their pools)
    this.markers = this.markers.filter((m) => t - m.born < (m.kind === 'protected' ? 0.85 : m.kind === 'kill' ? 0.55 : 0.32));
    for (let i = this.nums.length - 1; i >= 0; i--) if (t - this.nums[i].born >= 0.9) this.numPool.push(...this.nums.splice(i, 1));
    for (let i = this.arcs.length - 1; i >= 0; i--) if (t - this.arcs[i].born >= 1.6) this.arcPool.push(...this.arcs.splice(i, 1));
    const active = this.markers.length || this.nums.length || this.arcs.length;
    if (!active && this.idle) return;
    this.draw();
    this.idle = !active;
  }

  private draw(): void {
    const g = this.g;
    const dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h / 2;
    const t = this.t;
    const cam = this.ctx.camera;
    // ---- damage arcs
    if (this.arcs.length) {
      cam.getWorldDirection(_f);
      _f.y = 0;
      _f.normalize();
      _r.set(_f.z, 0, -_f.x); // right of forward in xz (x east, z south)
      for (const a of this.arcs) {
        const age = t - a.born;
        const k = a.strength * (age < 0.15 ? age / 0.15 : Math.max(0, 1 - (age - 0.15) / 1.45));
        if (k <= 0) continue;
        _v.subVectors(a.from, cam.position);
        _v.y = 0;
        if (_v.lengthSq() < 1e-4) continue;
        _v.normalize();
        const fwd = _v.dot(_f), rgt = _v.dot(_r);
        const ang = Math.atan2(rgt, fwd); // 0 = ahead, +right
        const screenAng = ang - Math.PI / 2; // canvas: 0 = +x (right), -pi/2 = up
        const radius = Math.min(this.w, this.h) * 0.16;
        const width = 0.55;
        const grad = g.createRadialGradient(cx, cy, radius - 6, cx, cy, radius + 22);
        grad.addColorStop(0, `rgba(255,40,30,0)`);
        grad.addColorStop(0.35, `rgba(255,50,35,${(0.85 * k).toFixed(3)})`);
        grad.addColorStop(1, `rgba(255,40,30,0)`);
        g.beginPath();
        g.arc(cx, cy, radius + 8, screenAng - width, screenAng + width);
        g.lineWidth = 26;
        g.lineCap = 'round';
        g.strokeStyle = grad;
        g.stroke();
        // sharper inner edge
        g.beginPath();
        g.arc(cx, cy, radius - 2, screenAng - width * 0.8, screenAng + width * 0.8);
        g.lineWidth = 3;
        g.strokeStyle = `rgba(255,70,50,${(0.9 * k).toFixed(3)})`;
        g.stroke();
      }
    }
    // ---- hit markers
    for (const m of this.markers) {
      const age = t - m.born;
      const kill = m.kind === 'kill';
      const life = m.kind === 'protected' ? 0.85 : kill ? 0.55 : 0.32;
      const pop = age < 0.08 ? 1 + (1 - age / 0.08) * 0.6 : 1;
      const alpha = age < 0.14 ? 1 : Math.max(0, 1 - (age - 0.14) / (life - 0.14));
      const inner = 6 * pop, outer = (kill ? 20 : 15) * pop;
      const col = m.kind === 'protected' ? `rgba(105,200,255,${alpha})` : m.kind === 'hit' ? `rgba(255,255,255,${alpha})` : m.kind === 'head' ? `rgba(255,80,55,${alpha})` : `rgba(255,45,40,${alpha})`;
      g.strokeStyle = col;
      g.lineWidth = kill ? 3 : 2.2;
      g.lineCap = 'round';
      g.shadowColor = 'rgba(0,0,0,0.8)';
      g.shadowBlur = 3;
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + (k * Math.PI) / 2;
        g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        g.lineTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      }
      g.stroke();
      if (m.kind === 'protected') {
        g.font = '700 14px system-ui';
        g.textAlign = 'center';
        g.fillStyle = `rgba(105,200,255,${alpha})`;
        g.fillText('PROTECTED', cx, cy + 42);
      }
      if (kill) {
        // confirm ring: expands from the marker and fades
        const ring = Math.min(1, age / 0.35);
        g.beginPath();
        g.arc(cx, cy, 14 + ring * 26, 0, Math.PI * 2);
        g.lineWidth = 2;
        g.strokeStyle = `rgba(255,60,50,${(alpha * (1 - ring) * 0.9).toFixed(3)})`;
        g.stroke();
      }
      g.shadowBlur = 0;
    }
    // ---- damage numbers
    if (this.nums.length) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (const n of this.nums) {
        const age = t - n.born;
        _v.copy(n.pos).project(cam);
        if (_v.z > 1 || _v.z < -1) continue;
        const sx = (_v.x * 0.5 + 0.5) * this.w + n.ox;
        const sy = (1 - (_v.y * 0.5 + 0.5)) * this.h - 22 - age * 50;
        const alpha = age < 0.5 ? 1 : Math.max(0, 1 - (age - 0.5) / 0.4);
        const size = (n.head ? 19 : 15) * (age < 0.1 ? 1 + (1 - age / 0.1) * 0.45 : 1);
        g.font = `700 ${size.toFixed(1)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
        g.lineWidth = 3;
        g.lineJoin = 'round';
        g.strokeStyle = `rgba(0,0,0,${(0.85 * alpha).toFixed(3)})`;
        g.strokeText(String(n.value), sx, sy);
        g.fillStyle = n.head ? `rgba(255,95,65,${alpha})` : `rgba(255,240,210,${alpha})`;
        g.fillText(String(n.value), sx, sy);
      }
    }
  }

  dispose(): void {
    window.removeEventListener('resize', this.resize);
    this.root.remove();
  }
}
