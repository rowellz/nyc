/** Fetch, inflate, validate and measure geometry away from the animation thread.
 * The streamer bounds concurrent requests, including decoded replies. */
export function createSceneryTransport(makeWorker = () => new Worker(new URL('./scenery.worker.js', import.meta.url), { type: 'module', name: 'scenery' })) {
  let worker = null, serial = 0, disposed = false;
  const pending = new Map();
  function finish(id, error, chunk) {
    const request = pending.get(id);
    if (!request) return;
    pending.delete(id); request.signal.removeEventListener('abort', request.abort);
    error ? request.reject(error) : request.resolve(chunk);
  }
  function stop(error) {
    worker?.terminate(); worker = null;
    for (const id of pending.keys()) finish(id, error);
  }
  return {
    load(url, key, tier, signal) {
      if (disposed || signal.aborted) return Promise.reject(new Error('Scenery cancelled'));
      return new Promise((resolve, reject) => {
        try {
          if (!worker) {
            worker = makeWorker();
            worker.onmessage = ({ data }) => finish(data.id, data.error ? new Error(data.error) : null, data.chunk);
            worker.onerror = () => stop(new Error('Scenery worker failed'));
            worker.onmessageerror = () => stop(new Error('Invalid scenery worker reply'));
          }
          const id = ++serial;
          const abort = () => { worker?.postMessage({ type: 'cancel', id }); finish(id, new Error('Scenery cancelled')); };
          pending.set(id, { resolve, reject, signal, abort });
          signal.addEventListener('abort', abort, { once: true });
          worker.postMessage({ type: 'load', id, url, key, tier });
        } catch (error) { stop(error); reject(error); }
      });
    },
    dispose() { disposed = true; stop(new Error('Scenery disposed')); },
  };
}
