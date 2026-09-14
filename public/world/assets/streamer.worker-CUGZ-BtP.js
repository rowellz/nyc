(function(){
/**
 * Tile decode worker: fetch -> (gunzip if the bytes are gzip) -> JSON.parse -> post the object.
 * Handles both raw .json.gz bytes and servers that already decoded them (Content-Encoding: gzip
 * is transparently removed by the browser, so the magic bytes are the only reliable test).
 */










async function fetchAndDecode(url        , signal              )                                            {
  const res = await fetch(url, { cache: 'force-cache', signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  signal?.throwIfAborted();
  const text = await bytesToText(buf);
  signal?.throwIfAborted();
  return { tile: JSON.parse(text), bytes: buf.byteLength };
}

async function bytesToText(buf            )                  {
  const isGzip = buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  if (!isGzip) return new TextDecoder().decode(buf);
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream unsupported and tile is gzip');
  const stream = new Blob([buf            ]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

const isWorker = typeof (globalThis       ).WorkerGlobalScope !== 'undefined' && typeof (globalThis       ).importScripts !== 'undefined' || (typeof self !== 'undefined' && typeof (self       ).document === 'undefined');
if (isWorker) {
  const requests = new Map                         ();
  self.onmessage = async (e                             ) => {
    const { id } = e.data;
    if (e.data.type === 'cancel') { requests.get(id)?.abort(); requests.delete(id); return; }
    const { url } = e.data;
    const controller = new AbortController();
    requests.set(id, controller);
    const t0 = performance.now();
    try {
      const { tile, bytes } = await fetchAndDecode(url, controller.signal);
      if (controller.signal.aborted) return;
      (self       ).postMessage({ id, tile, bytes, ms: performance.now() - t0 }                         );
    } catch (err) {
      if (!controller.signal.aborted) (self       ).postMessage({ id, error: String((err         )?.message ?? err) }                         );
    } finally {
      requests.delete(id);
    }
  };
}

})();
