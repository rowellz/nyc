/**
 * City ambience. Non-positional beds (traffic rumble, the mid "wash" of a thousand tires with slow
 * swells, air, HVAC hum by the buildings, rain, wind with gusts, leaves) plus scheduled positioned
 * events (cars passing on the avenue, distant honks with a real length distribution, sirens that
 * doppler past every minute or two, subway trains under grates, birds in parks, gulls near water,
 * jackhammers by scaffolding, a helicopter now and then, thunder, rain drips, Con Ed steam hiss, and
 * at night the bass from a club or a car stereo a block over).
 * Everything derives from the real world data around the camera: road density, buildings, trees,
 * props, water. `CityBed` is shared with the offline render so the WAV is the live bed.
 */
import * as THREE from 'three';
import type { GameContext } from '@/core/context';
import type { Tile, RoadSegment } from '@shared/world';
import type { Mixer, Voice } from './mixer';
import type { Bank } from './sounds';
import { SirenVoice } from './siren';
import { createPanner, movePanner } from './spatial';
import { type AC, stopSources, disconnectOnEnded, noiseSrc, filter, gain, osc, slew, rnd, pick, clamp, lerp, holdRelease, burst, sweep, rampTo, curve } from './synth';

interface TileIndex {
  subway: { x: number; z: number; station: boolean }[];
  scaffold: { x: number; z: number }[];
  steam: { x: number; z: number }[];
  trees: Float32Array;
  /** [minX, minZ, maxX, maxZ, height] per building */
  buildings: Float32Array;
  water: [number, number, number, number][];
}

const ROAD_WEIGHT: Record<string, number> = { motorway: 3, trunk: 2.5, primary: 2, secondary: 1.5, tertiary: 1, residential: 0.7, service: 0.3 };
const DRIVABLE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential']);

interface Env {
  density: number; // 0..1.5 road density
  trees: number;
  inPark: number; // 0..1
  water: number; // 0..1 proximity
  hvac: number; // 0..1 proximity to a building wall
  subway: { x: number; z: number; station: boolean; d: number } | null;
  scaffold: { x: number; z: number; d: number } | null;
  steam: { x: number; z: number; d: number } | null;
  night: number; // 0..1
}

interface MovingSiren {
  voice: SirenVoice;
  panner: PannerNode;
  send: GainNode;
  x: number;
  z: number;
  vx: number;
  vz: number;
  born: number;
  until: number;
  level: number;
  lastD: number;
}

export interface BedParams {
  density: number;
  night: number;
  inPark: number;
  trees: number;
  hvac: number;
  /** wind 0..1 */
  wind: number;
  precip: number;
}

/**
 * The continuous beds. Nothing in here is static: the rumble and wash breathe on three incommensurate
 * periods plus a random walk, the wind gusts through a target-seeking state machine (fast up, slow
 * down), the wash centre wanders, and cars pass on the avenue as filtered-noise swells that pan across.
 */
export class CityBed {
  readonly out: GainNode;
  private sources: AudioScheduledSourceNode[] = [];
  private rumbleL: GainNode;
  private rumbleR: GainNode;
  private air: GainNode;
  private wash: GainNode;
  private washBp: BiquadFilterNode;
  private rainHi: GainNode;
  private rainLo: GainNode;
  private wind: GainNode;
  private windBp: BiquadFilterNode;
  private trees: GainNode;
  private treeBp: BiquadFilterNode;
  private hvac: GainNode;
  private windWalk = 450;
  private washWalk = 700;
  private rumbleWalk = 0;
  private gust = 0.5;
  private gustTarget = 0.5;
  private nextGust = 0;
  private passes = 0;
  private passSources = new Set<AudioBufferSourceNode>();
  private stopped = false;
  private lastNow = 0;

  constructor(private ac: AC, dest: AudioNode, t0 = ac.currentTime) {
    this.out = gain(ac, 1, dest);
    const out = this.out;
    // traffic rumble: two decorrelated brown noise streams, lowpassed, panned wide
    const mk = (pan: number, offset: number): GainNode => {
      const g = gain(ac, 0);
      const sp = ac.createStereoPanner();
      sp.pan.value = pan;
      g.connect(sp);
      sp.connect(out);
      const lp = filter(ac, 'lowpass', 115, 0.8, 0, g);
      const pk = filter(ac, 'peaking', 60, 1.0, 4, lp);
      this.sources.push(noiseSrc(ac, pk, 'brown', { t0, offset }));
      return g;
    };
    this.rumbleL = mk(-0.55, 0.5);
    this.rumbleR = mk(0.55, 1.7);
    // wash: the mid-band roar of distant tires and engines, wandering centre, slow swells
    this.wash = gain(ac, 0, out);
    const washLp = filter(ac, 'lowpass', 2200, 0.6, 0, this.wash);
    this.washBp = filter(ac, 'bandpass', 700, 0.5, 0, washLp);
    this.sources.push(noiseSrc(ac, this.washBp, 'pink', { t0, offset: 0.9 }));
    // "air": pink noise, band-passed; the hiss of HVAC and the city above
    this.air = gain(ac, 0, out);
    const airBp = filter(ac, 'bandpass', 1400, 0.35, 0, this.air);
    const airHp = filter(ac, 'highpass', 300, 0.7, 0, airBp);
    this.sources.push(noiseSrc(ac, airHp, 'pink', { t0, offset: 0.3 }));
    // HVAC by a wall: 60 Hz mains hum with its harmonics plus the fan whoosh
    this.hvac = gain(ac, 0, out);
    const hvacLp = filter(ac, 'lowpass', 260, 0.8, 0, this.hvac);
    this.sources.push(osc(ac, 'sine', 60, gain(ac, 0.5, hvacLp), t0));
    this.sources.push(osc(ac, 'sine', 120, gain(ac, 0.28, hvacLp), t0));
    this.sources.push(osc(ac, 'sine', 180, gain(ac, 0.1, hvacLp), t0));
    const fanBp = filter(ac, 'bandpass', 330, 1.1, 0, gain(ac, 0.9, this.hvac));
    this.sources.push(noiseSrc(ac, fanBp, 'pink', { t0, offset: 1.3 }));
    const rain = createRainBed(ac, out, t0);
    this.rainHi = rain.hi;
    this.rainLo = rain.lo;
    this.sources.push(...rain.sources);
    // wind: band-passed pink with a wandering center frequency
    this.wind = gain(ac, 0, out);
    this.windBp = filter(ac, 'bandpass', 450, 1.3, 0, this.wind);
    this.sources.push(noiseSrc(ac, this.windBp, 'pink', { t0, offset: 2.1 }));
    // trees: leaves = higher band, gusty, brighter in a gust
    this.trees = gain(ac, 0, out);
    this.treeBp = filter(ac, 'bandpass', 2400, 0.6, 0, this.trees);
    this.sources.push(noiseSrc(ac, this.treeBp, 'pink', { t0, offset: 0.2 }));
  }

