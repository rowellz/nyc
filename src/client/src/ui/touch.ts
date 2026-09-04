import type { InputManager } from '@/core/input';

/** Pointer capture gives each finger its own joystick, look or button gesture. */
export class TouchControls {
  readonly el = document.createElement('div');
  private cleanups: (() => void)[] = [];
  private visible = false;
  constructor(private root: HTMLElement, private input: InputManager) {
    this.el.id = 'touch-controls'; this.el.hidden = true;
    if (!input.touch) return;
    const style = document.createElement('style');
    style.textContent = `
#touch-controls {position:absolute;inset:0;pointer-events:none;z-index:20;user-select:none}
#touch-controls[hidden] {display:none}
#touch-controls .stick {position:absolute;left:22px;bottom:max(25px,env(safe-area-inset-bottom));width:116px;height:116px;border-radius:50%;background:#11202e99;border:2px solid #ffffff77;touch-action:none;pointer-events:auto}
#touch-controls .knob {position:absolute;left:36px;top:36px;width:40px;height:40px;border-radius:50%;background:#ffffffaa;pointer-events:none}
#touch-controls .look {position:absolute;right:0;top:18%;width:48%;height:56%;touch-action:none;pointer-events:auto}
#touch-controls .actions {position:absolute;right:14px;bottom:max(24px,env(safe-area-inset-bottom));display:grid;grid-template-columns:64px 64px;gap:10px}
#touch-controls button {height:58px;border-radius:18px;background:#152635db;color:white;border:1px solid #ffffff88;font:600 12px system-ui;touch-action:none;pointer-events:auto}
#nyc[data-touch="active"] .bl {top:max(12px,env(safe-area-inset-top));bottom:auto;left:max(12px,env(safe-area-inset-left));gap:3px;width:140px}
#nyc[data-touch="active"] .minimap {border-radius:7px}
#nyc[data-touch="active"] .bars {width:140px;gap:2px}
#nyc[data-touch="active"] .bar {height:6px}
#nyc[data-touch="active"] .bar.armor {height:3px}
#nyc[data-touch="active"] .loc {width:140px;min-height:0}
#nyc[data-touch="active"] .loc .street {font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nyc[data-touch="active"] .loc .area {font-size:9px;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#nyc[data-touch="active"] .chips {gap:3px;min-height:0;flex-wrap:wrap}
#nyc[data-touch="active"] .chip {font-size:10px;padding:2px 4px;letter-spacing:.02em}
#nyc[data-touch="active"] .stats {display:none}
#nyc[data-touch="active"] .tr {right:12px;top:max(12px,env(safe-area-inset-top))}
#nyc[data-touch="active"] .score-val {font-size:30px}
#nyc[data-touch="active"] .online {font-size:10px}
#nyc[data-touch="active"] .tc {top:168px;left:12px;right:12px;transform:none;gap:3px}
#nyc[data-touch="active"] .banner {font-size:10px;padding:5px 8px;max-width:100%;text-align:center}
#nyc[data-touch="active"] .toast {font-size:14px;padding:4px 8px;max-width:100%;text-align:center}
#nyc[data-touch="active"] .tl {top:202px;left:12px;max-width:calc(100vw - 24px)}
#nyc[data-touch="active"] .feed .row {font-size:10px;padding:3px 6px}
#nyc[data-touch="active"] .br {bottom:max(170px,calc(env(safe-area-inset-bottom) + 145px));right:14px;max-width:45vw}
#nyc[data-touch="active"] .bc {bottom:155px;max-width:80vw}
@media (max-height:500px) {#nyc[data-touch="active"] .loc,#nyc[data-touch="active"] .tl {display:none}}
`;
    this.el.appendChild(style);
    const stick = document.createElement('div'); stick.className = 'stick'; stick.setAttribute('aria-label', 'Move joystick');
    const knob = document.createElement('div'); knob.className = 'knob'; stick.appendChild(knob);
    const look = document.createElement('div'); look.className = 'look'; look.setAttribute('aria-label', 'Drag to look');
    const actions = document.createElement('div'); actions.className = 'actions';
    this.el.append(stick, look, actions); root.appendChild(this.el);
    const setStick = (e: PointerEvent) => {
      const r = stick.getBoundingClientRect(); let x = (e.clientX - r.left - r.width / 2) / 42, y = (e.clientY - r.top - r.height / 2) / 42;
      const length = Math.max(1, Math.hypot(x, y)); x /= length; y /= length;
      input.setTouchMove(x, -y); knob.style.transform = `translate(${x * 36}px,${y * 36}px)`;
    };
    this.gesture(stick, setStick, setStick, () => { input.setTouchMove(0, 0); knob.style.transform = ''; });
    let lx = 0, ly = 0;
    this.gesture(look, e => { lx = e.clientX; ly = e.clientY; }, e => {
      input.addTouchLook(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY;
    }, () => {});
    for (const [label, code] of [['Jump', 'Space'], ['Interact', 'KeyE'], ['Fire', 'fire'], ['Reload', 'KeyR']]) {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.setAttribute('aria-label', label);
      actions.appendChild(b); this.gesture(b, () => input.touchButton(code, true), () => {}, () => input.touchButton(code, false));
    }
    const release = () => this.reset();
    window.addEventListener('blur', release);
    this.cleanups.push(() => window.removeEventListener('blur', release));
  }
  private resets: (() => void)[] = [];
  private gesture(el: HTMLElement, down: (e: PointerEvent) => void, move: (e: PointerEvent) => void, up: () => void): void {
    let id: number | null = null;
    const end = () => { id = null; up(); };
    el.addEventListener('pointerdown', e => {
      if (id !== null || !this.visible) return;
      e.preventDefault(); id = e.pointerId; el.setPointerCapture(id); down(e);
    });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) { e.preventDefault(); move(e); } });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(event, e => { if ((e as PointerEvent).pointerId === id) end(); });
    this.resets.push(end);
  }
  private reset(): void { for (const end of this.resets) end(); }
  update(active: boolean): void {
    active = active && this.input.touch;
    if (active === this.visible) return;
    this.visible = active; this.el.hidden = !active;
    if (active) this.root.dataset.touch = 'active';
    else delete this.root.dataset.touch;
    if (!active) this.reset();
  }
  dispose(): void { this.reset(); this.cleanups.forEach(f => f()); delete this.root.dataset.touch; this.el.remove(); }
}
