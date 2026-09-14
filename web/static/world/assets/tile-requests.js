/** Own the lifetime of each tile fetch/decode, including worker callbacks.
 * A request slot lasts until publication; its network deadline ends on decode. */
export const TILE_REQUEST_TIMEOUT_MS = 30000;
export function installTileRequests(world) {
  const pending = new Map();
  const unloadAll = world.unloadAll;
  world.decode = function (key, url) {
    const id = ++this.reqSeq;
    const loadId = this.inFlight.get(key);
    let worker;
    if (this.workers.length) {
      let slot = 0;
      for (let i = 1; i < this.workerLoads.length; i++) if (this.workerLoads[i] < this.workerLoads[slot]) slot = i;
      worker = this.workers[slot];
      this.workerLoads[slot]++;
    }
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
      let done = false, timer;
      const finish = (error, tile) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (pending.get(key)?.id === id) pending.delete(key);
        // Normal replies already release their callback and worker load in
        // onWorkerMessage. Cancellation must perform that same cleanup itself.
        if (this.reqCallbacks.get(id) === callback) {
          this.reqCallbacks.delete(id);
          const slot = this.workers.indexOf(worker);
          if (slot >= 0) this.workerLoads[slot] = Math.max(0, this.workerLoads[slot] - 1);
        }
        error ? reject(error) : resolve(tile);
      };
      const stop = error => {
        controller.abort();
        if (worker) {
          try { worker.postMessage({ type: 'cancel', id }); } catch { /* dead worker */ }
        }
        finish(error);
      };
      const callback = { key, resolve: tile => finish(null, tile), reject: error => finish(error) };
      pending.set(key, { id, cancel: () => {
        // Invalidate the publication token BEFORE rejecting, so cancelling a
        // stale area neither marks it failed nor interferes with a later visit.
        if (this.inFlight.get(key) === loadId) this.inFlight.delete(key);
        stop(new Error('Tile request superseded'));
      } });
      timer = setTimeout(() => {
        if (done) return;
        stop(new Error(`Tile request timed out after ${TILE_REQUEST_TIMEOUT_MS / 1000}s`));
        // A decoder stuck in synchronous work cannot process a cancel message.
        // Restart the pool; its other callbacks reject through normal retries.
        if (worker && this.workers.includes(worker)) {
          this.killWorkers();
          if (!this.disposed) this.spawnWorkers();
        }
      }, TILE_REQUEST_TIMEOUT_MS);
      if (worker) {
        this.reqCallbacks.set(id, callback);
        try { worker.postMessage({ id, url }); } catch (error) { finish(error); }
      } else {
        const started = performance.now();
        void (async () => {
          const response = await fetch(url, { cache: 'force-cache', signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (done) return;
          const gzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
          const text = gzip
            ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
            : new TextDecoder().decode(bytes);
          if (done) return;
          const tile = JSON.parse(text);
          this.stats.bytes += bytes.byteLength;
          this.stats.decodeMs += performance.now() - started;
          finish(null, tile);
        })().catch(error => finish(error));
      }
    });
  };
  const cancelExcept = wanted => {
    for (const [key, request] of pending) if (!wanted.has(key)) request.cancel();
  };
  world.unloadAll = function () {
    cancelExcept(new Set());
    unloadAll.call(this);
  };
  return cancelExcept;
}