  /** call ~10 Hz. t = game time (s) for the slow LFOs, now = audio time */
  set(p: BedParams, now: number, t: number): void {
    if (this.stopped || !Number.isFinite(now) || !Number.isFinite(t)) return;
    p = { density: clamp(p.density, 0, 1.5), night: clamp(p.night, 0, 1), inPark: clamp(p.inPark, 0, 1), trees: clamp(p.trees, 0, 1000), hvac: clamp(p.hvac, 0, 1), wind: clamp(p.wind, 0, 1), precip: clamp(p.precip, 0, 1) };
    const dt = this.lastNow ? clamp(now - this.lastNow, 0, 1) : 0.1;
    this.lastNow = now;
    const day = 1 - p.night;
    const nightLevel = 0.45 + 0.55 * day;
    // slow life: three incommensurate periods plus a random walk
    this.rumbleWalk = clamp(this.rumbleWalk + rnd(-0.03, 0.03), -0.12, 0.12);
    const breathe = 0.86 + 0.08 * Math.sin(t * 0.07) + 0.06 * Math.sin(t * 0.023 + 1.7) + 0.04 * Math.sin(t * 0.171 + 0.4) + this.rumbleWalk;
    const rumble = (0.035 + 0.12 * p.density) * (1 - 0.35 * p.inPark) * nightLevel * breathe;
    slew(this.rumbleL.gain, rumble * (1 + 0.1 * Math.sin(t * 0.11)), now, 0.8);
    slew(this.rumbleR.gain, rumble * (1 - 0.1 * Math.sin(t * 0.11)), now, 0.8);
    const swell = 0.8 + 0.14 * Math.sin(t * 0.113 + 2.1) + 0.1 * Math.sin(t * 0.041) + 0.06 * Math.sin(t * 0.29 + 1);
    slew(this.wash.gain, (0.012 + 0.045 * p.density) * (1 - 0.5 * p.inPark) * (0.35 + 0.65 * day) * swell, now, 0.8);
    this.washWalk = clamp(this.washWalk + rnd(-45, 45), 480, 1100);
    slew(this.washBp.frequency, this.washWalk, now, 1.0);
    slew(this.air.gain, (0.006 + 0.012 * p.density) * (0.6 + 0.4 * day), now, 0.8);
    slew(this.hvac.gain, 0.05 * p.hvac * (0.7 + 0.3 * day), now, 1.2);
    const precip = clamp(p.precip, 0, 1);
    slew(this.rainHi.gain, 0.2 * Math.pow(precip, 0.7), now, 1.0);
    slew(this.rainLo.gain, 0.16 * precip, now, 1.0);
    // gusts: pick a new target every 3-9 s, rise quickly, fall slowly
    const wind01 = clamp(p.wind, 0, 1);
    if (now >= this.nextGust) {
      this.nextGust = now + rnd(3, 9);
      this.gustTarget = Math.random() < 0.3 ? rnd(0.8, 1.3) : rnd(0.25, 0.7);
    }
    const k = this.gustTarget > this.gust ? 1 - Math.exp(-dt / 0.9) : 1 - Math.exp(-dt / 2.8);
    this.gust += (this.gustTarget - this.gust) * k;
    this.windWalk = clamp(this.windWalk + rnd(-40, 40), 220, 750);
    slew(this.windBp.frequency, this.windWalk * (0.8 + 0.4 * this.gust), now, 0.6);
    slew(this.wind.gain, (0.008 + 0.16 * Math.pow(wind01, 1.5)) * this.gust * (1 - 0.3 * p.inPark), now, 0.5);
    const leaves = Math.min(1, p.trees / 14);
    slew(this.trees.gain, 0.11 * leaves * (0.15 + 0.85 * wind01) * this.gust, now, 0.5);
    slew(this.treeBp.frequency, lerp(1900, 3400, clamp(this.gust - 0.3, 0, 1)), now, 0.6);
  }

  get activePasses(): number {
    return this.passes;
  }

  /**
   * A car passing on the avenue: tire hiss (bandpassed pink noise, darker with distance) that swells
   * in slowly, peaks, and falls away faster, panning across; a touch of doppler on the noise pitch.
   */
  passBy(now: number, o: { dist01: number; level: number; fromLeft: boolean; dur?: number } = { dist01: 0.5, level: 0.04, fromLeft: true }): void {
    if (this.stopped || this.passes >= 3 || !Number.isFinite(now)) return;
    now = Math.max(0, now);
    o = { ...o, dist01: clamp(o.dist01, 0, 1), level: clamp(o.level, 0, 1) };
    const ac = this.ac;
    const dur = clamp(o.dur ?? rnd(2.6, 5.2), 0.1, 15);
    const g = gain(ac, 0);
    const sp = ac.createStereoPanner();
    g.connect(sp);
    sp.connect(this.out);
    const from = o.fromLeft ? -0.8 : 0.8;
    sp.pan.setValueAtTime(from, now);
    sp.pan.linearRampToValueAtTime(-from, now + dur);
    const lp = filter(ac, 'lowpass', lerp(3200, 900, o.dist01), 0.6, 0, g);
    const bp = filter(ac, 'bandpass', lerp(1300, 600, o.dist01), 0.7, 0, lp);
    const src = noiseSrc(ac, bp, 'pink', { t0: now, end: now + dur + 0.05, rate: 1.05 });
    src.playbackRate.setValueAtTime(1.05, now);
    src.playbackRate.linearRampToValueAtTime(0.94, now + dur);
    const peakAt = 0.55;
    curve(g.gain, now, dur, (t) => {
      const x = t < peakAt ? Math.pow(t / peakAt, 2.2) : Math.pow(1 - (t - peakAt) / (1 - peakAt), 1.6);
      return o.level * x;
    }, 64);
    this.passes++;
    this.passSources.add(src);
    src.addEventListener('ended', () => { this.passes--; this.passSources.delete(src); }, { once: true });
    disconnectOnEnded(src, [g, sp, lp, bp]);
  }

