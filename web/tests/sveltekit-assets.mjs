import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { tunnelAssetTransform } from '../src/lib/server/tunnel-assets.js';
import { trafficAssetTransform } from '../src/lib/server/traffic-assets.js';
import { streamingAssetTransform } from '../src/lib/server/streaming-assets.js';
import { mobilePerformanceAssetTransform } from '../src/lib/server/mobile-performance-assets.js';
import { versionClientImports } from '../src/lib/server/client-cache.js';
import { streetContextAssetTransform } from '../src/lib/server/street-context-assets.js';

// Resolve the same overrides and transformed imports that a browser receives,
// without ever modifying the shared client used by the original application.
const directory = mkdtempSync(`${tmpdir()}/nyc-sveltekit-assets-`);
export const assets = pathToFileURL(`${directory}/`);
const original = new URL('../../public/world/assets/', import.meta.url);
const overrides = new URL('../static/world/assets/', import.meta.url);
const local = new Set(readdirSync(overrides));
for (const name of new Set([...readdirSync(original), ...local].filter(name => name.endsWith('.js')))) {
  const source = local.has(name)
    ? readFileSync(new URL(name, overrides), 'utf8')
    : tunnelAssetTransform(`world/assets/${name}`, readFileSync(new URL(name, original), 'utf8'));
  const rel = `world/assets/${name}`;
  const transformed = streetContextAssetTransform(rel, mobilePerformanceAssetTransform(rel, streamingAssetTransform(rel, trafficAssetTransform(rel, source))));
  writeFileSync(new URL(name, assets), local.has(name) ? transformed : versionClientImports(transformed));
}
