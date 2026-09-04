/**
 * HUD DOM: every element is created once; setters compare against the last value so a frame with nothing
 * new touches nothing (no layout thrash). Anchors: tl feed/toasts, tr score, bl minimap/bars/location,
 * br weapon/speed, centre crosshair + prompt.
 */
export type ToastKind = 'info' | 'score' | 'discover' | 'warn';
export type FeedKind = 'kill' | 'system' | 'discover';

const FEED_MAX = 6;
const FEED_TTL = 7000;
const TOAST_MAX = 3;

/** kill-feed weapon glyphs: flat silhouettes, 22x10, keyed by WeaponId (1 pistol, 2 smg, 3 shotgun, 4 rifle) */
const GLYPH: Record<number, string> = {
  1: '<path d="M1 2h14v3H9v1H8l-1.2 3H3.6L5 5H1z"/>',
  2: '<path d="M0 3h2V2h13v3h4v1h-6.5l-1 3H8.8l.6-3H6v3H4V6H2v1H0z"/>',
  3: '<path d="M0 4h22v2h-9.5l-1 3H8l1-3H4L3 8H0z"/>',
  4: '<path d="M0 3h4l1-1h17v3h-9v1h-1v2H9V6H6v3H4V6H2l-1 2H0z"/>',
};
const GLYPH_DEATH = '<path d="M6 0a5 5 0 0 0-5 5v3h2v2h2V8h2v2h2V8h2V5a5 5 0 0 0-5-5zM4 4a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm4 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/>';

