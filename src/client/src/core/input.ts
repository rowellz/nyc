/**
 * Input. Keyboard/mouse (pointer lock) + optional gamepad. Events accumulate into a pending buffer;
 * `beginFrame()` (called by the loop before any module update) publishes them for the frame, so every
 * module sees the same edge flags and look deltas. Edge flags are true for exactly one frame.
 *
 * Mapping: WASD run, Shift sprint, Ctrl/Alt walk, C crouch, Space jump / handbrake, E interact,
 * R reload, F horn, H headlights, V camera, M map, Tab leaderboard (held), 1-4 weapon slots,
 * wheel next/prev weapon, LMB fire, RMB aim. Vehicle throttle/steer are smoothed from W/S and A/D.
 */
import type { InputState } from './context';

const CAPTURE_KEYS = new Set(['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class InputManager implements InputState {
  move = { x: 0, y: 0 };
  sprint = false;
  jump = false;
  crouch = false;
  aim = false;
  fire = false;
  firePressed = false;
  reload = false;
  interact = false;
  weaponSlot = 0;
  nextWeapon = 0;
  look = { dx: 0, dy: 0 };
  handbrake = false;
  horn = false;
  map = false;
  leaderboard = false;
  pointerLocked = false;
  throttle = 0;
  steer = 0;
  headlights = false;
  camToggle = false;
  keys = new Set<string>();
  gamepad = false;

  /** when false (screenshot mode), the published state stays neutral and pointer lock is never requested */
  enabled = true;
  flying = false;
  blocked = false;
  readonly touch = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
  private touchMove = { x: 0, y: 0 };
  /** mouse sensitivity multiplier applied to look deltas */
  sensitivity = 1;
  /** DOM element that owns pointer lock */
  readonly target: HTMLElement;

  private pendingEdges = new Set<string>();
  private pendingLook = { dx: 0, dy: 0 };
  private pendingWheel = 0;
  private mouseButtons = 0;
  private pendingFirePress = false;
  private lastPad: { axes: number[]; buttons: boolean[] } | null = null;
  private padEdges = new Set<string>();
  private wantLock = false;
  private lockPending = false;
  private disposers: (() => void)[] = [];
  private lastT = performance.now();

  constructor(target: HTMLElement, opts: { enabled?: boolean } = {}) {
    this.target = target;
    this.enabled = opts.enabled ?? true;
    const add = <K extends keyof WindowEventMap>(el: Window | Document | HTMLElement, ev: K | string, fn: (e: any) => void, options?: AddEventListenerOptions) => {
      el.addEventListener(ev as string, fn, options);
      this.disposers.push(() => el.removeEventListener(ev as string, fn, options));
    };

    add(window, 'keydown', (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (CAPTURE_KEYS.has(e.code) || /^(Digit[1-4]|Key[ERFHVM])$/.test(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pendingEdges.add(e.code);
    });
    add(window, 'keyup', (e: KeyboardEvent) => {
      this.keys.delete(e.code);
    });
    add(window, 'blur', () => this.releaseAll());
    add(document, 'visibilitychange', () => {
      if (document.hidden) this.releaseAll();
    });

    add(target, 'mousedown', (e: MouseEvent) => {
      if (!this.enabled) return;
      if (!this.pointerLocked) {
        this.requestLock();
        return; // the click that locks the pointer is not a shot
      }
      this.mouseButtons |= 1 << e.button;
      if (e.button === 0) this.pendingFirePress = true;
      e.preventDefault();
    });
    add(window, 'mouseup', (e: MouseEvent) => {
      this.mouseButtons &= ~(1 << e.button);
    });
    add(target, 'contextmenu', (e: Event) => e.preventDefault());
    add(window, 'mousemove', (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      // Chrome occasionally reports huge deltas right after locking; drop them
      const dx = e.movementX;
      const dy = e.movementY;
      if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
      this.pendingLook.dx += dx;
      this.pendingLook.dy += dy;
    });
    add(
      target,
      'wheel',
      (e: WheelEvent) => {
        if (!this.pointerLocked) return;
        e.preventDefault();
        this.pendingWheel += Math.sign(e.deltaY);
      },
      { passive: false },
    );
    add(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === target;
      this.lockPending = false;
      if (!this.pointerLocked) this.releaseAll();
      else if (!this.wantLock) this.releaseLock(); // a cancelled in-flight request completed
    });
    add(document, 'pointerlockerror', () => {
      this.lockPending = false;
    });
    add(window, 'gamepadconnected', (e: GamepadEvent) => {
      console.info('[input] gamepad connected:', e.gamepad.id);
      this.gamepad = true;
    });
    add(window, 'gamepaddisconnected', () => {
      this.gamepad = false;
      this.lastPad = null;
    });
  }

  /** ask for pointer lock (only when enabled). Safe to call every click. */
  requestLock(fromOverlay = false): void {
    if ((!this.enabled && !fromOverlay) || this.blocked || this.touch || document.pointerLockElement === this.target || this.lockPending) return;
    this.wantLock = true;
    this.lockPending = true;
    try {
      // One synchronous request in the actual click gesture. Raw-mouse fallback in a rejected
      // promise loses activation on some browsers; a cooldown also used to swallow Resume.
      const p = this.target.requestPointerLock();
      if (p && typeof p.catch === 'function') void p.catch(() => { this.lockPending = false; });
    } catch {
      this.lockPending = false; // unsupported/denied: keep playing with the click-to-lock hint
    }
  }

  releaseLock(): void {
    this.wantLock = false;
    if (document.pointerLockElement === this.target) document.exitPointerLock();
  }

  /** Playtest mouse button input without pointer lock; uses the same frame buffer as DOM input. */
  debugMouseButton(button: number, down: boolean): void {
    if (!Number.isInteger(button) || button < 0 || button > 2) throw new Error('Invalid mouse button');
    if (down) {
      if (!this.enabled || this.blocked) throw new Error('Game input is disabled');
      this.mouseButtons |= 1 << button;
      if (button === 0) this.pendingFirePress = true;
    } else {
      this.mouseButtons &= ~(1 << button);
    }
  }

  setTouchMove(x: number, y: number): void {
    if (!this.enabled || this.blocked) { this.touchMove.x = this.touchMove.y = 0; return; }
    this.touchMove.x = x; this.touchMove.y = y;
  }
  addTouchLook(dx: number, dy: number): void {
    if (this.enabled && !this.blocked) { this.pendingLook.dx += dx; this.pendingLook.dy += dy; }
  }
  touchButton(code: string, down: boolean): void {
    if (down && (!this.enabled || this.blocked)) return;
    if (code === 'fire') { this.debugMouseButton(0, down); return; }
    if (down) { this.keys.add(code); this.pendingEdges.add(code); }
    else this.keys.delete(code);
  }
  releaseAll(): void {
    this.keys.clear();
    this.mouseButtons = 0;
    this.touchMove.x = this.touchMove.y = 0;
    this.pendingLook.dx = this.pendingLook.dy = 0;
    this.pendingEdges.clear();
    this.pendingFirePress = false;
  }

  /** publish pending input for this frame. Called once per frame by the loop before module updates. */
  beginFrame(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;

    const k = this.keys;
    const edges = this.pendingEdges;
    const pad = this.pollGamepad();

    if (this.blocked) this.releaseAll();
    if (!this.enabled || this.flying || this.blocked) {
      // screenshot / free-fly mode: publish nothing. The fly camera reads `keys` + raw look itself.
      this.move.x = this.move.y = 0;
      this.sprint = this.jump = this.crouch = this.aim = this.fire = this.firePressed = false;
      this.reload = this.interact = this.map = this.leaderboard = this.headlights = this.camToggle = this.handbrake = this.horn = false;
      this.weaponSlot = 0;
      this.nextWeapon = 0;
      this.look.dx = this.pendingLook.dx;
      this.look.dy = this.pendingLook.dy;
      this.pendingLook.dx = this.pendingLook.dy = 0;
      this.pendingWheel = 0;
      this.pendingFirePress = false;
      edges.clear();
      this.throttle = this.steer = 0;
      return;
    }

    let mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let my = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    mx += this.touchMove.x; my += this.touchMove.y;
    if (pad) {
      if (Math.abs(pad.axes[0]) > 0.15 || Math.abs(pad.axes[1]) > 0.15) {
        mx = pad.axes[0];
        my = -pad.axes[1];
      }
    }
    const len = Math.hypot(mx, my);
    if (len > 1) {
      mx /= len;
      my /= len;
    }
    this.move.x = mx;
    this.move.y = my;

    this.sprint = k.has('ShiftLeft') || k.has('ShiftRight') || !!pad?.buttons[10];
    // A gentle stick magnitude selects PLAYER_WALK_SPEED in the existing controller.
    // Keep throttle full-strength: walking modifiers must not slow a car.
    const walking = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight'].some(code => k.has(code));
    if (walking && len > 0) {
      this.move.x = mx * 0.4;
      this.move.y = my * 0.4;
      this.sprint = false;
    }
    this.crouch = k.has('KeyC') || !!pad?.buttons[1];
    this.handbrake = k.has('Space') || !!pad?.buttons[0];
    this.horn = k.has('KeyF') || !!pad?.buttons[3];
    this.leaderboard = k.has('Tab') || !!pad?.buttons[8];
    this.aim = (this.mouseButtons & 4) !== 0 || (pad ? pad.axes.length > 4 && false : false) || !!pad?.buttons[6];
    this.fire = (this.mouseButtons & 1) !== 0 || !!pad?.buttons[7];

    this.jump = edges.has('Space') || this.padEdges.has('b0');
    this.firePressed = this.pendingFirePress || this.padEdges.has('b7');
    this.reload = edges.has('KeyR') || this.padEdges.has('b2');
    this.interact = edges.has('KeyE') || this.padEdges.has('b3');
    this.map = edges.has('KeyM') || this.padEdges.has('b9');
    this.headlights = edges.has('KeyH');
    this.camToggle = edges.has('KeyV') || this.padEdges.has('b11');
    this.weaponSlot = edges.has('Digit1') ? 1 : edges.has('Digit2') ? 2 : edges.has('Digit3') ? 3 : edges.has('Digit4') ? 4 : 0;
    let wheel = Math.sign(this.pendingWheel);
    if (this.padEdges.has('b5')) wheel = 1;
    else if (this.padEdges.has('b4')) wheel = -1;
    this.nextWeapon = wheel;

    this.look.dx = this.pendingLook.dx * this.sensitivity;
    this.look.dy = this.pendingLook.dy * this.sensitivity;
    if (pad && (Math.abs(pad.axes[2]) > 0.15 || Math.abs(pad.axes[3]) > 0.15)) {
      // right stick -> synthetic pixels/frame at 60 Hz ≈ 12 px per full deflection
      this.look.dx += pad.axes[2] * 720 * dt;
      this.look.dy += pad.axes[3] * 720 * dt;
    }

    // vehicle axes: smoothed
    let tTarget = my;
    let sTarget = mx;
    if (pad) {
      const gas = pad.buttons[7] ? 1 : 0; // RT
      const brake = pad.buttons[6] ? 1 : 0; // LT
      if (gas || brake) tTarget = gas - brake;
    }
    this.throttle = approach(this.throttle, tTarget, tTarget === 0 ? 6 * dt : 3 * dt);
    this.steer = approach(this.steer, sTarget, sTarget === 0 ? 7 * dt : 4.5 * dt);

    // clear pending
    this.pendingLook.dx = this.pendingLook.dy = 0;
    this.pendingWheel = 0;
    this.pendingFirePress = false;
    edges.clear();
    this.padEdges.clear();
  }

  /** raw look delta accumulated since last frame WITHOUT consuming it (used by the free-fly camera in screenshot mode) */
  peekLook(): { dx: number; dy: number } {
    return this.look;
  }

  private pollGamepad(): { axes: number[]; buttons: boolean[] } | null {
    if (!this.gamepad || typeof navigator.getGamepads !== 'function') return null;
    let gp: Gamepad | null = null;
    for (const g of navigator.getGamepads()) {
      if (g && g.connected) {
        gp = g;
        break;
      }
    }
    if (!gp) return null;
    const axes = Array.from(gp.axes);
    const buttons = gp.buttons.map((b) => b.pressed || b.value > 0.5);
    if (this.lastPad) {
      for (let i = 0; i < buttons.length; i++) if (buttons[i] && !this.lastPad.buttons[i]) this.padEdges.add('b' + i);
    }
    this.lastPad = { axes, buttons };
    return this.lastPad;
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
  }
}

function approach(v: number, target: number, step: number): number {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}
