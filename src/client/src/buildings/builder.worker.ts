/**
 * Geometry builder worker: receives a tile's buildings + roads, returns merged typed arrays (transferred).
 */
import { transfers } from './transfer';
import { buildTile, type BuildInput, type BuiltTile } from './builder';

export interface BuildRequest {
  id: number;
  input: BuildInput;
}
export interface BuildResponse {
  id: number;
  key: string;
  tile?: BuiltTile;
  error?: string;
}

self.onmessage = (e: MessageEvent<BuildRequest>) => {
  const { id, input } = e.data;
  try {
    const tile = buildTile(input);
    (self as unknown as Worker).postMessage({ id, key: input.key, tile } satisfies BuildResponse, transfers(tile));
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, key: input.key, error: String((err as Error)?.stack ?? err) } satisfies BuildResponse);
  }
};
