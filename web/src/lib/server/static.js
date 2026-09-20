/**
 * Static serving for the mirrored client, its assets and the 3,697 world tiles.
 *
 * The headers here are load-bearing. Tiles are raw gzip served as
 * `application/gzip` with NO `Content-Encoding`: the client's streamer worker
 * sniffs the gzip magic bytes itself, so announcing the encoding would make the
 * browser inflate them first and the decoder would see JSON it cannot parse.
 * Cache-control matches the origin too — immutable for content-hashed assets,
 * no-cache for HTML — except in development, see DEV below.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { tunnelAssetPaths, tunnelAssetTransform } from './tunnel-assets.js';
import { trafficAssetPaths, trafficAssetTransform } from './traffic-assets.js';
import { streamingAssetPaths, streamingAssetTransform } from './streaming-assets.js';
import { mobilePerformanceAssetPaths, mobilePerformanceAssetTransform } from './mobile-performance-assets.js';
import { versionClientImports } from './client-cache.js';
import { createStreetTileService } from './street-context.js';
import { streetContextAssetPaths, streetContextAssetTransform } from './street-context-assets.js';
import { precompressedResponse } from './precompressed.js';
import { railAssetPaths, railAssetTransform } from './rail-assets.js';
import { createSceneryService } from './scenery.js';
import { scoreFreeAssetPaths, scoreFreeAssetTransform } from './score-free-assets.js';

/**
 * In development nothing is cached. The mirrored client is patched in place (see
 * the bridge-builder fixes in the README) and its filenames carry the *origin's*
 * content hashes, which do not change when the bytes behind them do — so the
 * production `immutable` header would pin a browser to a stale worker for a year
 * and hide every edit. Worker scripts are the worst of it: they are fetched once
 * and cached hard, so even a reload keeps running the old build.
 */
const DEV = process.env.NODE_ENV !== 'production';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.gz': 'application/gzip', '.wasm': 'application/wasm', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
};

/**
 * The mirrored `public/` tree. It lives beside the app rather than inside it:
 * `/app/public` in the image, `../public` when running from web/ in the repo.
 */
export const PUBLIC_DIR = resolvePublicDir();
const PREPARED_DIR = !DEV && process.env.PREPARED_ASSET_DIR;
const scenery = createSceneryService(PUBLIC_DIR, PREPARED_DIR);
const streetTile = createStreetTileService(path.join(PUBLIC_DIR, 'world/world/tiles'), {
  catalogPath: PREPARED_DIR ? path.join(PREPARED_DIR, 'road-index.json') : undefined,
});

function resolvePublicDir() {
  if (process.env.PUBLIC_DIR) return path.resolve(process.env.PUBLIC_DIR);
  for (const candidate of ['public', '../public']) {
    const dir = path.resolve(process.cwd(), candidate);
    if (fs.existsSync(path.join(dir, 'world', 'index.html'))) return dir;
  }
  return path.resolve(process.cwd(), 'public');
}

/**
 * Serve one file out of PUBLIC_DIR.
 * @param {string} relPath path relative to PUBLIC_DIR, e.g. "world/assets/main.js"
 * @param {{ method?: string, acceptEncoding?: string | null, transform?: (text: string) => string }} [options]
 *   `transform` rewrites the file as UTF-8 text before it goes out, which is how
 *   the client's index.html picks up this service's addons. It reads the whole
 *   file instead of streaming it, so keep it for small ones.
 * @returns {Promise<Response>}
 */
export async function serveStatic(relPath, options = {}) {
  const rel = decodeURIComponent(relPath).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return new Response('forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
  }

  const distant = await scenery(rel, options);
  if (distant) return distant;

  let st;
  try {
    st = await fs.promises.stat(file);
  } catch {
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  if (!st.isFile()) {
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }

  const ext = path.extname(file).toLowerCase();
  const headers = {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': String(st.size),
    'x-content-type-options': 'nosniff',
    'cache-control': DEV ? 'no-store'
      : ext === '.html' ? 'no-cache'
      : rel.includes('/assets/') ? 'public, max-age=31536000, immutable'
      : 'public, max-age=14400',
  };

  const tileMatch = /^world\/world\/tiles\/(-?\d+_-?\d+)\.json\.gz$/.exec(rel);
  if (tileMatch) {
    const body = await streetTile(tileMatch[1]);
    headers['content-length'] = String(body.byteLength);
    return new Response(options.method?.toUpperCase() === 'HEAD' ? null : body, { status: 200, headers });
  }

  if (options.transform || ext === '.js' || ext === '.html') {
    let body = await fs.promises.readFile(file, 'utf8');
    if (scoreFreeAssetPaths.has(rel)) {
      body = scoreFreeAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (tunnelAssetPaths.has(rel)) {
      body = tunnelAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (trafficAssetPaths.has(rel)) {
      body = trafficAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (streamingAssetPaths.has(rel)) {
      body = streamingAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (mobilePerformanceAssetPaths.has(rel)) {
      body = mobilePerformanceAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (streetContextAssetPaths.has(rel)) {
      body = streetContextAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (railAssetPaths.has(rel)) {
      body = railAssetTransform(rel, body);
      headers['cache-control'] = 'no-store';
    }
    if (options.transform) body = options.transform(body);
    const versioned = versionClientImports(body);
    if (versioned !== body) {
      body = versioned;
      headers['cache-control'] = 'no-store';
    }
    headers['content-length'] = String(Buffer.byteLength(body));
    if (PREPARED_DIR && ext === '.js' && !options.transform) {
      const compressed = await precompressedResponse(PREPARED_DIR, rel, headers, options);
      if (compressed) return compressed;
    }
    if ((options.method || 'GET').toUpperCase() === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    return new Response(body, { status: 200, headers });
  }

  if (PREPARED_DIR && ext === '.css') {
    const compressed = await precompressedResponse(PREPARED_DIR, rel, headers, options);
    if (compressed) return compressed;
  }
  if ((options.method || 'GET').toUpperCase() === 'HEAD') {
    return new Response(null, { status: 200, headers });
  }
  const stream = Readable.toWeb(fs.createReadStream(file));
  return new Response(/** @type {ReadableStream} */ (stream), { status: 200, headers });
}
