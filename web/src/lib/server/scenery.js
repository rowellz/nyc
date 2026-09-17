import path from 'node:path';
import { readFile } from 'node:fs/promises';

/** Production only reads prepared meshes. Development builds requested chunks
 * lazily, with a bounded cache; it never sends source tiles to a skyline worker. */
export function createSceneryService(publicDir, preparedDir) {
  let manifestPromise, compilerPromise;
  const cache = new Map();
  const compiler = () => compilerPromise ??= import('./scenery-compiler.js').then(async module => ({ ...module, tools: await module.sceneryTools(publicDir) }));
  async function manifest() {
    if (!manifestPromise) manifestPromise = (async () => {
      if (preparedDir) return JSON.parse(await readFile(path.join(preparedDir, 'scenery/manifest.json'), 'utf8'));
      const { sceneryChunks } = await compiler();
      const index = JSON.parse(await readFile(path.join(publicDir, 'world/world/index.json'), 'utf8'));
      return { version: 1, chunkSize: 1024, revision: 'development', chunks: [...sceneryChunks(index.tiles)].map(([key, tiles]) => ({ key, tiles })) };
    })().catch(error => { manifestPromise = null; throw error; });
    return manifestPromise;
  }
  return async (rel, options = {}) => {
    const match = /^world\/world\/lod\/(manifest\.json|(-?\d+_-?\d+)\.(mid|far)\.bin)$/.exec(rel);
    if (!match) return null;
    try {
      const index = await manifest();
      let body, headers = { 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' };
      if (match[1] === 'manifest.json') {
        // Development's source tile keys are only used by the server.
        body = JSON.stringify({ ...index, chunks: index.chunks.map(({ tiles, ...chunk }) => chunk) });
        headers['content-type'] = 'application/json';
      } else {
        const entry = index.chunks.find(c => c.key === match[2]);
        if (!entry) return new Response('not found', { status: 404 });
        if (preparedDir) body = await readFile(path.join(preparedDir, `scenery/${match[2]}.${match[3]}.bin.gz`));
        else {
          const id = `${match[2]}.${match[3]}`;
          if (!cache.has(id)) {
            const task = (async () => {
              const c = await compiler();
              const { encodeScenery } = await import('../../../static/world/assets/scenery-format.js');
              const { gzipSync } = await import('node:zlib');
              const tiles = await c.readSceneryTiles(publicDir, entry.tiles);
              return gzipSync(new Uint8Array(encodeScenery(c.compileScenery(entry.key, tiles, match[3], c.tools))));
            })().catch(error => { cache.delete(id); throw error; });
            cache.set(id, task);
          }
          const task = cache.get(id); cache.delete(id); cache.set(id, task);
          while (cache.size > 24) cache.delete(cache.keys().next().value);
          body = await task;
        }
        // A gzip file payload, like regular world tiles. The client explicitly
        // decompresses it; no Content-Encoding or double decompression.
        headers['content-type'] = 'application/gzip';
        headers['cache-control'] = preparedDir ? 'public, max-age=14400' : 'no-store';
      }
      headers['content-length'] = String(Buffer.byteLength(body));
      return new Response(options.method?.toUpperCase() === 'HEAD' ? null : body, { headers });
    } catch (error) {
      console.warn('[scenery] unavailable:', error.message);
      return new Response('scenery unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
    }
  };
}
