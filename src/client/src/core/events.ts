/**
 * Typed event bus. One listener throwing never prevents the others from running.
 */
import type { EventBus, EventMap } from './context';

type AnyFn = (...args: any[]) => void;

export class TypedEventBus implements EventBus {
  private listeners = new Map<keyof EventMap, Set<AnyFn>>();
  /** number of emits per event name since start (debug overlay) */
  readonly counts = new Map<keyof EventMap, number>();

  on<K extends keyof EventMap>(ev: K, fn: EventMap[K]): () => void {
    let set = this.listeners.get(ev);
    if (!set) {
      set = new Set();
      this.listeners.set(ev, set);
    }
    set.add(fn as AnyFn);
    return () => this.off(ev, fn);
  }

  once<K extends keyof EventMap>(ev: K, fn: EventMap[K]): () => void {
    const off = this.on(ev, ((...args: any[]) => {
      off();
      (fn as AnyFn)(...args);
    }) as EventMap[K]);
    return off;
  }

  off<K extends keyof EventMap>(ev: K, fn: EventMap[K]): void {
    this.listeners.get(ev)?.delete(fn as AnyFn);
  }

  emit<K extends keyof EventMap>(ev: K, ...args: Parameters<EventMap[K]>): void {
    this.counts.set(ev, (this.counts.get(ev) ?? 0) + 1);
    const set = this.listeners.get(ev);
    if (!set || set.size === 0) return;
    // copy so listeners may unsubscribe themselves during emit
    for (const fn of Array.from(set)) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[events] listener for "${String(ev)}" threw`, err);
      }
    }
  }

  listenerCount(ev: keyof EventMap): number {
    return this.listeners.get(ev)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