  stop(fade = 0.1, now = this.ac.currentTime): void {
    if (this.stopped) return;
    this.stopped = true;
    stopSources([...this.sources, ...this.passSources], this.out, fade, now);
    this.sources = [];
  }
}

export class Ambience {
  private ac: AC;
  private tiles = new Map<string, TileIndex>();
  private env: Env = { density: 0.6, trees: 0, inPark: 0, water: 0, hvac: 0, subway: null, scaffold: null, steam: null, night: 0 };
  private nextEnv = 0;
  private started = false;
  private bed: CityBed | null = null;
  private nextBed = 0;
  // schedulers
  private nextHonk = 0;
  private nextPass = 0;
  private nextSiren = 0;
  private nextBird = 0;
  private nextPigeon = 0;
  private nextGull = 0;
  private nextThunder = 0;
  private nextHeli = 0;
  private nextConstruction = 0;
  private nextSubway = 0;
  private nextBass = 0;
  private scheduled = { passes: 0, honks: 0, sirens: 0 };
  private bassUntil = 0;
  private dripAcc = 0;
  private sirens: MovingSiren[] = [];
  private heli: { panner: PannerNode; out: GainNode; x: number; z: number; vx: number; vz: number; until: number; srcs: AudioScheduledSourceNode[] } | null = null;
  private steamVoice: { out: GainNode; panner: PannerNode; src: AudioBufferSourceNode; x: number; z: number } | null = null;
  private jack: Voice | null = null;
  private bass: Voice | null = null;
  private subwayBusy = 0;
  private offs: (() => void)[] = [];
  private tmp = new THREE.Vector3();

  constructor(private ctx: GameContext, private mixer: Mixer, private bank: Bank) {
    this.ac = mixer.ac;
    this.offs.push(ctx.events.on('tileLoaded', (t) => this.indexTile(t)));
    this.offs.push(ctx.events.on('tileUnloaded', (k) => this.tiles.delete(k)));
    for (const t of ctx.world.tiles.values()) this.indexTile(t);
  }

  private indexTile(t: Tile): void {
    const idx: TileIndex = { subway: [], scaffold: [], steam: [], trees: new Float32Array(t.trees.length * 2), buildings: new Float32Array(t.buildings.length * 5), water: [] };
    for (const p of t.props) {
      if (p.kind === 'subway_grate') idx.subway.push({ x: p.x, z: p.z, station: false });
      else if (p.kind === 'subway_entrance') idx.subway.push({ x: p.x, z: p.z, station: true });
      else if (p.kind === 'scaffolding') idx.scaffold.push({ x: p.x, z: p.z });
      else if (p.kind === 'con_ed_stack') idx.steam.push({ x: p.x, z: p.z });
    }
    for (let i = 0; i < t.trees.length; i++) {
      idx.trees[i * 2] = t.trees[i].x;
      idx.trees[i * 2 + 1] = t.trees[i].z;
    }
    let nb = 0;
    for (const b of t.buildings) {
      const ring = b.footprint?.[0];
      if (!ring || ring.length < 3) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      idx.buildings[nb * 5] = minX;
      idx.buildings[nb * 5 + 1] = minZ;
      idx.buildings[nb * 5 + 2] = maxX;
      idx.buildings[nb * 5 + 3] = maxZ;
      idx.buildings[nb * 5 + 4] = b.height;
      nb++;
    }
    idx.buildings = idx.buildings.subarray(0, nb * 5);
    for (const poly of t.water) {
      const ring = poly[0];
      if (!ring || ring.length < 3) continue;
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (const [x, z] of ring) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      if (maxX - minX > 15 && maxZ - minZ > 15) idx.water.push([minX, minZ, maxX, maxZ]);
    }
    this.tiles.set(t.key, idx);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const now = this.ac.currentTime;
    this.bed = new CityBed(this.ac, this.mixer.exteriorAmb, now);
    this.updateBeds(now, 0); // audible even before the next game frame
    this.nextHonk = now + rnd(2, 6);
    this.nextPass = now + rnd(1, 3);
    this.nextSiren = now + rnd(15, 60);
    this.nextHeli = now + rnd(180, 420);
    this.nextThunder = now + rnd(3, 10);
    this.nextBird = now + rnd(1, 3);
    this.nextPigeon = now + rnd(4, 10);
    this.nextGull = now + rnd(3, 10);
    this.nextConstruction = now + rnd(15, 40);
    this.nextSubway = now + rnd(10, 40);
    this.nextBass = now + rnd(20, 90);
  }

