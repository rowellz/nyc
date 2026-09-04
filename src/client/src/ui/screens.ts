/**
 * Full-screen states: name entry, death, pause, loading, update banner. Each owns one element under the
 * ui root and exposes show()/hide(); the orchestrator in index.ts decides which one is up.
 */
import type { AdminTools } from '@/core/admin';
import { lonLatToXZ } from '@shared/geo';
import { GAME_VERSION } from '@shared/version';
import { isNewerVersion } from '@/core/net';
import { LS_NAME, lsGet } from '@/core/state';

const CONTROLS: [string, string][] = [
  ['WASD', 'move'],
  ['Shift / Ctrl or Alt', 'sprint / walk · C crouch'],
  ['Mouse', 'look · LMB fire · RMB aim'],
  ['E', 'enter / exit vehicle · pick up'],
  ['F', 'horn / siren'],
  ['R', 'reload'],
  ['Tab', 'leaderboard'],
  ['M', 'map'],
];

/** a place the pause menu can teleport you to (dev / testing convenience) */
export interface JumpItem { name: string; sub: string; x: number; z: number; heading?: number }

const TIPS = [
  'Your <b>score survives death</b>. Your weapons, armor and car do not.',
  'Nobody can shoot inside the <b>safe zone</b> at Bryant Park. Regroup there.',
  'New players are <b>protected for two minutes</b> after spawning, until they fire.',
  'Every street is a real street. <b>The signs are right.</b>',
  '<b>Finding a landmark first</b> is worth more than a kill.',
  'Hold <b>Tab</b> for the leaderboard. Press <b>M</b> for the map.',
  'Distance driven and time survived count toward your score.',
  'Press <b>F3</b> to see ping and frame rate.',
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

function controlsHtml(): string {
  const touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
  const controls = touch ? [
    ['Left stick', 'move / drive'], ['Right drag', 'look'],
    ['Jump', 'jump / handbrake'], ['Interact', 'enter / exit vehicle · pick up'],
    ['Fire', 'shoot'], ['Reload', 'reload'],
  ] : CONTROLS;
  return controls.map(([k, v]) => `<span><b>${k}</b>${v}</span>`).join('');
}

abstract class Screen {
  readonly el: HTMLDivElement;
  protected visible = false;
  constructor(root: HTMLElement, cls: string) {
    this.el = el('div', `screen ia hidden ${cls}`, root);
  }
  get isVisible(): boolean {
    return this.visible;
  }
  protected open(): void {
    if (this.visible) return;
    this.visible = true;
    this.el.classList.remove('hidden', 'out');
  }
  hide(fade = false): void {
    if (!this.visible) return;
    this.visible = false;
    if (fade) {
      this.el.classList.add('out');
      setTimeout(() => {
        if (!this.visible) this.el.classList.add('hidden');
      }, 360);
    } else this.el.classList.add('hidden');
  }
}

// ---------------------------------------------------------------------------------------------------
export { NameEntry } from './nameEntry';

// ---------------------------------------------------------------------------------------------------
export interface DeathDetails {
  /** weapon name, e.g. "Rifle" */
  weapon?: string | null;
  /** inline svg for the weapon (see hud.ts weaponGlyph) */
  glyph?: string | null;
  /** "on 5th Avenue · Midtown" */
  where?: string | null;
}

/** Composed for one 16:9 frame: verdict, who / with what / where, score kept, respawn 3-2-1, top five beneath. */
export class DeathScreen extends Screen {
  private by: HTMLDivElement;
  private where: HTMLDivElement;
  private keptVal: HTMLSpanElement;
  private btn: HTMLButtonElement;
  private cd: HTMLSpanElement;
  readonly slot: HTMLDivElement;
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(root: HTMLElement, private onRespawn: () => void) {
    super(root, 'death');
    const card = el('div', 'card', this.el);
    el('div', 'title', card).textContent = 'You died';
    this.by = el('div', 'by', card);
    this.where = el('div', 'where', card);
    const kept = el('div', 'kept', card);
    kept.innerHTML = `<span class="lab">Score kept</span><span class="val num"></span><span class="gone">everything else is gone</span>`;
    this.keptVal = kept.querySelector('.val') as HTMLSpanElement;
    this.btn = el('button', 'btn', card);
    this.btn.type = 'button';
    this.btn.innerHTML = `Respawn<span class="cd num"></span>`;
    this.cd = this.btn.querySelector('.cd') as HTMLSpanElement;
    this.btn.addEventListener('click', () => {
      if (this.btn.disabled) return;
      this.onRespawn();
    });
    this.slot = el('div', 'lb-slot', this.el);
  }
  show(killer: string, score: number, d: DeathDetails = {}, pending = false): void {
    this.open();
    this.el.classList.toggle('environmental', killer === 'You drowned');
    this.by.textContent = '';
    this.el.querySelector('.title')!.textContent = killer === 'You drowned' ? 'You drowned' : 'You died';
    if (killer === 'You drowned') this.by.textContent = 'Return to shore after respawning';
    else if (killer) {
      this.by.appendChild(document.createTextNode(d.weapon ? 'Shot by ' : 'Killed by '));
      el('b', undefined, this.by).textContent = killer;
      if (d.weapon) {
        const w = el('span', 'weap', this.by);
        w.innerHTML = d.glyph ?? '';
        w.appendChild(document.createTextNode(d.weapon));
      }
    } else this.by.textContent = 'The city got you';
    this.where.textContent = d.where ?? '';
    this.where.classList.toggle('hidden', !d.where);
    this.keptVal.textContent = score.toLocaleString('en-US');
    let left = 3;
    this.btn.disabled = true;
    this.cd.textContent = String(left);
    this.cd.classList.remove('hidden');
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Do not offer a client-predicted respawn; confirmation starts the real countdown.
    if (pending) { this.cd.textContent = '…'; return; }
    this.timer = setInterval(() => {
      left--;
      if (left <= 0) {
        this.btn.disabled = false;
        this.cd.classList.add('hidden');
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      } else this.cd.textContent = String(left);
    }, 1000);
  }
  hide(): void {
    super.hide();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// ---------------------------------------------------------------------------------------------------
interface AudioApi {
  getSettings?: () => Record<string, number | boolean>;
  setVolume?: (bus: 'master' | 'sfx' | 'ambient' | 'music', v: number) => void;
}

export class PauseMenu extends Screen {
  private vols: { bus: 'master' | 'sfx' | 'ambient' | 'music'; range: HTMLInputElement; val: HTMLSpanElement; row: HTMLDivElement }[] = [];
  private panel: HTMLDivElement;
  private jumpSec: HTMLDivElement;
  private jumpList: HTMLDivElement;
  private jumpKey = '';
  private adminSection: HTMLDivElement | null = null;
  private flyButton: HTMLButtonElement | null = null;
  constructor(root: HTMLElement, quality: string, private onResume: () => void, private onJump?: (it: JumpItem) => void, private admin?: AdminTools) {
    super(root, 'pause');
    const panel = el('div', 'panel', this.el);
    this.panel = panel;
    el('div', 'title', panel).textContent = 'Paused';
    el('div', 'sub', panel).textContent = 'the city keeps going without you';
    const grid = el('div', 'grid', panel);

    const left = el('div', undefined, grid);
    el('h4', undefined, left).textContent = 'Audio';
    const buses: ['master' | 'sfx' | 'ambient' | 'music', string][] = [
      ['master', 'Master'],
      ['sfx', 'Effects'],
      ['ambient', 'Ambience'],
      ['music', 'Music'],
    ];
    for (const [bus, label] of buses) {
      const row = el('div', 'vol', left);
      el('span', undefined, row).textContent = label;
      const range = el('input', undefined, row);
      range.type = 'range';
      range.min = '0';
      range.max = '100';
      range.value = '100';
      const val = el('span', undefined, row);
      val.textContent = '100';
      range.addEventListener('input', () => {
        val.textContent = range.value;
        const api = (window as unknown as { __audio?: AudioApi }).__audio;
        api?.setVolume?.(bus, parseInt(range.value, 10) / 100);
      });
      this.vols.push({ bus, range, val, row });
    }
    const q = el('div', undefined, left);
    q.style.marginTop = '18px';
    el('h4', undefined, q).textContent = 'Quality';
    const sel = el('select', undefined, q);
    for (const lv of quality === 'mobile' ? ['mobile'] : ['low', 'medium', 'high', 'ultra']) {
      const o = el('option', undefined, sel);
      o.value = lv;
      o.textContent = lv[0].toUpperCase() + lv.slice(1) + (lv === quality ? ' (current)' : '');
      if (lv === quality) o.selected = true;
    }
    sel.addEventListener('change', () => {
      const u = new URL(location.href);
      u.searchParams.set('q', sel.value);
      location.href = u.toString();
    });
    el('div', 'note', q).textContent = 'Changing quality reloads the city. Your score is safe.';

    const right = el('div', undefined, grid);
    el('h4', undefined, right).textContent = 'Controls';
    const keys = el('div', 'keys', right);
    const all: [string, string][] = [...CONTROLS, ['Shift', 'sprint'], ['Space', 'jump · handbrake'], ['1-4', 'weapons'], ['V', 'camera'], ['H', 'headlights'], ['F3', 'ping / fps'], ['Esc', 'pause']];
    keys.innerHTML = all.map(([k, v]) => `<b>${k}</b><span>${v}</span>`).join('');

    // jump to: named spots + landmarks (play mode only; a dev / testing convenience)
    this.jumpSec = el('div', 'jump-sec', panel);
    const jh = el('h4', undefined, this.jumpSec);
    jh.innerHTML = `Jump to <span>T</span>`;
    this.jumpList = el('div', 'jump', this.jumpSec);
    this.jumpSec.classList.add('hidden');

    const actions = el('div', 'actions', panel);
    const resume = el('button', 'btn', actions);
    resume.type = 'button';
    resume.textContent = 'Resume';
    resume.addEventListener('click', () => this.onResume());
    el('span', 'ver', actions).textContent = `v${GAME_VERSION}`;

    // clicking the dark backdrop resumes too
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.onResume();
    });
  }
  setAdminAllowed(allowed: boolean, flying: boolean): void {
    if (allowed && this.admin && !this.adminSection) this.buildAdmin(this.panel, this.admin);
    this.jumpSec.classList.toggle('hidden', !allowed || !this.admin);
    this.adminSection?.classList.toggle('hidden', !allowed);
    if (this.flyButton) this.flyButton.textContent = flying ? 'Land / F5' : 'Fly / F5';
  }
  private buildAdmin(panel: HTMLElement, admin: AdminTools): void {
    const section = this.adminSection = el('div', 'admin-tools', panel);
    el('h4', undefined, section).textContent = 'Admin · local camera & environment';
    const status = el('div', 'note', section);
    status.setAttribute('role', 'status');
    const button = (label: string, fn: () => void | Promise<unknown>) => {
      const b = el('button', 'btn ghost', section);
      b.type = 'button'; b.textContent = label;
      b.addEventListener('click', () => { void Promise.resolve().then(fn).catch(e => { status.textContent = String(e.message || e); }); });
      return b;
    };
    this.flyButton = button('Fly / F5', () => { admin.toggleFly(); this.onResume(); });
    el('p', 'note', section).textContent = 'Fly: WASD + mouse · Shift fast · Space/Ctrl up/down. Speed increases with height. T opens Jump to.';
    const form = el('form', 'admin-location', section);
    const mode = el('select', undefined, form);
    mode.setAttribute('aria-label', 'Coordinate format');
    for (const [value, label] of [['latlon', 'Latitude, longitude'], ['xz', 'World x, z']]) {
      const option = el('option', undefined, mode); option.value = value; option.textContent = label;
    }
    const input = el('input', undefined, form);
    input.placeholder = '40.7536, -73.9832'; input.setAttribute('aria-label', 'Teleport coordinates'); input.required = true;
    mode.addEventListener('change', () => { input.placeholder = mode.value === 'xz' ? '120, -80' : '40.7536, -73.9832'; });
    const go = el('button', 'btn ghost', form); go.textContent = 'Teleport'; go.type = 'submit';
    form.addEventListener('submit', e => {
      e.preventDefault();
      const parts = input.value.trim().split(/\s*,\s*|\s+/);
      const values = parts.map(Number);
      if (parts.length !== 2 || parts.some(p => !p) || !values.every(Number.isFinite)) { status.textContent = 'Enter two numbers separated by a comma.'; return; }
      const [a, b] = values;
      const { x, z } = mode.value === 'latlon' ? lonLatToXZ(b, a) : { x: a, z: b };
      try { admin.teleport(x, z); status.textContent = ''; this.onResume(); }
      catch (e) { status.textContent = (e as Error).message; }
    });
    const timeLabel = el('label', undefined, section); timeLabel.textContent = 'Local time ';
    const time = el('input', undefined, timeLabel); time.type = 'time'; time.value = '18:00'; time.setAttribute('aria-label', 'Local time');
    button('Set time', () => admin.setTime(time.value));
    const weather = el('select', undefined, section); weather.setAttribute('aria-label', 'Local weather');
    for (const condition of ['clear', 'partly_cloudy', 'cloudy', 'fog', 'rain', 'heavy_rain', 'snow', 'thunder']) {
      const option = el('option', undefined, weather); option.value = condition; option.textContent = condition.replaceAll('_', ' ');
    }
    weather.addEventListener('change', () => { admin.setWeather(weather.value); });
    button('Use live time & weather', () => admin.resetEnvironment());
    button('Copy location', async () => { status.textContent = await admin.copyLocation(); });
  }
  /** rebuild the Jump-to list (cheap; called when the menu opens so neighborhoods are current) */
  setJump(items: JumpItem[]): void {
    const key = items.map((i) => `${i.name}|${i.sub}`).join(',');
    if (key === this.jumpKey) return;
    this.jumpKey = key;
    this.jumpList.textContent = '';
    for (const it of items) {
      const b = el('button', 'jump-it', this.jumpList);
      b.type = 'button';
      el('b', undefined, b).textContent = it.name;
      el('span', undefined, b).textContent = it.sub;
      b.addEventListener('click', () => this.onJump?.(it));
    }
  }

  /** open scrolled to the Jump-to section (T) */
  focusJump(): void {
    if (this.jumpSec.classList.contains('hidden')) return;
    this.panel.scrollTop = this.jumpSec.offsetTop - 16;
    this.jumpSec.classList.add('lit');
    setTimeout(() => this.jumpSec.classList.remove('lit'), 900);
  }

  show(): void {
    this.open();
    this.panel.scrollTop = 0;
    const api = (window as unknown as { __audio?: AudioApi }).__audio;
    const s = api?.getSettings?.();
    for (const v of this.vols) {
      const has = !!api?.setVolume;
      v.row.classList.toggle('off', !has);
      v.range.disabled = !has;
      const cur = s && typeof s[v.bus] === 'number' ? (s[v.bus] as number) : 1;
      v.range.value = String(Math.round(cur * 100));
      v.val.textContent = v.range.value;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
export class LoadingScreen extends Screen {
  private bar: HTMLElement;
  private status: HTMLDivElement;
  private tip: HTMLDivElement;
  private tipTimer: ReturnType<typeof setInterval> | null = null;
  private tipIdx: number;
  constructor(root: HTMLElement) {
    super(root, 'loading');
    el('div', 'title', this.el).textContent = 'New York';
    el('div', 'sub', this.el).textContent = 'a city that never ends';
    const track = el('div', 'track', this.el);
    this.bar = el('i', undefined, track);
    this.status = el('div', 'status', this.el);
    this.tip = el('div', 'tip', this.el);
    this.tipIdx = Math.floor(Math.random() * TIPS.length);
    this.tip.innerHTML = TIPS[this.tipIdx];
  }
  show(): void {
    this.open();
    if (!this.tipTimer)
      this.tipTimer = setInterval(() => {
        this.tipIdx = (this.tipIdx + 1) % TIPS.length;
        this.tip.innerHTML = TIPS[this.tipIdx];
      }, 4500);
  }
  hide(): void {
    super.hide(true);
    if (this.tipTimer) clearInterval(this.tipTimer);
    this.tipTimer = null;
  }
  setProgress(frac: number, text: string): void {
    this.bar.style.width = `${Math.round(Math.max(0.04, Math.min(1, frac)) * 100)}%`;
    if (this.status.textContent !== text) this.status.textContent = text;
  }
}

// ---------------------------------------------------------------------------------------------------
export class UpdateBanner {
  readonly el: HTMLDivElement;
  private label: HTMLSpanElement;
  private dismissed = new Set<string>();
  private version = '';
  private required = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private deferReload = () => {
    this.present('development', 'City code changed. Your session is still running.');
    return new Promise<void>(() => {});
  };
  constructor(parent: HTMLElement, playMode = false) {
    this.el = el('div', 'banner ia hidden', parent);
    this.el.setAttribute('role', 'status');
    this.label = el('span', undefined, this.el);
    const reload = el('button', undefined, this.el);
    reload.type = 'button'; reload.textContent = 'Updated: click to reload';
    reload.onclick = () => location.reload();
    const dismiss = el('button', undefined, this.el);
    dismiss.type = 'button'; dismiss.textContent = '×'; dismiss.setAttribute('aria-label', 'Dismiss update');
    dismiss.onclick = () => { if (!this.required) { this.dismissed.add(this.version); this.el.classList.add('hidden'); } };
    // Vite normally reloads the whole document for changes without an HMR boundary,
    // or when its dev socket reconnects. Hold those reloads during PLAY; only the button reloads.
    if (playMode && import.meta.hot) {
      import.meta.hot.on('vite:beforeFullReload', this.deferReload);
      import.meta.hot.on('vite:ws:disconnect', this.deferReload);
    }
  }
  show(version: string, required = false): void {
    if (!required && !isNewerVersion(version, GAME_VERSION)) return;
    // Core's notice also works before UI startup; do not stack two required-update prompts.
    if (required && document.getElementById('disconnected')) { this.el.classList.add('hidden'); return; }
    this.required ||= required;
    this.present(version, required ? 'Reloads automatically when you are safe.' : `Version ${version} is available.`);
  }
  private present(version: string, text: string): void {
    if (!this.required && (this.dismissed.has(version) || this.version === version)) return;
    this.version = version;
    this.label.textContent = text;
    this.el.classList.remove('hidden');
    clearTimeout(this.timer);
  }
  dispose(): void {
    clearTimeout(this.timer);
    import.meta.hot?.off('vite:beforeFullReload', this.deferReload);
    import.meta.hot?.off('vite:ws:disconnect', this.deferReload);
    this.el.remove();
  }
}
