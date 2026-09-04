/**
 * Tile decode worker: fetch -> (gunzip if the bytes are gzip) -> JSON.parse -> post the object.
 * Handles both raw .json.gz bytes and servers that already decoded them (Content-Encoding: gzip
 * is transparently removed by the browser, so the magic bytes are the only reliable test).
 */
export interface DecodeRequest {
  id: number;
  url: string;
}
export interface DecodeResponse {
  id: number;
  tile?: unknown;
  error?: string;
  bytes?: number;
  ms?: number;
}

export async function fetchAndDecode(url: string): Promise<{ tile: unknown; bytes: number }> {
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const text = await bytesToText(buf);
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
  self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
    const { id, url } = e.data;
    const t0 = performance.now();
    try {
      const { tile, bytes } = await fetchAndDecode(url);
      (self as any).postMessage({ id, tile, bytes, ms: performance.now() - t0 } satisfies DecodeResponse);
    } catch (err) {
      (self as any).postMessage({ id, error: String((err as Error)?.message ?? err) } satisfies DecodeResponse);
    }
  };
}