  // ------------------------------------------------------------------------------------------
  private sampleEnv(): void {
    const ctx = this.ctx;
    const cam = ctx.camera.position;
    const cx = cam.x, cz = cam.z;
    const env = this.env;
    // road density
    let w = 0;
    let roads: RoadSegment[] = [];
    try {
      roads = ctx.world.roadsNear(cx, cz, 150);
    } catch {
      /* streamer not ready */
    }
    for (const r of roads) {
      if (r.tunnel) continue;
      w += ROAD_WEIGHT[r.cls] ?? 0;
    }
    env.density = clamp(w / 22, 0.15, 1.5);
    // trees within 45 m, nearest features
    let trees = 0;
    let subway: Env['subway'] = null, scaffold: Env['scaffold'] = null, steam: Env['steam'] = null;
    let waterD = Infinity;
    let wallD = Infinity, wallH = 0;
    for (const [key, idx] of this.tiles) {
      const tile = ctx.world.tiles.get(key);
      if (!tile) continue;
      const tcx = (tile.tx + 0.5) * 256, tcz = (tile.tz + 0.5) * 256;
      if (Math.abs(tcx - cx) > 400 || Math.abs(tcz - cz) > 400) continue;
      const tr = idx.trees;
      for (let i = 0; i < tr.length; i += 2) {
        const dx = tr[i] - cx, dz = tr[i + 1] - cz;
        if (dx * dx + dz * dz < 45 * 45) trees++;
      }
      const bb = idx.buildings;
      for (let i = 0; i < bb.length; i += 5) {
        const dx = Math.max(bb[i] - cx, 0, cx - bb[i + 2]), dz = Math.max(bb[i + 1] - cz, 0, cz - bb[i + 3]);
        const d = Math.hypot(dx, dz);
        if (d < wallD) {
          wallD = d;
          wallH = bb[i + 4];
        }
      }
      for (const s of idx.subway) {
        const d = Math.hypot(s.x - cx, s.z - cz);
        if (d < 40 && (!subway || d < subway.d)) subway = { ...s, d };
      }
      for (const s of idx.scaffold) {
        const d = Math.hypot(s.x - cx, s.z - cz);
        if (d < 45 && (!scaffold || d < scaffold.d)) scaffold = { ...s, d };
      }
      for (const s of idx.steam) {
        const d = Math.hypot(s.x - cx, s.z - cz);
        if (d < 30 && (!steam || d < steam.d)) steam = { ...s, d };
      }
      for (const [minX, minZ, maxX, maxZ] of idx.water) {
        const dx = Math.max(minX - cx, 0, cx - maxX), dz = Math.max(minZ - cz, 0, cz - maxZ);
        const d = Math.hypot(dx, dz);
        if (d < waterD) waterD = d;
      }
    }
    // open water (tiles missing from the index) around us
    if (ctx.world.isWater) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        for (const r of [90, 180]) {
          if (ctx.world.isWater(cx + Math.cos(a) * r, cz + Math.sin(a) * r)) waterD = Math.min(waterD, r);
        }
      }
    }
    env.trees = trees;
    env.water = waterD === Infinity ? 0 : clamp(1 - waterD / 170, 0, 1);
    env.hvac = wallD === Infinity ? 0 : clamp(1 - wallD / 22, 0, 1) * (wallH > 25 ? 1 : 0.65);
    const envMod = ctx.modules.get('environment') as { surfaceAt?: (x: number, z: number) => string | null } | undefined;
    let grass = 0;
    try {
      grass = envMod?.surfaceAt?.(cx, cz) === 'grass' ? 1 : 0;
    } catch {
      /* ignore */
    }
    env.inPark = clamp(Math.max(grass, (trees - 6) / 20), 0, 1);
    env.subway = subway;
    env.scaffold = scaffold;
    env.steam = steam;
    env.night = 1 - clamp(ctx.time.daylight, 0, 1);
  }

  // ------------------------------------------------------------------------------------------
  update(dt: number, t: number): void {
    if (!this.started || !this.bed) return;
    const now = this.ac.currentTime;
    if (t >= this.nextEnv) {
      this.nextEnv = t + 0.5;
      this.sampleEnv();
    }
    if (now >= this.nextBed) {
      this.nextBed = now + 0.1;
      this.updateBeds(now, t);
    }
    const env = this.env;
    const weather = this.ctx.state.weather;
    const cam = this.ctx.camera.position;
    const daylight = 1 - env.night;

    // ---- cars passing on the avenue ----
    if (now >= this.nextPass) {
      const dens = Math.max(0.2, env.density * (1 - 0.7 * env.inPark));
      this.nextPass = now + (rnd(2.5, 7) / dens) * (1 + env.night * 1.2);
      const dist01 = rnd(0.2, 0.9);
      this.scheduled.passes++;
      this.bed.passBy(now, { dist01, level: (0.05 + 0.05 * dens) * (1 - 0.6 * dist01) * (0.5 + 0.5 * daylight) * (1 + 0.6 * weather.wetness), fromLeft: Math.random() < 0.5 });
    }
    // ---- honks ----
    if (now >= this.nextHonk) {
      const dens = Math.max(0.2, env.density * (1 - 0.6 * env.inPark));
      this.nextHonk = now + (rnd(3, 12) / dens) * (1 + env.night * 0.8);
      this.distantHonk(cam.x, cam.z, now);
    }
    // ---- distant sirens ----
    if (now >= this.nextSiren && this.sirens.length < 2) {
      this.nextSiren = now + (env.night > 0.5 ? rnd(30, 80) : rnd(45, 120));
      this.spawnSiren(cam.x, cam.z, now);
    }
    for (let i = this.sirens.length - 1; i >= 0; i--) {
      const s = this.sirens[i];
      s.x += s.vx * dt;
      s.z += s.vz * dt;
      const d = Math.hypot(s.x - cam.x, s.z - cam.z);
      const closing = (s.lastD - d) / Math.max(1e-3, dt);
      s.lastD = d;
      s.voice.setDetune(clamp(1200 * Math.log2(343 / (343 - clamp(closing, -40, 40) * 0.8)), -150, 150), now);
      movePanner(s.panner, s.x, 2, s.z, now, 0.1);
      const life = now - s.born;
      const fade = Math.min(1, life / 4, (s.until - now) / 5);
      s.voice.setLevel(s.level * clamp(fade, 0, 1), now, 0.2);
      s.voice.update(now);
      if (now >= s.until) {
        s.voice.stop(0.5, now, [s.panner, s.send]);
        this.sirens.splice(i, 1);
      }
    }
    // ---- subway ----
    if (env.subway && now >= this.nextSubway && now >= this.subwayBusy) {
      this.nextSubway = now + rnd(45, 100);
      this.subwayBusy = now + 12;
      this.subwayPass(env.subway.x, env.subway.z, env.subway.station, now);
    }
    // ---- birds ----
    if (daylight > 0.25 && env.trees >= 3 && now >= this.nextBird) {
      this.nextBird = now + rnd(1.2, 4.5) * (22 / (env.trees + 6));
      this.bird(cam, now, 'chirp', 0.22);
    }
    if (daylight > 0.3 && env.inPark > 0.3 && now >= this.nextPigeon) {
      this.nextPigeon = now + rnd(5, 15);
      this.bird(cam, now, 'pigeon', 0.3);
    }
    // ---- gulls ----
    if (env.water > 0 && now >= this.nextGull) {
      this.nextGull = now + rnd(8, 25) / Math.max(0.2, env.water);
      const a = rnd(0, Math.PI * 2), r = rnd(40, 120);
      this.mixer.play(this.bank.get('gull'), { bus: 'amb', x: cam.x + Math.cos(a) * r, y: rnd(12, 26), z: cam.z + Math.sin(a) * r, gain: 0.35 * (0.4 + 0.6 * env.water), rate: rnd(0.9, 1.1), refDistance: 25, rolloff: 1, priority: -1 });
    }
    // ---- thunder ----
    if (weather.condition === 'thunder' && now >= this.nextThunder) {
      this.nextThunder = now + rnd(12, 45);
      this.thunder(now);
    }
    // ---- helicopter ----
    if (now >= this.nextHeli && !this.heli) {
      this.nextHeli = now + rnd(240, 540);
      this.heliPass(cam.x, cam.z, now);
    }
    if (this.heli) this.updateHeli(dt, now);
    // ---- construction ----
    if (env.scaffold && daylight > 0.35 && now >= this.nextConstruction) {
      this.nextConstruction = now + rnd(30, 80);
      if (Math.random() < 0.45 && !this.jack) this.jackhammer(env.scaffold.x, env.scaffold.z, now);
    }
    if (this.jack && !this.jack.alive) this.jack = null;
    // ---- night: a distant bass thump a block over, for a while ----
    if (this.bass && (!this.bass.alive || now >= this.bassUntil || env.night < 0.4)) {
      this.bass.stop(3);
      this.bass = null;
    }
    if (!this.bass && env.night > 0.6 && env.inPark < 0.5 && now >= this.nextBass) {
      this.nextBass = now + rnd(90, 240);
      const a = rnd(0, Math.PI * 2), r = rnd(55, 110);
      const v = this.mixer.play(this.bank.get('bass_loop'), { bus: 'amb', x: cam.x + Math.cos(a) * r, y: 1, z: cam.z + Math.sin(a) * r, gain: rnd(0.35, 0.6), loop: true, fadeIn: 2.5, lowpass: 150, refDistance: 40, rolloff: 1, maxDistance: 500, priority: -2 });
      if (v) {
        this.bass = v;
        this.bassUntil = now + rnd(25, 60);
      }
    }
    // ---- steam ----
    this.updateSteam(env, now);
    // ---- rain drips ----
    if (weather.precip > 0.02 && !this.mixer.inside) {
      this.dripAcc += dt * (1.5 + 10 * weather.precip);
      this.dripAcc = Math.min(this.dripAcc, 4); // bound catch-up after a stalled frame
      while (this.dripAcc >= 1) {
        this.dripAcc -= 1;
        const a = rnd(0, Math.PI * 2), r = rnd(2.5, 9);
        this.mixer.play(this.bank.get('drip'), { bus: 'amb', x: cam.x + Math.cos(a) * r, y: rnd(0.2, 3), z: cam.z + Math.sin(a) * r, gain: rnd(0.05, 0.16) * Math.sqrt(weather.precip), rate: rnd(0.8, 1.25), refDistance: 2, priority: -2 });
      }
    }
  }

  private updateBeds(now: number, t: number): void {
    const env = this.env;
    const w = this.ctx.state.weather;
    this.bed?.set({ density: env.density, night: env.night, inPark: env.inPark, trees: env.trees, hvac: env.hvac, wind: clamp((w.wind - 1) / 10, 0, 1), precip: w.precip }, now, t);
  }

  // ------------------------------------------------------------------------------------------
  private distantHonk(cx: number, cz: number, now: number): void {
    let roads: RoadSegment[] = [];
    try {
      roads = this.ctx.world.roadsNear(cx, cz, 230).filter((r) => DRIVABLE.has(r.cls) && !r.tunnel && r.pts.length > 1);
    } catch {
      /* ignore */
    }
    let x: number, z: number;
    if (roads.length) {
      const r = pick(roads);
      const i = Math.floor(rnd(0, r.pts.length - 1));
      const tt = Math.random();
      x = lerp(r.pts[i][0], r.pts[i + 1][0], tt);
      z = lerp(r.pts[i][1], r.pts[i + 1][1], tt);
      const d = Math.hypot(x - cx, z - cz);
      if (d < 35) {
        // too close for a "distant" honk: push it out along the same bearing
        const k = 35 / Math.max(1, d);
        x = cx + (x - cx) * k;
        z = cz + (z - cz) * k;
      }
    } else {
      const a = rnd(0, Math.PI * 2), d = rnd(50, 200);
      x = cx + Math.cos(a) * d;
      z = cz + Math.sin(a) * d;
    }
    const style = Math.random() < 0.55 ? 'sedan' : Math.random() < 0.7 ? 'taxi' : 'truck';
    const d = Math.hypot(x - cx, z - cz);
    this.scheduled.honks++;
    honkPhrase(this.ac, this.mixer.exteriorAmb, now, { x, z, style, dist: d, verb: this.mixer.verbFarSend });
  }

  private spawnSiren(cx: number, cz: number, now: number): void {
    // a straight run along an avenue that passes us at 50-150 m: starts ~350 m out, dopplers past,
    // fades away ~700 m later
    const a = rnd(0, Math.PI * 2);
    const pass = rnd(50, 150);
    const sp = rnd(14, 22);
    const px = cx + Math.cos(a) * pass, pz = cz + Math.sin(a) * pass; // closest-approach point
    const dir = a + Math.PI / 2 + (Math.random() < 0.5 ? 0 : Math.PI);
    const back = 350;
    const x = px - Math.cos(dir) * back, z = pz - Math.sin(dir) * back;
    const panner = createPanner(this.ac, this.mixer.exteriorAmb, { ref: 45, rolloff: 1, max: 900, x, y: 2, z });
    const send = gain(this.ac, 0.35, this.mixer.verbFarSend);
    panner.connect(send);
    const voice = new SirenVoice(this.ac, panner, { level: 0, distant: true, t0: now });
    const dur = (back * 2) / sp;
    this.scheduled.sirens++;
    this.sirens.push({ voice, panner, send, x, z, vx: Math.cos(dir) * sp, vz: Math.sin(dir) * sp, born: now, until: now + dur, level: rnd(0.5, 0.8), lastD: Math.hypot(x - cx, z - cz) });
  }

  private bird(cam: THREE.Vector3, now: number, name: string, g: number): void {
    // at a real tree near us if we know one, otherwise a random spot
    let bx = cam.x + rnd(-25, 25), bz = cam.z + rnd(-25, 25);
    const tile = this.ctx.world.tileAt(cam.x, cam.z);
    if (tile && tile.trees.length) {
      for (let tries = 0; tries < 6; tries++) {
        const tr = pick(tile.trees);
        if (Math.hypot(tr.x - cam.x, tr.z - cam.z) < 50) {
          bx = tr.x;
          bz = tr.z;
          break;
        }
      }
    }
    this.mixer.play(this.bank.get(name), { bus: 'amb', x: bx, y: name === 'pigeon' ? 1.2 : rnd(3, 7), z: bz, gain: g * rnd(0.7, 1.1), rate: rnd(0.93, 1.08), refDistance: 6, rolloff: 1.2, hrtf: true, priority: -1 });
  }

  private subwayPass(x: number, z: number, station: boolean, now: number): void {
    subwayPass(this.ac, this.mixer.exteriorAmb, x, z, station, now);
  }

  private thunder(now: number): void {
    thunder(this.ac, this.mixer.exteriorAmb, now);
  }

  private heliPass(cx: number, cz: number, now: number): void {
    const ac = this.ac;
    const a = rnd(0, Math.PI * 2);
    const r = 1100;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    const ta = a + Math.PI + rnd(-0.35, 0.35); // toward us, passing to one side
    const sp = 48;
    const panner = createPanner(ac, this.mixer.exteriorAmb, { ref: 90, rolloff: 1, max: 3000, x, y: 160, z });
    const out = gain(ac, 0, panner);
    const srcs: AudioScheduledSourceNode[] = [];
    const pulse = osc(ac, 'square', 13, null, now);
    srcs.push(pulse);
    const off = ac.createConstantSource();
    off.offset.value = 0.55;
    off.start(now);
    srcs.push(off);
    // main rotor thump
    const rotG = gain(ac, 0.9, out);
    const rotAm = gain(ac, 0, rotG);
    pulse.connect(gain(ac, 0.45, rotAm.gain));
    off.connect(rotAm.gain);
    const rotBp = filter(ac, 'bandpass', 170, 1.1, 0, rotAm);
    srcs.push(noiseSrc(ac, rotBp, 'brown', { t0: now }));
    // blade slap (higher, sharper)
    const slapG = gain(ac, 0.35, out);
    const slapAm = gain(ac, 0, slapG);
    pulse.connect(gain(ac, 0.5, slapAm.gain));
    off.connect(slapAm.gain);
    const slapBp = filter(ac, 'bandpass', 800, 2.2, 0, slapAm);
    srcs.push(noiseSrc(ac, slapBp, 'white', { t0: now }));
    // turbine
    const turbLp = filter(ac, 'lowpass', 900, 1, 0, gain(ac, 0.12, out));
    srcs.push(osc(ac, 'sawtooth', 105, turbLp, now));
    srcs.push(osc(ac, 'sine', 1750, gain(ac, 0.02, out), now));
    const dur = (r * 2) / sp;
    disconnectOnEnded(srcs[0], [out, panner]);
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(0.8, now + 6);
    out.gain.setValueAtTime(0.8, now + dur - 6);
    out.gain.linearRampToValueAtTime(0, now + dur);
    for (const s of srcs) s.stop(now + dur + 0.2);
    this.heli = { panner, out, x, z, vx: Math.cos(ta) * sp, vz: Math.sin(ta) * sp, until: now + dur, srcs };
  }

  private updateHeli(dt: number, now: number): void {
    const h = this.heli!;
    h.x += h.vx * dt;
    h.z += h.vz * dt;
    movePanner(h.panner, h.x, 160, h.z, now, 0.15);
    if (now >= h.until) this.heli = null;
  }

  private jackhammer(x: number, z: number, now: number): void {
    const v = this.mixer.play(this.bank.get('jackhammer'), { bus: 'amb', x, y: 0.5, z, gain: 0.55, loop: true, fadeIn: 0.15, refDistance: 8, rolloff: 1.2, priority: -1 });
    if (!v) return;
    this.jack = v;
    const len = rnd(3, 8);
    setTimeout(() => v.stop(0.12), len * 1000);
    void now;
  }

  private updateSteam(env: Env, now: number): void {
    if (env.steam && !this.steamVoice) {
      const ac = this.ac;
      const panner = createPanner(ac, this.mixer.exteriorAmb, { ref: 3, rolloff: 1.4, max: 60, x: env.steam.x, y: 3, z: env.steam.z });
      const out = gain(ac, 0, panner);
      const bp = filter(ac, 'bandpass', 2600, 0.6, 0, out);
      const src = noiseSrc(ac, bp, 'white', { t0: now });
      out.gain.setValueAtTime(0, now);
      out.gain.linearRampToValueAtTime(0.14, now + 1.5);
      disconnectOnEnded(src, [out, panner, bp]);
      this.steamVoice = { out, panner, src, x: env.steam.x, z: env.steam.z };
    } else if (this.steamVoice && (!env.steam || env.steam.x !== this.steamVoice.x || env.steam.z !== this.steamVoice.z)) {
      const sv = this.steamVoice;
      this.steamVoice = null;
      rampTo(sv.out.gain, 0, now, 1.0);
      sv.src.stop(now + 1.2);
    }
  }

  /** for the debug overlay / tests */
  debug(): Record<string, unknown> {
    return { ...this.env, scheduled: { ...this.scheduled }, sirens: this.sirens.length, heli: !!this.heli, steam: !!this.steamVoice, jack: !!this.jack, bass: !!this.bass, passes: this.bed?.activePasses ?? 0 };
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.started = false;
    this.bed?.stop(0.1);
    this.bed = null;
    this.jack?.stop(0.1);
    this.jack = null;
    this.bass?.stop(0.1);
    this.bass = null;
    if (this.heli) stopSources(this.heli.srcs, this.heli.out, 0.1, this.ac.currentTime, [this.heli.panner]);
    this.heli = null;
    if (this.steamVoice) stopSources([this.steamVoice.src], this.steamVoice.out, 0.1, this.ac.currentTime, [this.steamVoice.panner]);
    this.steamVoice = null;
    for (const s of this.sirens) s.voice.stop(0.1, this.ac.currentTime, [s.panner, s.send]);
    this.tiles.clear();
    this.sirens.length = 0;
  }
}

