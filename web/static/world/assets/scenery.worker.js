import { decodeScenery, prepareSceneryGeometry, readSceneryBuffer } from './scenery-format.js';
const requests = new Map();
self.onmessage = async ({ data }) => {
  if (data.type === 'cancel') { requests.get(data.id)?.abort(); return; }
  const controller = new AbortController(); requests.set(data.id, controller);
  try {
    const response = await fetch(data.url, { signal: controller.signal, cache: 'force-cache' });
    if (!response.ok) throw Error(`Scenery HTTP ${response.status}`);
    const buffer = await readSceneryBuffer(response.body.pipeThrough(new DecompressionStream('gzip')), data.maxBytes);
    controller.signal.throwIfAborted();
    const chunk = decodeScenery(buffer);
    if (chunk.key !== data.key || chunk.tier !== data.tier) throw Error('Wrong scenery chunk');
    prepareSceneryGeometry(chunk);
    const transfers = new Set([buffer]);
    for (const layer of chunk.layers) transfers.add(layer.renderIndex.buffer);
    self.postMessage({ id: data.id, chunk }, [...transfers]);
  } catch (error) {
    self.postMessage({ id: data.id, error: String(error.message) });
  } finally { requests.delete(data.id); }
};
