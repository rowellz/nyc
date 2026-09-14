/**
 * Tile decode worker: fetch -> (gunzip if the bytes are gzip) -> JSON.parse -> post the object.
 * Handles both raw .json.gz bytes and servers that already decoded them (Content-Encoding: gzip
 * is transparently removed by the browser, so the magic bytes are the only reliable test).
 */
export type DecodeRequest = { id: number; url: string; type?: never }
  | { id: number; type: 'cancel' };
export interface DecodeResponse {
  id: number;
  tile?: unknown;
  error?: string;
  bytes?: number;
  ms?: number;
}

export async function fetchAndDecode(url: string, signal?: AbortSignal): Promise<{ tile: unknown; bytes: number }> {
  const res = await fetch(url, { cache: 'force-cache', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  signal?.throwIfAborted();
  const text = await bytesToText(buf);
  signal?.throwIfAborted();
  return { tile: JSON.parse(text), bytes: buf.byteLength };
}

export async function bytesToText(buf: Uint8Array): Promise<string> {
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(buf);
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unsupported and tile is gzip');
  const stream = new Blob([buf as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

const isWorker = typeof (globalThis as any).WorkerGlobalScope !== 'undefined' && typeof (globalThis as any).importScripts !== 'undefined' || (typeof self !== 'undefined' && typeof (self as any).document === 'undefined');
if (isWorker) {
  const requests = new Map<number, AbortController>();
  self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
    const { id } = e.data;
    if (e.data.type === 'cancel') { requests.get(id)?.abort(); requests.delete(id); return; }
    const { url } = e.data;
    const controller = new AbortController();
    requests.set(id, controller);
    const t0 = performance.now();
    try {
      const { tile, bytes } = await fetchAndDecode(url, controller.signal);
      if (controller.signal.aborted) return;
      (self as any).postMessage({ id, tile, bytes, ms: performance.now() - t0 } satisfies DecodeResponse);
    } catch (err) {
      if (!controller.signal.aborted) (self as any).postMessage({ id, error: String((err as Error)?.message ?? err) } satisfies DecodeResponse);
    } finally {
      requests.delete(id);
    }
  };
}
