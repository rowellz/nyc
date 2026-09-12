import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { tunnelAssetTransform } from '../src/lib/server/tunnel-assets.js';
import { trafficAssetTransform } from '../src/lib/server/traffic-assets.js';

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
  writeFileSync(new URL(name, assets), trafficAssetTransform(`world/assets/${name}`, source));
}
