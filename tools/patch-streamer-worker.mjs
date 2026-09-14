/** Keep the cancellable tile decoder in step with the recovered source. */
import { readFileSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('src/client/src/core/streamer.worker.ts', root), 'utf8');
const code = stripTypeScriptTypes(source).replace(/^export /gm, '').replace(/[\t ]+$/gm, '');
writeFileSync(new URL('public/world/assets/streamer.worker-CUGZ-BtP.js', root), `(function(){\n${code}\n})();\n`);
console.log('Published cancellable tile decoder.');
