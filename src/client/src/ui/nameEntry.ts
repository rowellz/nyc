import { GAME_VERSION } from '@shared/version';
import { setNameFormUp, stageBeacon } from '@/core/crashGuard';
import { isIOS } from '@/core/quality';
const LS_NAME = 'nyc.name';
function lsGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
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

export class NameEntry extends Screen {
  private input: HTMLInputElement;
  private err: HTMLDivElement;
  private email: HTMLInputElement;
  private newsletter: HTMLInputElement;
  constructor(root: HTMLElement, private onSubmit: (name: string, email: string, newsletter: boolean) => void) {
    super(root, 'intro');
    el('div', 'title head', this.el).textContent = 'New York';
    el('div', 'sub', this.el).textContent = 'a city that never ends';
    const form = el('form', undefined, this.el);
    this.input = el('input', undefined, form);
    this.input.type = 'text';
    this.input.maxLength = 100;
    this.input.name = 'name';
    this.input.required = true;
    this.input.setAttribute('aria-label', 'Your name');
    this.input.placeholder = 'Your name';
    this.input.autocomplete = 'given-name';
    this.input.spellcheck = false;
    const nameHelp = el('small', 'name-help', form);
    nameHelp.id = 'public-name-help';
    nameHelp.textContent = "You'll appear in the city as a random name like amber-fox-42";
    this.input.setAttribute('aria-describedby', nameHelp.id);
    this.email = el('input', undefined, form);
    this.email.type = 'email';
    this.email.name = 'email';
    this.email.required = true;
    this.email.maxLength = 254;
    this.email.autocomplete = 'email';
    this.email.placeholder = 'Your email';
    this.email.setAttribute('aria-label', 'Your email');
    const newsletterRow = el('div', 'newsletter', form);
    const newsletterLabel = el('label', undefined, newsletterRow);
    this.newsletter = el('input', undefined, newsletterLabel);
    this.newsletter.type = 'checkbox';
    this.newsletter.name = 'newsletter';
    this.newsletter.checked = true;
    this.newsletter.setAttribute('aria-describedby', 'newsletter-help');
    el('span', undefined, newsletterLabel).textContent = 'Also sign up for the Something Big newsletter to get the latest from Matt Shumer';
    const newsletterHelp = el('small', undefined, newsletterRow);
    newsletterHelp.id = 'newsletter-help';
    newsletterHelp.textContent = 'You can play without it.';
    const btn = el('button', 'btn', form);
    btn.type = 'submit';
    btn.textContent = 'Enter the city';
    const privacy = el('p', 'privacy', this.el);
    privacy.append('Your name and email are not shown to other players. The ');
    const policy = el('a', undefined, privacy);
    policy.href = 'https://somethingbig.ai/privacy#world-game';
    policy.target = '_blank';
    policy.rel = 'noopener noreferrer';
    policy.textContent = 'Something Big privacy policy';
    privacy.append(' covers your player profile, saved progress, browser storage, and optional newsletter signup.');
    el('p', 'privacy disclaimer', this.el).textContent = 'Independent, free-to-play experimental tech demo. Not affiliated with or endorsed by Rockstar Games or Take-Two Interactive. Provided “as is”; bugs, interruptions, and progress resets may occur.';
    this.err = el('div', 'err', this.el);
    this.err.setAttribute('role', 'alert');
    const controls = el('div', 'controls', this.el);
    controls.innerHTML = controlsHtml();
    el('div', 'ver', this.el).textContent = `v${GAME_VERSION}`;
    form.addEventListener('focusin', () => stageBeacon('keyboard_focus'), { once: true });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = this.input.value.trim();
      if (name.length < 1) {
        this.err.textContent = 'Enter your name (up to 100 characters).';
        this.input.focus();
        return;
      }
      if (!this.email.validity.valid) { this.email.reportValidity(); return; }
      this.err.textContent = '';
      stageBeacon('submit');
      setNameFormUp(false);
      this.onSubmit(name, this.email.value.trim(), this.newsletter.checked);
    });
  }
  setError(message: string): void { this.err.textContent = message; }
  clear(): void { this.input.value = ''; this.email.value = ''; this.newsletter.checked = true; }
  show(prefill = lsGet(LS_NAME) ?? ''): void {
    if (this.visible) return;
    this.open();
    setNameFormUp(true);
    stageBeacon('form_shown');
    this.input.value = prefill;
    if (!isIOS()) setTimeout(() => this.input.focus(), 50);
  }
}