// ------------------------------------------------------------------------------------------
// Live car horn (used by ambience for distant honks and by traffic for nearby cars)
// ------------------------------------------------------------------------------------------
export interface HonkOpts {
  x: number;
  z: number;
  style: 'sedan' | 'taxi' | 'truck';
  dur: number;
  dist: number;
  /** already-positioned destination (traffic voices pass their panner); otherwise a panner is created */
  panner?: PannerNode;
  level?: number;
  /** reverb send node (the far street convolver) for the Manhattan slap on distant horns */
  verb?: AudioNode;
}

/**
 * A diaphragm horn: two tones (a ~minor third apart on cars, closer on trucks) through a nasal
 * resonance. The pitch scoops up for the first 30 ms as the diaphragm gets going and sags ~5 % in the
 * last 40 ms as the relay lets go; the attack is ~15 ms, the release ~60 ms.
 */
export function honk(ac: AC, dest: AudioNode, t0: number, o: HonkOpts): void {
  if (!Number.isFinite(t0)) return;
  t0 = Math.max(0, t0);
  o = { ...o, dur: clamp(o.dur, 0.04, 10), dist: clamp(o.dist, 0, 10000), level: clamp(o.level ?? (o.style === 'truck' ? 0.6 : 0.42), 0, 4) };
  const panner = o.panner ?? createPanner(ac, dest, { ref: 9, rolloff: 1, max: 600, x: o.x, y: 1, z: o.z });
  const g = gain(ac, 0, panner);
  // distance: air absorption
  const lp = filter(ac, 'lowpass', clamp(9000 * (25 / (25 + o.dist)), 700, 9000), 0.5, 0, g);
  const bp2 = filter(ac, 'peaking', 2400, 1.6, 3, lp);
  const bp = filter(ac, 'peaking', 1150, 1.0, 7, bp2);
  const f1 = o.style === 'truck' ? rnd(190, 240) : o.style === 'taxi' ? rnd(470, 540) : rnd(370, 460);
  const f2 = f1 * (o.style === 'truck' ? 1.19 : rnd(1.22, 1.27));
  const type: OscillatorType = o.style === 'truck' ? 'square' : 'sawtooth';
  const end = t0 + o.dur + 0.1;
  const oa = osc(ac, type, f1, gain(ac, 0.5, bp), t0, end);
  const ob = osc(ac, type, f2, gain(ac, 0.45, bp), t0, end);
  for (const [os, f] of [[oa, f1], [ob, f2]] as [OscillatorNode, number][]) {
    os.frequency.setValueAtTime(f * 0.955, t0);
    os.frequency.exponentialRampToValueAtTime(f, t0 + 0.03);
    os.frequency.setValueAtTime(f, t0 + Math.max(0.03, o.dur - 0.01));
    os.frequency.exponentialRampToValueAtTime(f * 0.95, t0 + o.dur + 0.05);
  }
  let send: GainNode | null = null;
  if (o.verb) {
    send = gain(ac, clamp(0.12 + o.dist / 250, 0.12, 0.6), o.verb);
    panner.connect(send);
  }
  if (send) ob.addEventListener('ended', () => { panner.disconnect(send!); }, { once: true });
  disconnectOnEnded(ob, [g, lp, bp, bp2, ...(o.panner ? [] : [panner]), ...(send ? [send] : [])]);
  holdRelease(g.gain, t0, o.dur + 0.05, o.level ?? (o.style === 'truck' ? 0.6 : 0.42), 0.015, 0.06);
}

