/** Run the author's Canvas2D mask painter off the render thread. */
import { MaskPainter } from './mask';
import type { Building, RoadSegment, Tile } from '@shared/world';

export interface MaskJob { id: number; tile: Tile; roads: RoadSegment[]; buildings: Building[] }
export interface MaskResult { id: number; key: string; data?: Uint8ClampedArray; error?: string }

const scope = self as unknown as DedicatedWorkerGlobalScope;
let current: MaskJob;
const painter = new MaskPainter({ world: { roadsNear: () => current.roads, buildingsNear: () => current.buildings } });
scope.onmessage = (event: MessageEvent<MaskJob>) => {
  current = event.data;
  try {
    const mask = painter.paint(current.tile);
    mask.tex.dispose(); // CPU-only texture; the renderer owns the uploaded copy.
    scope.postMessage({ id: current.id, key: current.tile.key, data: mask.data } satisfies MaskResult, [mask.data.buffer]);
  } catch (error) {
    scope.postMessage({ id: current.id, key: current.tile.key, error: String(error) } satisfies MaskResult);
  }
};
