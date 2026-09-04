import type { GameContext, GameModule } from '@/core/context';
import type * as THREE from 'three';

/** Optional completion report; a static list of intended landmarks is not evidence of a model. */
interface LandmarkBuildReport extends GameModule {
  builtBins?: ReadonlySet<number>;
  built?: ReadonlySet<number>;
}

export interface LandmarkRange { bin: number; start: number; count: number }

export function reportedLandmarks(ctx: GameContext): ReadonlySet<number> | undefined {
  const mod = ctx.modules.get('landmarks') as LandmarkBuildReport | undefined;
  return mod?.builtBins ?? mod?.built;
}

/** Keep the original indices for reversibility when a replacement is unloaded or fails. */
export function visibleIndices(indices: Uint32Array, ranges: LandmarkRange[], built: ReadonlySet<number>): Uint32Array {
  let removed = 0;
  for (const r of ranges) if (built.has(r.bin)) removed += r.count;
  if (!removed) return indices;
  const out = new Uint32Array(indices.length - removed);
  let read = 0, write = 0;
  for (const r of ranges) {
    if (!built.has(r.bin)) continue;
    out.set(indices.subarray(read, r.start), write);
    write += r.start - read;
    read = r.start + r.count;
  }
  out.set(indices.subarray(read), write);
  return out;
}

/** Reuse the GPU index buffer on completion/unload; no new draw calls or orphaned WebGL buffers. */
export function applyLandmarkVisibility(geometry: THREE.BufferGeometry, indices: Uint32Array, ranges: LandmarkRange[], built: ReadonlySet<number>): void {
  const visible = visibleIndices(indices, ranges, built);
  if (ranges.length) {
    (geometry.index!.array as Uint32Array).set(visible);
    geometry.index!.needsUpdate = true;
  }
  geometry.setDrawRange(0, visible.length);
}