/**
 * A honk *phrase* with the length distribution you hear from a Manhattan window: mostly short taps
 * (0.08-0.3 s), often doubled ("beep-beep"), sometimes tripled, and now and then the long lean on the
 * horn (1-3 s) from someone boxed in.
 */
export function honkPhrase(ac: AC, dest: AudioNode, t0: number, o: Omit<HonkOpts, 'dur'>, phrase?: 'tap' | 'double' | 'triple' | 'lean'): void {
  const r = phrase ? { tap: 0, double: 0.5, triple: 0.8, lean: 0.95 }[phrase] : Math.random();
  const tap = (): number => rnd(0.08, 0.3);
  if (r < 0.42) honk(ac, dest, t0, { ...o, dur: tap() });
  else if (r < 0.77) {
    const d1 = rnd(0.08, 0.18);
    honk(ac, dest, t0, { ...o, dur: d1 });
    honk(ac, dest, t0 + d1 + rnd(0.1, 0.2), { ...o, dur: rnd(0.1, 0.28) });
  } else if (r < 0.9) {
    let t = t0;
    for (let i = 0; i < 3; i++) {
      const d = rnd(0.07, 0.16);
      honk(ac, dest, t, { ...o, dur: d });
      t += d + rnd(0.09, 0.16);
    }
  } else honk(ac, dest, t0, { ...o, dur: rnd(1.0, 3.0) });
}