/** inline svg for a weapon id (or the plain death mark); safe to drop into innerHTML */
export function weaponGlyph(weapon?: number): string {
  const p = weapon !== undefined ? GLYPH[weapon] : undefined;
  return p ? `<svg class="wg" viewBox="0 0 22 10" width="22" height="10" aria-hidden="true">${p}</svg>` : `<svg class="wg x" viewBox="0 0 12 10" width="12" height="10" aria-hidden="true">${GLYPH_DEATH}</svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  readonly tl: HTMLDivElement;
  readonly tr: HTMLDivElement;
  readonly bl: HTMLDivElement;
  readonly br: HTMLDivElement;
  readonly bc: HTMLDivElement;
  readonly tc: HTMLDivElement;
  readonly center: HTMLDivElement;
  readonly minimapSlot: HTMLDivElement;
  private feedEl: HTMLDivElement;
  private scoreVal: HTMLDivElement;
  private popsEl: HTMLDivElement;
  private onlineEl: HTMLDivElement;
  private healthBar: HTMLDivElement;
  private healthValue: HTMLSpanElement;
  private healthSegs: HTMLElement[] = [];
  private armorBar: HTMLDivElement;
  private armorSegs: HTMLElement[] = [];
  private locStreet: HTMLDivElement;
  private locArea: HTMLDivElement;
  private chipsEl: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private weaponEl: HTMLDivElement;
  private weaponName: HTMLDivElement;
  private weaponAmmo: HTMLDivElement;
  private weaponReload: HTMLDivElement;
  private speedEl: HTMLDivElement;
  private speedVal: HTMLDivElement;
  private crossEl: HTMLDivElement;
  private crossParts: { u: HTMLElement; d: HTMLElement; l: HTMLElement; r: HTMLElement };
  private hitEl: HTMLDivElement;
  private dmgEl: HTMLDivElement;
  private dmgArc: HTMLElement;
  private promptEl: HTMLDivElement;
  private clickHint: HTMLDivElement;

  // last-values so we only write the DOM on change
  private lastScoreShown = -1;
  private scoreTarget = 0;
  private scoreShown = 0;
  private lastOnline = -1;
  private lastHealth = -1;
  private lastArmor = -1;
  private lastStreet: string | null = '';
  private lastArea: string | null = '';
  private locTimer: ReturnType<typeof setTimeout> | null = null;
  private lastChips = '';
  private lastWeapon = '';
  private lastSpeed = '';
  private lastCross = '';
  private lastPrompt: string | null = '';
  private lastStats = '';
  private hitTimer: ReturnType<typeof setTimeout> | null = null;
  private dmgTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(root: HTMLElement) {
    this.tl = el('div', 'hud tl', root);
    this.feedEl = el('div', 'feed', this.tl);

    this.tr = el('div', 'hud tr', root);
    el('div', 'score-label', this.tr).textContent = 'Score';
    this.scoreVal = el('div', 'score-val num', this.tr);
    this.scoreVal.textContent = '0';
    this.onlineEl = el('div', 'online', this.tr);
    this.popsEl = el('div', 'pops', this.tr);

    this.tc = el('div', 'hud tc', root);

    this.bl = el('div', 'hud bl', root);
    this.chipsEl = el('div', 'chips', this.bl);
    this.minimapSlot = el('div', 'minimap-slot', this.bl);
    const bars = el('div', 'bars', this.bl);
    const healthRow = el('div', 'health-row', bars);
    this.healthBar = el('div', 'bar health', healthRow);
    this.healthValue = el('span', 'health-value num', healthRow);
    for (let i = 0; i < 10; i++) this.healthSegs.push(el('i', undefined, this.healthBar));
    this.armorBar = el('div', 'bar armor hidden', bars);
    for (let i = 0; i < 10; i++) this.armorSegs.push(el('i', undefined, this.armorBar));
    const loc = el('div', 'loc', this.bl);
    this.locStreet = el('div', 'street', loc);
    this.locArea = el('div', 'area', loc);
    this.statsEl = el('div', 'stats num', this.bl);

    this.br = el('div', 'hud br', root);
    this.speedEl = el('div', 'speed hidden', this.br);
    this.speedVal = el('div', 'val num', this.speedEl);
    el('div', 'unit', this.speedEl).textContent = 'mph';
    this.weaponEl = el('div', 'weapon unarmed', this.br);
    this.weaponName = el('div', 'name', this.weaponEl);
    this.weaponAmmo = el('div', 'ammo num', this.weaponEl);
    this.weaponReload = el('div', 'reload hidden', this.weaponEl);
    this.weaponName.textContent = 'Unarmed';

    this.center = el('div', 'hud centre', root);
    this.crossEl = el('div', 'cross hidden', this.center);
    el('i', 'dot', this.crossEl);
    this.crossParts = { u: el('i', 'u', this.crossEl), d: el('i', 'd', this.crossEl), l: el('i', 'l', this.crossEl), r: el('i', 'r', this.crossEl) };
    this.hitEl = el('div', 'hitmark', this.center);
    for (let i = 0; i < 4; i++) {
      const t = el('i', undefined, this.hitEl);
      t.style.transform = `rotate(${45 + i * 90}deg)`;
    }
    this.dmgEl = el('div', 'dmg', this.center);
    this.dmgArc = el('i', undefined, this.dmgEl);
    this.clickHint = el('div', 'clickhint hidden', this.center);
    this.clickHint.textContent = 'Click to play';

    this.bc = el('div', 'hud bc', root);
    this.promptEl = el('div', 'prompt hidden', this.bc);
  }

  /** per frame: score count-up */
  update(dt: number): void {
    if (this.scoreShown !== this.scoreTarget) {
      const d = this.scoreTarget - this.scoreShown;
      const step = Math.abs(d) < 2 ? d : d * Math.min(1, dt * 7);
      this.scoreShown = Math.abs(d) < 2 ? this.scoreTarget : this.scoreShown + step;
      const shown = Math.round(this.scoreShown);
      if (shown !== this.lastScoreShown) {
        this.lastScoreShown = shown;
        this.scoreVal.textContent = shown.toLocaleString('en-US');
      }
    }
  }

  setScore(score: number, instant = false): void {
    this.scoreTarget = score;
    if (instant) this.scoreShown = score - 0.5; // forces one write
  }

  popScore(delta: number, reason: string): void {
    if (!delta) return;
    const p = el('div', 'pop', this.popsEl);
    p.innerHTML = `${delta > 0 ? '+' : ''}${delta.toLocaleString('en-US')}<small></small>`;
    (p.lastElementChild as HTMLElement).textContent = prettyReason(reason);
    if (delta < 0) p.style.color = '#ff6a6a';
    setTimeout(() => p.remove(), 1900);
    while (this.popsEl.children.length > 4) this.popsEl.firstElementChild?.remove();
  }

  setOnline(n: number): void {
    if (n === this.lastOnline) return;
    this.lastOnline = n;
    this.onlineEl.innerHTML = `<i></i>${n} in the city`;
  }

  setHealth(h: number, armor: number): void {
    const hv = Math.max(0, Math.min(100, Math.round(h)));
    if (hv !== this.lastHealth) {
      this.lastHealth = hv;
      this.healthValue.textContent = `${hv} HP`;
      this.healthBar.setAttribute('aria-label', `Health ${hv} of 100`);
      const on = Math.ceil(hv / 10);
      for (let i = 0; i < 10; i++) this.healthSegs[i].classList.toggle('on', i < on);
      this.healthBar.classList.toggle('low', hv <= 25);
      this.healthBar.classList.toggle('mid', hv > 25 && hv <= 50);
    }
    const av = Math.max(0, Math.min(100, Math.round(armor)));
    if (av !== this.lastArmor) {
      this.lastArmor = av;
      this.armorBar.classList.toggle('hidden', av <= 0);
      const on = Math.ceil(av / 10);
      for (let i = 0; i < 10; i++) this.armorSegs[i].classList.toggle('on', i < on);
    }
  }

  setLocation(street: string | null, area: string | null): void {
    if (street === this.lastStreet && area === this.lastArea) return;
    this.lastStreet = street;
    this.lastArea = area;
    this.locStreet.classList.add('fade');
    this.locArea.classList.add('fade');
    if (this.locTimer) clearTimeout(this.locTimer);
    this.locTimer = setTimeout(() => {
      this.locStreet.textContent = street ?? '';
      this.locArea.textContent = area ?? '';
      this.locStreet.classList.remove('fade');
      this.locArea.classList.remove('fade');
    }, 260);
  }

  setChips(protectedLeft: number | null, safe: boolean): void {
    const key = `${protectedLeft === null ? '' : Math.ceil(protectedLeft)}|${safe ? 1 : 0}`;
    if (key === this.lastChips) return;
    this.lastChips = key;
    let html = '';
    if (protectedLeft !== null) {
      const s = Math.max(0, Math.ceil(protectedLeft));
      html += `<span class="chip prot">Protected ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</span>`;
    }
    if (safe) html += `<span class="chip safe">Safe zone</span>`;
    this.chipsEl.innerHTML = html;
  }

  setStats(text: string | null): void {
    const t = text ?? '';
    if (t === this.lastStats) return;
    this.lastStats = t;
    this.statsEl.textContent = t;
  }

  setWeapon(w: { name: string; mag: number; ammo: number; reloading: boolean } | null): void {
    const key = w ? `${w.name}|${w.mag}|${w.ammo}|${w.reloading ? 1 : 0}` : '';
    if (key === this.lastWeapon) return;
    this.lastWeapon = key;
    if (!w) {
      this.weaponEl.classList.add('unarmed');
      this.weaponName.textContent = 'Unarmed';
      this.weaponAmmo.textContent = '';
      this.weaponReload.classList.add('hidden');
      return;
    }
    this.weaponEl.classList.remove('unarmed');
    this.weaponName.textContent = w.name;
    this.weaponAmmo.innerHTML = `${w.mag} <span>/ ${w.ammo}</span>`;
    this.weaponReload.textContent = 'Reloading';
    this.weaponReload.classList.toggle('hidden', !w.reloading);
  }

  setSpeed(mph: number | null): void {
    const key = mph === null ? '' : String(Math.round(mph));
    if (key === this.lastSpeed) return;
    this.lastSpeed = key;
    this.speedEl.classList.toggle('hidden', mph === null);
    this.weaponEl.classList.toggle('hidden', mph !== null);
    if (mph !== null) this.speedVal.textContent = key;
  }

  setCrosshair(visible: boolean, gapPx: number): void {
    const gap = Math.round(gapPx);
    const key = visible ? `1|${gap}` : '0';
    if (key === this.lastCross) return;
    this.lastCross = key;
    this.crossEl.classList.toggle('hidden', !visible);
    if (!visible) return;
    const c = this.crossParts;
    c.u.style.top = `${-gap - 9}px`;
    c.d.style.top = `${gap}px`;
    c.l.style.left = `${-gap - 9}px`;
    c.r.style.left = `${gap}px`;
  }

  hitMarker(head: boolean): void {
    this.hitEl.classList.remove('on');
    void this.hitEl.offsetWidth; // restart the animation
    this.hitEl.classList.toggle('head', head);
    this.hitEl.classList.add('on');
    if (this.hitTimer) clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => this.hitEl.classList.remove('on'), 220);
  }

  /** angle in radians clockwise from screen-up toward where the damage came from */
  damageFrom(angle: number): void {
    this.dmgArc.style.transform = `rotate(${(angle * 180) / Math.PI}deg)`;
    this.dmgArc.classList.remove('on');
    void this.dmgArc.offsetWidth;
    this.dmgArc.classList.add('on');
    if (this.dmgTimer) clearTimeout(this.dmgTimer);
    this.dmgTimer = setTimeout(() => this.dmgArc.classList.remove('on'), 1250);
  }

  prompt(text: string | null): void {
    if (text === this.lastPrompt) return;
    this.lastPrompt = text;
    if (!text) {
      this.promptEl.classList.add('hidden');
      return;
    }
    const m = text.match(/^\[(\w+)\]\s*(.*)$/);
    this.promptEl.textContent = '';
    if (m) {
      const b = el('b', undefined, this.promptEl);
      b.textContent = m[1].toUpperCase();
      this.promptEl.appendChild(document.createTextNode(m[2]));
    } else this.promptEl.textContent = text;
    this.promptEl.classList.remove('hidden');
  }

  showClickHint(v: boolean): void {
    this.clickHint.classList.toggle('hidden', !v);
  }

  /** @param weapon WeaponId for kill rows: drawn as a glyph between killer and victim */
  feed(text: string, kind: FeedKind, weapon?: number): void {
    const row = el('div', `row ${kind}`, this.feedEl);
    if (kind === 'kill') {
      const m = text.match(/^(.+?) killed (.+)$/);
      const died = text.match(/^(.+?) died$/);
      if (m) {
        row.innerHTML = `<b></b>${weaponGlyph(weapon)}<b></b>`;
        (row.children[0] as HTMLElement).textContent = m[1];
        (row.children[2] as HTMLElement).textContent = m[2];
      } else if (died) {
        row.innerHTML = `${weaponGlyph()}<b></b>`;
        (row.children[1] as HTMLElement).textContent = died[1];
      } else row.textContent = text;
    } else row.textContent = text;
    while (this.feedEl.children.length > FEED_MAX) this.feedEl.firstElementChild?.remove();
    setTimeout(() => row.classList.add('gone'), FEED_TTL);
    setTimeout(() => row.remove(), FEED_TTL + 700);
  }

  toast(text: string, kind: ToastKind = 'info', sub?: string): void {
    const t = el('div', `toast ${kind}`, this.tc);
    t.textContent = text;
    if (sub) el('small', undefined, t).textContent = sub;
    while (this.tc.querySelectorAll('.toast').length > TOAST_MAX) this.tc.querySelector('.toast')?.remove();
    setTimeout(() => t.remove(), 3100);
  }

  setVisible(v: boolean): void {
    for (const a of [this.tl, this.tr, this.bl, this.br, this.bc, this.center]) a.style.opacity = v ? '1' : '0';
  }
}

function prettyReason(r: string): string {
  return (r || '').replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}
