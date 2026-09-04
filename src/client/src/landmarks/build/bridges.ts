import * as THREE from 'three';
import { Frame, GeoBuilder, LineBuilder, parabola, type StyleSpec } from '../geom';
import { BROOKLYN_BRIDGE, MANHATTAN_BRIDGE, WILLIAMSBURG_BRIDGE } from '../data';
import { STYLE } from '../materials';
import type { Ring } from '@shared/world';

export type BridgeName = 'brooklyn' | 'manhattan' | 'williamsburg';

/** Yield between tower/cable builds so streaming cannot build an entire suspension bridge in one frame. */
export function* buildBridge(name: BridgeName, detailed: boolean) {
  const b = name === 'brooklyn' ? BROOKLYN_BRIDGE : name === 'manhattan' ? MANHATTAN_BRIDGE : WILLIAMSBURG_BRIDGE;
  const f = Frame.fromBearing(b.cx, b.cz, b.bearing);
  const body = new GeoBuilder(), lines = new LineBuilder();
  const colliders: { ring: Ring; y0: number; y1: number }[] = [];
  const granite: StyleSpec = { style: STYLE.GRANITE, p: [0, 0, 0, 0], p2: [0, 0, 1, 0] };
  const steel: StyleSpec = { style: STYLE.PAINT, p: name === 'manhattan' ? [0.19, 0.3, 0.4, 0.5] : [0.28, 0.3, 0.31, 0.6] };
  const road: StyleSpec = { style: STYLE.ASPHALT, p: [0, 0, 0, 0] };
  const wood: StyleSpec = { style: STYLE.WOOD, p: [0, 0, 0, 0] };
  const length = b.halfSpan + b.sideSpan;
  const deckY = b.deckMid;
  const p = (u: number, y: number, v: number) => { const q = f.toWorld(u, v); return new THREE.Vector3(q[0], y, q[1]); };
  const box = (u: number, y: number, v: number, du: number, dy: number, dv: number, style: StyleSpec) => {
    const q = f.toWorld(u, v);
    body.box(q[0], y, q[1], du, dy, dv, f.angle, style, style);
  };
  for (const u of [-b.halfSpan, b.halfSpan]) {
    if (name === 'brooklyn') {
      // Three granite piers leave two Gothic openings above the roadway.
      for (const v of [-12, 0, 12]) {
        box(u, 32, v, 8, 64, 4, granite);
        colliders.push({ ring: f.rect(u - 4, u + 4, v - 2, v + 2), y0: 0, y1: 64 });
      }
      for (const v of [-6, 6]) {
        for (let i = 0; i < 16; i++) {
          const x = -4 + 8 * (i + 0.5) / 16;
          const underside = 64 + 10 * (1 - Math.abs(x) / 4);
          box(u, (underside + b.towerH) / 2, v + x, 8, b.towerH - underside, 0.5, granite);
        }
      }
      box(u, b.towerH - 1, 0, 9, 2, 29, granite);
    } else {
      for (const v of [-b.deckW / 2, b.deckW / 2]) {
        box(u, b.towerH / 2, v, 6, b.towerH, 6, steel);
        colliders.push({ ring: f.rect(u - 3, u + 3, v - 3, v + 3), y0: 0, y1: b.towerH });
      }
      for (const y of [deckY + 12, b.towerH - 5]) box(u, y, 0, 5, 5, b.deckW, steel);
      lines.seg(p(u, deckY + 15, -b.deckW / 2), p(u, b.towerH - 8, b.deckW / 2));
      lines.seg(p(u, deckY + 15, b.deckW / 2), p(u, b.towerH - 8, -b.deckW / 2));
    }
    yield;
  }
  // The streets fallback is only 7–18 m high; provide a 41 m roadway and raised central promenade.
  // Flat side spans/anchor transitions are deliberately coarse; this is not a surveyed road alignment.
  const deck = f.rect(-length, length, -b.deckW / 2, b.deckW / 2);
  body.prism(deck, deckY - 1.5, deckY, steel, road);
  const promenade = f.rect(-length, length, -2.5, 2.5);
  body.prism(promenade, deckY, deckY + 0.2, steel, name === 'brooklyn' ? wood : road);
  for (const v of [-b.deckW / 2, -2.5, 2.5, b.deckW / 2]) {
    lines.seg(p(-length, deckY + 1.3, v), p(length, deckY + 1.3, v));
    for (let u = -length; u < length; u += detailed ? 6 : 12) lines.seg(p(u, deckY, v), p(u, deckY + 1.3, v));
  }
  yield;
  for (const v of [-b.deckW / 2, -b.deckW / 2 + 3, b.deckW / 2 - 3, b.deckW / 2]) {
    const spans: [number, number, number, number, number][] = [
      [-length, deckY + 4, -b.halfSpan, b.towerH, 10],
      [-b.halfSpan, b.towerH, b.halfSpan, b.towerH, b.towerH - deckY - 8],
      [b.halfSpan, b.towerH, length, deckY + 4, 10],
    ];
    for (const [u0, h0, u1, h1, sag] of spans) {
      const cable = parabola(p(u0, h0, v), p(u1, h1, v), sag, detailed ? 32 : 16);
      body.tube(cable, name === 'brooklyn' ? 0.2 : 0.3, 5, steel);
      const spacing = detailed ? 10 : 20;
      for (let u = u0 + spacing; u < u1; u += spacing) {
        const t = (u - u0) / (u1 - u0);
        const y = h0 + (h1 - h0) * t - 4 * sag * t * (1 - t);
        lines.seg(p(u, deckY, v), p(u, y, v));
      }
    }
    if (name === 'brooklyn') for (const tower of [-b.halfSpan, b.halfSpan]) {
      for (const sign of [-1, 1]) for (let d = 25; d <= 175; d += 25) lines.seg(p(tower, b.towerH - 4, v), p(tower + sign * d, deckY, v));
    }
    yield;
  }
  return { body, lines, colliders, center: [b.cx, b.cz] as [number, number], decks: [{ ring: deck, height: deckY }, { ring: promenade, height: deckY + 0.2 }] };
}