// ------------------------------------------------------------------------------------------
// Standalone event synths (also rendered offline by window.__audio.render)
// ------------------------------------------------------------------------------------------
/**
 * A train under a grate: the roar swells in and out over ~10 s (brown rumble below 110 Hz plus a
 * mid roar around 350 Hz), rail-joint clacks come in "da-dum" pairs every 12 m of rail (1.3-2.2 Hz at
 * speed, slowing into a station), air is pushed up through the grate, and flanges squeal on the curve
 * into a station.
 */
export function subwayPass(ac: AC, dest: AudioNode, x: number, z: number, station: boolean, now: number): void {
  const panner = createPanner(ac, dest, { ref: 7, rolloff: 1.1, max: 120, x, y: -2, z });
  const out = gain(ac, 1, panner);
  const dur = 10;
  const end = now + dur + 0.5;
  const swell = [0, 0.15, 0.45, 0.8, 0.95, 0.9, 0.7, 0.4, 0.15, 0.04, 0];
  const swellAt = (t: number): number => {
    const k = clamp(t / dur, 0, 1) * (swell.length - 1);
    const i = Math.floor(k);
    return lerp(swell[i], swell[Math.min(swell.length - 1, i + 1)], k - i);
  };
  // rumble swell
  const rg = gain(ac, 0, out);
  const rlp = filter(ac, 'lowpass', 110, 0.9, 0, rg);
  noiseSrc(ac, rlp, 'brown', { t0: now, end });
  rg.gain.setValueCurveAtTime(new Float32Array(swell), now, dur);
  // mid roar (wheels on rail, the tunnel)
  const mg = gain(ac, 0, out);
  const mbp = filter(ac, 'bandpass', 350, 0.8, 0, mg);
  noiseSrc(ac, mbp, 'pink', { t0: now, end });
  mg.gain.setValueCurveAtTime(new Float32Array(swell.map((v) => v * 0.28)), now, dur);
  // rail-joint clacks: da-dum pairs, rate follows the train (slows into a station)
  let t = 0.4;
  let n = 0;
  while (t < dur - 0.3 && n < 18) {
    const speed01 = station ? clamp(1 - Math.max(0, t - 4.5) / 4, 0.25, 1) : 1;
    const a = swellAt(t) * 0.55;
    for (const off of [0, 0.09]) {
      const tt = now + t + off;
      burst(ac, out, tt, { type: 'bandpass', freq: 300 + rnd(-40, 40), q: 1.4, peak: a * (off ? 0.8 : 1), attack: 0.002, tau: 0.02, dur: 0.07 });
      burst(ac, out, tt, { type: 'highpass', freq: 1500, peak: a * 0.3, attack: 0.001, tau: 0.004, dur: 0.02 });
    }
    t += lerp(0.75, 0.45, speed01) + rnd(-0.03, 0.03);
    n++;
  }
  // air pushed up through the grate
  burst(ac, out, now + 2, { kind: 'pink', type: 'bandpass', freq: 520, q: 0.5, peak: 0.22, attack: 2.2, tau: 1.6, dur: 6 });
  // brake / flange screech pulling into the station
  const off = ac.createConstantSource();
  off.offset.value = 0;
  off.start(now);
  off.stop(end);
  if (station) {
    for (let i = 0; i < 2; i++) {
      const st = now + 4.5 + i * 1.6 + rnd(0, 0.4);
      burst(ac, out, st, { type: 'bandpass', freq: 2600 + rnd(0, 800), freqTo: 3900, q: 24, peak: 0.13, attack: 0.15, tau: 0.5, dur: 1.4 });
    }
  }
  disconnectOnEnded(off, [out, panner]);
  void sweep;
}


