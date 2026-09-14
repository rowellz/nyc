import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip, brotliCompress, constants } from 'node:zlib';
import { buildStreetCatalog } from '../src/lib/server/street-context.js';

const source = path.resolve(process.argv[2] ?? '../public');
const output = path.resolve(process.argv[3] ?? 'generated');
// Always prepare from the current sources, even when rebuilding an existing output.
process.env.PUBLIC_DIR = source;
process.env.PREPARED_ASSET_DIR = '';
const { serveStatic } = await import('../src/lib/server/static.js');
const compressGzip = promisify(gzip), compressBrotli = promisify(brotliCompress);
await mkdir(output, { recursive: true });
const catalog = await buildStreetCatalog(path.join(source, 'world/world/tiles'));
await writeFile(path.join(output, 'road-index.json'), JSON.stringify(catalog));
let count = 0;
async function prepare(directory) {
  for (const item of await readdir(path.join(source, directory), { withFileTypes: true })) {
    const rel = path.join(directory, item.name);
    if (item.isDirectory()) { await prepare(rel); continue; }
    if (!item.isFile() || !/\.(js|css)$/.test(item.name)) continue;
    // Use the actual serving transforms, including import revisioning. Never
    // compress the unpatched mirror and then serve it as the patched client.
    const response = await serveStatic(rel);
    if (!response.ok) throw new Error(`Cannot prepare ${rel}: ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const [gz, br] = await Promise.all([
      compressGzip(body, { level: 9 }),
      compressBrotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT } }),
    ]);
    await mkdir(path.dirname(path.join(output, rel)), { recursive: true });
    await Promise.all([writeFile(path.join(output, `${rel}.gz`), gz), writeFile(path.join(output, `${rel}.br`), br)]);
    count++;
  }
}
await prepare('world');
console.log(`Prepared ${catalog.keys.length} tile keys, ${catalog.roads.length} roads and ${count} compressed JS/CSS assets in ${output}`);
