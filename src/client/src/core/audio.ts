/**
 * AudioBus. The AudioContext, listener and gain graph are created lazily on first access, and the
 * context is resumed on the first pointerdown/keydown (browser autoplay policy). Nothing is created
 * until someone touches `audio.ctx` / `audio.listener` / a gain node, so headless screenshots pay nothing.
 */
import * as THREE from 'three';
import type { AudioBus } from './context';

export class AudioBusImpl implements AudioBus {
  private _ctx: AudioContext | null = null;
  private _listener: THREE.AudioListener | null = null;
  private _master: GainNode | null = null;
  private _sfx: GainNode | null = null;
  private _ambient: GainNode | null = null;
  private _music: GainNode | null = null;
  unlocked = false;
  private camera: THREE.Camera;
  private unlockHandlers: (() => void)[] = [];

  constructor(camera: THREE.Camera, private enabled = true) {
    this.camera = camera;
    const unlock = () => this.unlock();
    for (const ev of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(ev, unlock, { passive: true });
      this.unlockHandlers.push(() => window.removeEventListener(ev, unlock));
    }
  }

  get ctx(): AudioContext {
    if (!this._ctx) {
      const Ctor: typeof AudioContext = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
      this._ctx = new Ctor({ latencyHint: 'interactive' });
      THREE.AudioContext.setContext(this._ctx);
      if (this._ctx.state === 'running') this.unlocked = true;
    }
    return this._ctx;
  }

  get listener(): THREE.AudioListener {
    if (!this._listener) {
      // make sure three's global context is ours before the listener grabs it
      void this.ctx;
      this._listener = new THREE.AudioListener();
      this.camera.add(this._listener);
      // route the listener through master
      this._listener.gain.disconnect();
      this._listener.gain.connect(this.master);
    }
    return this._listener;
  }

  get master(): GainNode {
    if (!this._master) {
      this._master = this.ctx.createGain();
      this._master.gain.value = 1;
      this._master.connect(this.ctx.destination);
    }
    return this._master;
  }
  get sfx(): GainNode {
    if (!this._sfx) {
      this._sfx = this.ctx.createGain();
      this._sfx.gain.value = 1;
      this._sfx.connect(this.master);
    }
    return this._sfx;
  }
  get ambient(): GainNode {
    if (!this._ambient) {
      this._ambient = this.ctx.createGain();
      this._ambient.gain.value = 0.8;
      this._ambient.connect(this.master);
    }
    return this._ambient;
  }
  get music(): GainNode {
    if (!this._music) {
      this._music = this.ctx.createGain();
      this._music.gain.value = 0.5;
      this._music.connect(this.master);
    }
    return this._music;
  }

  /** true if an AudioContext has been created at all */
  get created(): boolean {
    return this._ctx !== null;
  }

  enable(): void { this.enabled = true; }

  unlock(): void {
    if (!this.enabled) return;
    try {
      const c = this.ctx;
      if (c.state !== 'running') {
        c.resume()
          .then(() => {
            this.unlocked = c.state === 'running';
          })
          .catch(() => {});
      } else this.unlocked = true;
    } catch (err) {
      console.warn('[audio] unlock failed', err);
    }
  }

  dispose(): void {
    for (const off of this.unlockHandlers) off();
    this._ctx?.close().catch(() => {});
  }
}