export function thunder(ac: AC, dest: AudioNode, now: number, forceDist?: number): void {
  const near = forceDist !== undefined ? forceDist < 0.45 : Math.random() < 0.3;
  const dist01 = forceDist ?? (near ? rnd(0.1, 0.4) : rnd(0.5, 1));
  const sp = ac.createStereoPanner();
  sp.pan.value = rnd(-0.7, 0.7);
  sp.connect(dest);
  const dur = lerp(4, 9, dist01);
  const t0 = now + (near ? 0.05 : rnd(0.2, 1.2));
  const g = gain(ac, 0, sp);
  const lp = filter(ac, 'lowpass', lerp(220, 70, dist01), 0.7, 0, g);
  const tail = noiseSrc(ac, lp, 'brown', { t0, end: t0 + dur + 0.2 });
  disconnectOnEnded(tail, [g, lp, sp]);
  // rolling: a few overlapping swells
  const n = 3 + Math.floor(rnd(0, 3));
  const pts = new Float32Array(48);
  for (let i = 0; i < pts.length; i++) {
    const tt = i / (pts.length - 1);
    let v = Math.exp(-tt * lerp(2.2, 1.2, dist01));
    for (let k = 1; k <= n; k++) v *= 0.75 + 0.25 * Math.sin(tt * (5 + k * 3.7) + k * 1.3);
    pts[i] = v * lerp(1.1, 0.55, dist01) * Math.min(1, tt / lerp(0.03, 0.12, dist01));
  }
  pts[0] = 0;
  pts[pts.length - 1] = 0;
  g.gain.setValueCurveAtTime(pts, t0, dur);
  if (near) {
    // the crack
    burst(ac, sp, t0, { type: 'highpass', freq: 700, peak: 0.9, attack: 0.002, tau: 0.08, dur: 0.5 });
    burst(ac, sp, t0, { type: 'bandpass', freq: 300, q: 0.6, peak: 0.9, attack: 0.004, tau: 0.2, dur: 0.9 });
  }
}



/** The same rain layers are used by the weather bed and offline verification. */
export function createRainBed(ac: AC, dest: AudioNode, t0 = ac.currentTime): { hi: GainNode; lo: GainNode; sources: AudioBufferSourceNode[] } {
  const hi = gain(ac, 0, dest);
  const lo = gain(ac, 0, dest);
  const bp = filter(ac, 'bandpass', 3200, 0.45, 0, hi);
  const lp = filter(ac, 'lowpass', 420, 0.6, 0, lo);
  const sources = [noiseSrc(ac, bp, 'pink', { t0 }), noiseSrc(ac, lp, 'brown', { t0 })];
  disconnectOnEnded(sources[0], [bp, hi]);
  disconnectOnEnded(sources[1], [lp, lo]);
  return { hi, lo, sources };
}
