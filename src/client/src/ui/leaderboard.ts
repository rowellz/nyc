/**
 * Leaderboard panel, built like a poster: heavy rank numerals, the score as the hero column, a quiet
 * gold / silver / bronze treatment on the top three, your row accented in place or pinned underneath with
 * your real rank. Scores count up on open (skipped under prefers-reduced-motion). Rebuilt only when the
 * data changes; the count-up touches the score cells only.
 */
import type { LeaderboardEntry } from '@shared/protocol';

/** rows shown in the list; your row is pinned underneath when you rank below this */
const TOP_N = 10;
const TOP_N_DEATH = 5;
const COUNT_MS = 650;

export type LeaderboardMode = 'full' | 'death';

function eraLabel(era: string): string {
  if (!era || era === 'present') return 'Present day';
  return era.charAt(0).toUpperCase() + era.slice(1);
}

export class LeaderboardPanel {
  readonly el: HTMLDivElement;
  private panel: HTMLDivElement;
  private body: HTMLDivElement;
  private pin: HTMLDivElement;
  private onlineEl: HTMLElement;
  private eraEl: HTMLElement;
  private foot: HTMLSpanElement;
  private lastKey = '';
  private visible = false;
  private topN = TOP_N;
  private scoreEls: { el: HTMLElement; value: number }[] = [];
  private countStart = -1;
  private raf = 0;
  private reduced: MediaQueryList | null = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'lb-wrap hidden';
    this.panel = document.createElement('div');
    this.panel.className = 'lb';
    this.panel.innerHTML = `
      <div class="lb-head">
        <div class="lb-titles"><div class="lb-kicker">New York <span class="lb-era"></span></div><div class="lb-title">Leaderboard</div></div>
        <div class="lb-online"><i></i><b></b> in the city</div>
      </div>
      <div class="lb-cols"><span>Rank</span><span>Player</span><span>Kills</span><span>Score</span></div>
      <div class="lb-body"></div>
      <div class="lb-pin"></div>
      <div class="lb-foot"><span>Score survives death. Everything else does not.</span><span class="hint">Hold TAB</span></div>`;
    this.el.appendChild(this.panel);
    this.body = this.panel.querySelector('.lb-body') as HTMLDivElement;
    this.pin = this.panel.querySelector('.lb-pin') as HTMLDivElement;
    this.onlineEl = this.panel.querySelector('.lb-online b') as HTMLElement;
    this.eraEl = this.panel.querySelector('.lb-era') as HTMLElement;
    this.foot = this.panel.querySelector('.hint') as HTMLSpanElement;
    this.render([], null, 0, '', 0, 'present');
  }

  get isVisible(): boolean {
    return this.visible;
  }

  setHint(text: string): void {
    this.foot.textContent = text;
  }

  /** death: top five, tighter rows, no column headers */
  setMode(mode: LeaderboardMode): void {
    const n = mode === 'death' ? TOP_N_DEATH : TOP_N;
    if (n === this.topN) return;
    this.topN = n;
    this.panel.classList.toggle('compact', mode === 'death');
    this.lastKey = '';
  }

  render(entries: LeaderboardEntry[], you: LeaderboardEntry | null, online: number, localName: string, localScore: number, era = 'present'): void {
    const key = JSON.stringify([entries, you, online, localName, localScore, era, this.topN]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.onlineEl.textContent = String(online);
    this.eraEl.textContent = `· ${eraLabel(era)}`;
    this.body.textContent = '';
    this.pin.textContent = '';
    this.scoreEls = [];
    if (!entries.length) {
      const e = document.createElement('div');
      e.className = 'lb-empty';
      e.textContent = 'No scores yet. Be the first name on this board.';
      this.body.appendChild(e);
      return;
    }
    let youShown = false;
    for (const en of entries.slice(0, this.topN)) {
      const isYou = !!you && en.rank === you.rank && en.name === you.name;
      if (isYou) youShown = true;
      this.body.appendChild(this.row(en, isYou));
    }
    if (you && !youShown) this.pin.appendChild(this.row(you, true));
    if (this.countStart >= 0) this.tick(); // a refresh mid count-up keeps the numbers moving
  }

  private row(e: LeaderboardEntry, you: boolean): HTMLDivElement {
    const r = document.createElement('div');
    r.className = `lb-row${e.rank <= 3 ? ` top r${e.rank}` : ''}${you ? ' you' : ''}`;
    r.innerHTML = `<span class="rank"></span><span class="who"><i class="on"></i><span class="name"></span></span><span class="k"></span><span class="sc"></span>`;
    (r.children[0] as HTMLElement).textContent = String(e.rank);
    const who = r.children[1] as HTMLElement;
    (who.lastElementChild as HTMLElement).textContent = e.name;
    if (e.online) (who.firstElementChild as HTMLElement).classList.add('live');
    (who.firstElementChild as HTMLElement).title = e.online ? 'in the city' : 'gone';
    (r.children[2] as HTMLElement).textContent = String(e.kills);
    const sc = r.children[3] as HTMLElement;
    sc.textContent = e.score.toLocaleString('en-US');
    this.scoreEls.push({ el: sc, value: e.score });
    return r;
  }

  private tick = (): void => {
    this.raf = 0;
    if (this.countStart < 0) return;
    const p = Math.min(1, (performance.now() - this.countStart) / COUNT_MS);
    const ease = 1 - Math.pow(1 - p, 3);
    for (const s of this.scoreEls) s.el.textContent = Math.round(s.value * ease).toLocaleString('en-US');
    if (p < 1) this.raf = requestAnimationFrame(this.tick);
    else this.countStart = -1;
  };

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.el.classList.remove('hidden');
    if (this.reduced?.matches) return;
    this.countStart = performance.now();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.el.classList.add('hidden');
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.countStart >= 0) {
      this.countStart = -1;
      for (const s of this.scoreEls) s.el.textContent = s.value.toLocaleString('en-US');
    }
  }
}
