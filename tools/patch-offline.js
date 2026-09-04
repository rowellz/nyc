/**
 * Makes the mirrored client fully offline by pointing its web-font <link> at the
 * vendored copy in public/world/assets/fonts/ instead of Google Fonts.
 *
 * The upstream source (src/client/src/ui/styles.ts) already ships system-font
 * fallbacks "so nothing breaks offline"; this only removes the network round-trip.
 * Idempotent - safe to re-run after re-mirroring.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = path.resolve(__dirname, '..', 'public', 'world', 'assets');
const GOOGLE_CSS = /https:\/\/fonts\.googleapis\.com\/css2\?[^"'`]*/g;
const LOCAL_CSS = '/world/assets/fonts/fonts.css';
const PRECONNECT = /https:\/\/fonts\.gstatic\.com/g;

let patched = 0;
for (const f of fs.readdirSync(ASSETS)) {
  if (!f.endsWith('.js') && !f.endsWith('.css')) continue;
  const p = path.join(ASSETS, f);
  const before = fs.readFileSync(p, 'utf8');
  const after = before.replace(GOOGLE_CSS, LOCAL_CSS).replace(PRECONNECT, '/world/assets/fonts');
  if (after !== before) {
    fs.writeFileSync(p, after);
    console.log(`  patched ${f}`);
    patched++;
  }
}
console.log(patched ? `offline font patch applied to ${patched} file(s)` : 'nothing to patch (already offline)');
