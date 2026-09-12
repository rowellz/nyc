/** Publish roadside placement into the existing main and iOS prop bundles. */
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
function patch(path, edits) {
  const file = new URL(path, root); let code = readFileSync(file, 'utf8');
  if (!code.includes('streetLampPlacement as $streetLampPlacement')) {
    for (const [from, to] of edits) {
      if (code.split(from).length !== 2) throw new Error(`Expected one fixture anchor: ${from}`);
      code = code.replace(from, to);
    }
    code = "import { streetLampPlacement as $streetLampPlacement } from './fixtures.js';\n" + code;
    writeFileSync(file, code);
  }
}
patch('public/world/assets/props-coU--UuE.js', [
  ['c.add(u);let d=L(', 'c.add(u);const $placed=$streetLampPlacement(e.world,t,l);if(!$placed)continue;let d=L('],
  ['f=l.yaw,p=l.x,m=l.z,h=e.physics.groundHeight(l.x,l.z)', 'f=$placed.yaw,p=$placed.x,m=$placed.z,h=e.physics.groundHeight(p,m)'],
  ['d>.9&&v(`muni`', '$placed===l&&d>.9&&v(`muni`'],
  ['d>=.3&&d<.62){let e=$(t.roads,l)', '$placed===l&&d>=.3&&d<.62){let e=$(t.roads,l)'],
]);
patch('public/world/assets/mobile-SBC7KRMu.js', [
  ['function w(){let o=e.camera.position', 'function w(){const $roadsChanged=g;let o=e.camera.position'],
  ['g=!1,s.length===x.length&&s.every', 'g=!1,!$roadsChanged&&s.length===x.length&&s.every'],
  ['for(let e of x){let t=c.get(e.kind)', 'const $fixtureWorld=e.world;for(let $source of x){let $lamp=$streetLampPlacement($fixtureWorld,undefined,$source);if(!$lamp)continue;let e=$lamp;let t=c.get(e.kind)'],
]);
const propsPath = new URL('public/world/assets/props-coU--UuE.js', root);
let props = readFileSync(propsPath, 'utf8');
if (!props.includes('fixtureTiles as $fixtureTiles')) {
  const from = 'n.events.on(`tileLoaded`,J)';
  if (props.split(from).length !== 2) throw new Error('Expected one prop tile load handler');
  props = props.replace(from, 'n.events.on(`tileLoaded`,tile=>{for(const affected of $fixtureTiles(n.world,tile))J(affected)})');
  props = "import { fixtureTiles as $fixtureTiles } from './fixtures.js';\n" + props;
  writeFileSync(propsPath, props);
}
writeFileSync(new URL('public/world/assets/fixtures.js', root), readFileSync(new URL('src/client/src/streets/fixtures.js', root)));
console.log('Published roadway clearance for lamps and matching light/collider placement.');
