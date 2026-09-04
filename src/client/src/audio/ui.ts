/**
 * UI / game-state cues, synthesized live (rare, tonal): pickup chime, hit marker, kill confirm,
 * death sting, discovery jingle (subway "bing-bong" bell timbre), score tick, spawn-protection
 * warning, safe zone enter/exit, update banner ping.
 */
import type { GameContext } from '@/core/context';
import type { Mixer } from './mixer';
import { type AC, disconnectOnEnded, tone, burst, gain, filter, osc, at, sweep, attackDecay } from './synth';

const BELL: [number, number][] = [
  [1, 1],
  [2.0, 0.35],
  [3.01, 0.18],
  [4.2, 0.07],
];

/** Context-independent tonal factories shared by live events and offline QA. */
export class UiSynth {
  constructor(protected ac: AC, protected dest: AudioNode) {}
  private get now(): number {
    return this.ac.currentTime + 0.005;
  }

  pickup(): void {
    const t = this.now;
    tone(this.ac, this.dest, t, { freq: 880, peak: 0.28, tau: 0.09, dur: 0.3, partials: BELL });
    tone(this.ac, this.dest, at(t, 70), { freq: 1318, peak: 0.28, tau: 0.12, dur: 0.4, partials: BELL });
  }
  hitMarker(headshot: boolean): void {
    const t = this.now;
    burst(this.ac, this.dest, t, { type: 'highpass', freq: 3000, peak: 0.35, tau: 0.003, dur: 0.02 });
    tone(this.ac, this.dest, t, { freq: headshot ? 2700 : 2000, peak: 0.3, tau: 0.02, dur: 0.07, type: 'triangle' });
  }
  killConfirm(): void {
    const t = this.now;
    tone(this.ac, this.dest, t, { freq: 784, peak: 0.32, tau: 0.08, dur: 0.16, type: 'triangle', lp: 3000 });
    tone(this.ac, this.dest, at(t, 95), { freq: 1046, peak: 0.34, tau: 0.16, dur: 0.45, partials: BELL });
  }
  deathSting(): void {
    const ac = this.ac;
    const t = this.now;
    const g = gain(ac, 0, this.dest);
    const lp = filter(ac, 'lowpass', 420, 1.2, 0, g);
    const o1 = osc(ac, 'sawtooth', 110, lp, t, t + 1.8);
    const o2 = osc(ac, 'sawtooth', 110.7, lp, t, t + 1.8);
    disconnectOnEnded(o2, [g, lp]);
    sweep(o1.frequency, t, 110, 52, 1.4);
    sweep(o2.frequency, t, 111, 52.6, 1.4);
    attackDecay(g.gain, t, 1.7, 0.4, 0.03, 0.55);
    tone(ac, this.dest, t, { type: 'sine', freq: 55, freqTo: 30, peak: 0.6, attack: 0.01, tau: 0.5, dur: 1.4 });
  }
  discovery(first: boolean): void {
    const t = this.now;
    // three rising notes in the subway-chime bell timbre, then the "bing-bong"
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i) => tone(this.ac, this.dest, at(t, i * 150), { freq: f, peak: 0.3, tau: 0.16, dur: 0.6, partials: BELL }));
    tone(this.ac, this.dest, at(t, 650), { freq: 1046.5, peak: 0.34, tau: 0.25, dur: 0.9, partials: BELL }); // bing
    tone(this.ac, this.dest, at(t, 900), { freq: 830.6, peak: 0.34, tau: 0.35, dur: 1.2, partials: BELL }); // bong
    if (first) tone(this.ac, this.dest, at(t, 1250), { freq: 1318.5, peak: 0.26, tau: 0.5, dur: 1.5, partials: BELL });
  }
  scoreTick(): void {
    tone(this.ac, this.dest, this.now, { freq: 1500, peak: 0.12, tau: 0.02, dur: 0.06, type: 'triangle' });
  }
  protectionWarning(): void {
    const t = this.now;
    tone(this.ac, this.dest, t, { freq: 660, peak: 0.25, tau: 0.06, dur: 0.14, type: 'triangle', lp: 2500 });
    tone(this.ac, this.dest, at(t, 180), { freq: 660, peak: 0.25, tau: 0.06, dur: 0.14, type: 'triangle', lp: 2500 });
  }
  protectionEnd(): void {
    tone(this.ac, this.dest, this.now, { freq: 660, freqTo: 440, peak: 0.3, tau: 0.12, dur: 0.35, type: 'triangle', lp: 2500 });
  }
  safeZone(enter: boolean): void {
    const t = this.now;
    tone(this.ac, this.dest, t, { freq: enter ? 440 : 660, peak: 0.2, attack: 0.03, tau: 0.15, dur: 0.35, partials: [[1, 1], [2, 0.2]] });
    tone(this.ac, this.dest, at(t, 160), { freq: enter ? 660 : 440, peak: 0.2, attack: 0.03, tau: 0.2, dur: 0.5, partials: [[1, 1], [2, 0.2]] });
  }
  bannerPing(): void {
    tone(this.ac, this.dest, this.now, { freq: 1568, peak: 0.25, tau: 0.18, dur: 0.6, partials: BELL });
  }

}

export class UiAudio extends UiSynth {
  private offs: (() => void)[] = [];
  private lastScore = 0;
  private wasProtected = false;
  private warned = false;
  private inSafe: boolean | null = null;
  private lastEvent = 0;

  constructor(private ctx: GameContext, private mixer: Mixer) {
    super(mixer.ac, mixer.ui);
    const ev = ctx.events;
    this.offs.push(ev.on('pickupTaken', () => this.pickup()));
    this.offs.push(ev.on('hit', (m) => {
      if (m.shooterId === ctx.state.local.id && m.victimId !== ctx.state.local.id) this.hitMarker(m.headshot);
    }));
    this.offs.push(ev.on('death', (m) => {
      if (m.killerId === ctx.state.local.id && m.victimId !== ctx.state.local.id) this.killConfirm();
    }));
    this.offs.push(ev.on('localDeath', () => this.deathSting()));
    this.offs.push(ev.on('discover', (m) => this.discovery(m.first)));
    this.offs.push(ev.on('score', (m) => {
      if (m.delta > 0 && m.reason !== 'kill' && m.reason !== 'discover') this.scoreTick();
    }));
    this.offs.push(ev.on('versionAvailable', () => this.bannerPing()));
  }

  override scoreTick(): void {
    const now = performance.now();
    if (now - this.lastScore < 700) return;
    this.lastScore = now;
    super.scoreTick();
  }

  update(): void {
    const st = this.ctx.state;
    if (!st.welcomed) return;
    // spawn protection countdown
    const left = st.local.protectedUntil - st.serverTime();
    const prot = left > 0 && !st.local.dead;
    if (prot && left < 10 && !this.warned) {
      this.warned = true;
      this.protectionWarning();
    }
    if (this.wasProtected && !prot && !st.local.dead && this.warned) this.protectionEnd();
    if (!prot) this.warned = false;
    if (prot && left > 12) this.warned = false;
    this.wasProtected = prot;
    // safe zone
    const p = st.local.state;
    const dz = Math.hypot(p.x - st.safeZone.x, p.z - st.safeZone.z);
    const inside = dz < st.safeZone.radius;
    if (this.inSafe === null) this.inSafe = inside;
    else if (inside !== this.inSafe) {
      this.inSafe = inside;
      const now = performance.now();
      if (now - this.lastEvent > 2000) {
        this.lastEvent = now;
        this.safeZone(inside);
      }
    }
  }

  dispose(): void {
    for (const off of this.offs) off();
  }
}
