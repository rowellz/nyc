/** Mobile scheduling/texture fixes applied only by the SvelteKit service. */
export const mobilePerformanceAssetPaths = new Set([
  'world/assets/main-D_3aygO4.js', 'world/assets/quality-BuEwAkMy.js', 'world/assets/index-DQv-X5z6.js',
  'world/assets/loading-DS_gLujL.js', 'world/assets/streets-CfYSUqyW.js',
  'world/assets/tile.worker-Ai2ZdmRL.js', 'world/assets/texture.worker-CaHoFbYF.js',
  'world/assets/transfer-CN3_6JL-.js',
  'world/assets/character-O1u3Gxpp.js',
  'world/assets/vehicles-_zJz3z3J.js',
  'world/assets/props-coU--UuE.js', 'world/assets/builder.worker-CU7Og7am.js',
  'world/assets/mobile-SBC7KRMu.js',
  'world/assets/textureRelease-2U-gT89r.js',
  'world/assets/buildings-BDmduZ8y.js',
  'world/assets/landmarks-KpQKy0CX.js', 'world/assets/builder.worker-D9_Czkt3.js',
  'world/assets/geom-8zUJB5A-.js',
  'world/assets/environment-WQwLg8tn.js', 'world/assets/textures.worker--LU96PcS.js',
]);

export function mobilePerformanceAssetTransform(rel, source) {
  if (!mobilePerformanceAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Mobile performance override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel.endsWith('/index-DQv-X5z6.js')) {
    // A 160-character slice cut the JSON before FPS, triangles and budgets.
    replace('detail:t.slice(0,160)', 'detail:t.slice(0,e===`renderer_memory`||e===`webgl_context_lost`?4096:160)');
  } else if (rel.endsWith('/main-D_3aygO4.js')) {
    replace('n()&&at(a),a.outputColorSpace', 'at(a),a.outputColorSpace');
    source = "import { rendererDiagnostics as $rendererDiagnostics } from './renderer-diagnostics.js';\n" + source;
    replace('JSON.stringify({geometries:t,textures:n,programs:x.renderer.info.programs?.length??0})',
      'JSON.stringify({geometries:t,textures:n,programs:x.renderer.info.programs?.length??0,...$rendererDiagnostics(k)})');
    replace('f.addEventListener(`webglcontextlost`,()=>ve.stop())',
      'f.addEventListener(`webglcontextlost`,()=>{h(`webgl_context_lost`,JSON.stringify($rendererDiagnostics(k)));ve.stop()})');
    source = "import { createMobileFrameBudget as $createMobileFrameBudget, resizeDrawingBuffer as $resizeDrawingBuffer } from './mobile-frame-budget.js';\n" + source;
    replace('Mu(`streaming tiles`,.85),f.addEventListener',
      'const $mobileFrameBudget=$createMobileFrameBudget(k,x,t.raw.get(`adaptive`)!==`0`&&t.raw.get(`capture`)!==`1`);Mu(`streaming tiles`,.85),f.addEventListener');
    replace('preserveDrawingBuffer:t.screenshotMode',
      'preserveDrawingBuffer:t.screenshotMode&&(!c||t.raw.get(`capture`)===`1`)');
    replace('afterFrame(){if(a(),c)', 'afterFrame(){$mobileFrameBudget(performance.now(),pe);if(a(),c)');
    replace('n()&&e===m&&i===h&&s===g', 'e===m&&i===h&&s===g');
    replace('a.setPixelRatio(s),a.setSize(e,i,!0)', '$resizeDrawingBuffer(a,e,i,s),r.pixelRatio=s');
    // Android used the desktop atmosphere/composer, which also disabled the
    // direct-render resolution controller. Use the mobile atmosphere on both.
    replace('c&&e===`atmosphere`?', 'v.level===`mobile`&&e===`atmosphere`?');
  } else if (rel.endsWith('/quality-BuEwAkMy.js')) {
    replace('shadowMapSize:4096', 'shadowMapSize:1920');
    replace('shadowMapSize:2048', 'shadowMapSize:1920');
    // The iOS override discarded q=low. Start with fewer shaded pixels and
    // retain low's stricter ceiling throughout adaptive recovery.
    replace('u.pixelRatio=i(1,innerWidth,innerHeight)', 'u.pixelRatio=i(e===`low`?.65:.75,innerWidth,innerHeight)');
    replace('u.pixelRatio=i(e===`low`?.75:n.dpr,innerWidth,innerHeight)', 'u.pixelRatio=i(e===`low`?.75:.85,innerWidth,innerHeight)');
    replace('u.shadows=!t()&&e!==`low`', 'u.shadows=!1');
  } else if (rel.endsWith('/textureRelease-2U-gT89r.js')) {
    // Keep the existing iOS upload budget, and cap image textures on desktop too.
    replace('function rl(e){let t=e.image;', 'function rl(e){const limit=Zc?512:1920;let t=e.image;');
    replace('Math.max(t.width,t.height)<=512', 'Math.max(t.width,t.height)<=limit');
    replace('let n=512/Math.max(t.width,t.height)', 'let n=limit/Math.max(t.width,t.height)');
    source = "import { prepareSceneTextures as $prepareSceneTextures } from './texture-preflight.js';\n" + source;
    replace('let r=new Set,i=e=>{e instanceof B&&!r.has(e)&&(r.add(e),rl(e))};e.traverse(e=>{let t=e.material;for(let e of Array.isArray(t)?t:t?[t]:[]){Object.values(e).forEach(i);let t=e.uniforms;if(t)for(let e of Object.values(t))Array.isArray(e.value)?e.value.forEach(i):i(e.value)}}),n(e,t)',
      '$prepareSceneTextures(e,rl),n(e,t)');
  } else if (rel.endsWith('/geom-8zUJB5A-.js')) {
    // Geometry disposal does not release an InstancedMesh's instance buffers.
    // Landmark furniture owns both and is rebuilt as tiles/footprints change.
    replace('t.geometry&&t.geometry.dispose()',
      't.isInstancedMesh&&t.dispose(),t.geometry&&t.geometry.dispose()');
  } else if (rel.endsWith('/landmarks-KpQKy0CX.js')) {
    replace('var en=2048,', 'var en=1920,');
    source = "import { mobileLandmarkShader as $mobileLandmarkShader, mobileLandmarkMain as $mobileLandmarkMain } from './mobile-facade.js';\n" + source;
    replace('function et(e){let t=', 'function et(e,$mobile=false){const $pars=$mobile?$mobileLandmarkShader(Qe):Qe,$main=$mobile?$mobileLandmarkMain($e):$e;let t=');
    replace('let a=et(n),o=ot(4739931)', 'let a=et(n,e.quality.level===`mobile`),o=ot(4739931)');
    replace('${Qe}', '${$pars}');
    replace('${$e}', '${$main}');
    replace('()=>`landmarkFacade12`', '()=>`landmarkFacade14-${$mobile?`mobile`:`desktop`}`');
    replace('let s=kn(e.quality.level===`mobile`?1024:void 0);s.anisotropy=e.quality.level===`low`?1:4;',
      'let s=kn(e.quality.level===`mobile`?512:void 0);s.anisotropy=e.quality.level===`mobile`||e.quality.level===`low`?1:4;');
    source = "import { selectDetailedLandmarks as $selectDetailedLandmarks } from './mobile-build-policy.js';\n" + source;
    replace('E.landmarks=E.pending=0;for(let t of _){let n=de(t);',
      'E.landmarks=E.pending=0;const $landmarkSelection=$selectDetailedLandmarks(e,_);if($landmarkSelection)for(const l of _)if(!$landmarkSelection.has(l)&&(l.root||l.job)){A(l);o=true;}for(let t of _){if($landmarkSelection&&!$landmarkSelection.has(t))continue;let n=de(t);');
    // Detailed landmarks follow the local scene. The prebuilt scenery now owns
    // their distant silhouettes instead of constructing full models at 6 km.
    replace('let me=ve,ke=me**2,je=(me+256)**2;',
      'let me=Math.min(ve,e.quality.drawDistance),ke=me**2,je=(me+256)**2;');
    // Large landmarks (bridges) can have a nearby edge and a distant center.
    // Use the distance to that edge for building and releasing alike.
    replace('function de(t){return(e.camera.position.x-t.center[0])**2+(e.camera.position.z-t.center[1])**2}',
      'function de(t){const d=(e.camera.position.x-t.center[0])**2+(e.camera.position.z-t.center[1])**2;return Math.max(0,Math.sqrt(d)-t.radius)**2}');
    replace('n<(e.quality.drawDistance+t.radius)**2',
      'n<e.quality.drawDistance**2');
    // Keep the detailed replacement visible throughout retention hysteresis.
    // Its BIN still suppresses the proxy until removeLandmark releases it.
    replace('e.root.visible=de(e)<=ke', 'e.root.visible=true');
  } else if (rel.endsWith('/loading-DS_gLujL.js')) {
    source = "import { nextSceneBuild as $nextSceneBuild, sceneBuildBudgetMs as $sceneBuildBudgetMs } from './mobile-build-policy.js';\n" + source;
    replace('let e=performance.now()+3,', 'let e=performance.now()+$sceneBuildBudgetMs(this.ctx),');
    replace('ctx;ready=[];frame=0;', 'ctx;ready=[];frame=0;turn=0;');
    replace('this.ready.push({job:s,steps:t})', 'this.ready.push({job:s,steps:t,label:e})');
    replace('let e=this.ready.shift();', 'let e=$nextSceneBuild(this.ready,this.ctx,this.turn++);');
  } else if (rel.endsWith('/streets-CfYSUqyW.js')) {
    source = "import { releaseGeometryRequest as $releaseGeometryRequest } from './geometry-residency.js';\n" + source;
    // The active request owns both worker construction and the decoded commit.
    replace('G.delete(e.id),e.error&&console.warn',
      '$releaseGeometryRequest(G,e.id,t,$mobileGeometry,$),e.error&&console.warn');
    replace('function Y(e){let t=G.get(e.id);',
      'const $mobileGeometry=e.quality.level===`mobile`;function Y(e){let t=G.get(e.id);');
    // compileAsync resolves to the mesh. Caching that value pins the first
    // tile's geometry even after it has been unloaded from the scene.
    replace('g=e.renderer.compileAsync(c,e.camera,e.scene),K.set',
      'g=e.renderer.compileAsync(c,e.camera,e.scene).then(()=>{}),K.set');
    // Each geometry worker owns its own JS heap and construction scratch data.
    // Keep one on mobile; the first also handles the initial texture request.
    replace('let t=new Worker(new URL(`/world/assets/tile.worker-Ai2ZdmRL.js`,``+import.meta.url),{type:`module`,name:`streets-1`})',
      'if(e.quality.level!==`mobile`){let t=new Worker(new URL(`/world/assets/tile.worker-Ai2ZdmRL.js`,``+import.meta.url),{type:`module`,name:`streets-1`})');
    replace('W.push(t),b.then(t=>{', 'W.push(t)}b.then(t=>{');
    source = "import { createMobileRoadMaterial as $mobileRoadMaterial } from './mobile-road-material.js';\n" + source;
    source = "import { streetTextureUrl as $streetTextureUrl, MOBILE_STREET_BUDGET as $streetBudget, markStreetDirty as $markStreetDirty, canBuildStreet as $canBuildStreet, beginStreetBuild as $beginStreetBuild } from './mobile-build-policy.js';\n" + source;
    replace('async function W(e){let t=', 'async function W(e){const $mobile=e.quality.level===`mobile`;let t=');
    replace('x=w(v,i)', 'x=w(v,i,$mobile)');
    replace('function w(e,t){let n=', 'function w(e,t,$mobile=false){if($mobile)return $mobileRoadMaterial(i,y,t);let n=');
    // These maps are exclusive to the desktop road shader. Keep the shared
    // concrete/granite maps and paint atlas used by sidewalks and structures.
    replace('.map(async([e,t,n,i])=>{let a=c(t,n);',
      '.map(async([e,t,n,i])=>{if($mobile&&(e===`asphalt`||e===`cobble`))return;let a=c(t,n);');
    replace('for(let e of[`asphalt`,`concrete`,`granite`,`cobble`]){let t=n[e];',
      'for(let e of($mobile?[`concrete`,`granite`]:[`asphalt`,`concrete`,`granite`,`cobble`])){let t=n[e];');
    replace('for(let e of[`asphalt2`,`noise`,`atlas`]){let t=',
      'for(let e of($mobile?[`noise`,`atlas`]:[`asphalt2`,`noise`,`atlas`])){let t=');
    replace('async function H(r=e(`/assets/textures/`))', 'async function H(r=e(`/assets/textures/`),$mobile=false)');
    replace('b=H().catch(()=>null)', 'b=H(void 0,e.quality.level===`mobile`).catch(()=>null)');
    replace('let r=await h(e);return r.wrapS', 'let r=await h($streetTextureUrl(e,$mobile));return r.wrapS');
    replace('r.anisotropy=8,r', 'r.anisotropy=$mobile?$streetBudget.anisotropy:8,r');
    replace('aniso:Math.min(8,e.renderer.capabilities.getMaxAnisotropy())',
      'aniso:Math.min(e.quality.level===`mobile`?$streetBudget.anisotropy:8,e.renderer.capabilities.getMaxAnisotropy())');
    replace('V&&(e.job=a.job(`streets:${e.tile.key}`),z.add(e))',
      'V&&($markStreetDirty(e),e.job=a.job(`streets:${e.tile.key}`),z.add(e))');
    replace('for(let t of z){let i=(t.tile.tx+.5)',
      'for(let t of z){if(!$canBuildStreet(t,G,e))continue;let i=(t.tile.tx+.5)');
    replace('if(!n)return;z.delete(n);let i=++j;',
      'if(!n)return;z.delete(n);$beginStreetBuild(n);let i=++j;');
  } else if (rel.endsWith('/tile.worker-Ai2ZdmRL.js')) {
    source = "import { MOBILE_STREET_BUDGET as $streetBudget } from './mobile-build-policy.js';\n" + source;
    // "mobile" previously fell through to the full 1024px procedural tier.
    replace('function qn(e,t,n={},r={}){let i=t===`low`?512:1024',
      'function qn(e,t,n={},r={}){if(t===`mobile`){e=Math.min(e,$streetBudget.anisotropy);n={...n,asphalt:true,asphalt2:true,cobble:true}}let i=t===`mobile`?$streetBudget.mapSize:t===`low`?512:1024');
    replace('Hn(512,e,404)', 'Hn(t===`mobile`?$streetBudget.mapSize:512,e,404)');
    replace('f=Wn(256,606),p=Kn(1024,e,r)', 'f=Wn(t===`mobile`?$streetBudget.noiseSize:256,606),p=Kn(t===`mobile`?$streetBudget.atlasSize:1024,e,r)');
    replace('return c.normal.dispose(),c.rough.dispose(),console.info(`[streets] procedural textures',
      'return t===`mobile`&&(f.anisotropy=$streetBudget.anisotropy),c.normal.dispose(),c.rough.dispose(),console.info(`[streets] procedural textures');
    // Keep the drawn manhole in the atlas without fetching/compositing two photos.
    replace('let t=await Gn(),n;', 'let t=e.data.quality===`mobile`?{}:await Gn(),n;');
  } else if (rel.endsWith('/builder.worker-D9_Czkt3.js')) {
    source = "import { compactBuildingGeometry as $compactBuildingGeometry } from './mobile-building-lod.js';\n" + source;
    replace('function xe(e){', 'function xe(e){const $mobile=e.mobile===true,$details=new Set(e.detailedIds??[]);');
    replace('let e=ge(t.ring,.28);', 'let e=(!$mobile||$details.has($buildingId))?ge(t.ring,.28):null;');
    replace('l.cap([t.ring,...t.holes],n,e)', 'l.cap([t.ring,...t.holes],$mobile&&!$details.has($buildingId)?t.top:n,e)');
    replace('for(let t of e.buildings){let e=f.get(t.id);', 'for(let t of e.buildings){const $buildingId=t.id;let e=f.get(t.id);');
    replace('let t=xe(r);self.postMessage', 'let t=xe(r);if(r.mobile)$compactBuildingGeometry(t);self.postMessage');
  } else if (rel.endsWith('/buildings-BDmduZ8y.js')) {
    source = "import { createBuildingDetailController as $createBuildingDetailController } from './mobile-building-lod.js';\n" + source;
    replace('function N(e){let n=e.tile;', 'const $buildingDetail=$createBuildingDetailController(t);b.bytes=0;function N(e){let n=e.tile;');
    replace('return{key:n.key,tx:n.tx,tz:n.tz,buildings:n.buildings', 'return{...$buildingDetail.input(e),key:n.key,tx:n.tx,tz:n.tz,buildings:n.buildings');
    replace('update(e,n){te(),A(d.uStyle.value', 'update(e,n){$buildingDetail.update(v,r=>{r.job=i.job(`buildings:${r.key}`);D.push(r);P()});te(),A(d.uStyle.value');
    replace('new h(i.normal,3)', 'new h(i.normal,3,i.normal.BYTES_PER_ELEMENT===1)');
    replace('new h(i.color,3)', 'new h(i.color,3,i.color.BYTES_PER_ELEMENT===1)');
    replace('_=n.normal[t*3],v=n.normal[t*3+2]', '_=n.normal[t*3]/(n.normal.BYTES_PER_ELEMENT===1?127:1),v=n.normal[t*3+2]/(n.normal.BYTES_PER_ELEMENT===1?127:1)');
    // Hold the visible predecessor until the replacement is ready; collision
    // retains identical walls/roofs and is rebuilt by the existing commit job.
    replace('let a=performance.now(),s=new p;', 'let $reuseCollision=r.colliderDone===true,a=performance.now(),s=new p;');
    replace('yield,yield*R(r)', 'yield,$reuseCollision||(yield*R(r))');
    replace('n.add(c),r.mesh=c,r.built=i', '(()=>{if(r.mesh){n.remove(r.mesh);r.mesh.geometry.dispose();b.verts-=r.mesh.geometry.getAttribute(`position`).count;b.tris-=r.mesh.geometry.drawRange.count/3;b.bytes-=r.built?.byteLength??0}})(),n.add(c),b.bytes+=i.byteLength??0,r.storefronts=void 0,r.mesh=c,r.built=i');
    replace('r.built=null,r.grid=null,b.tiles=v.size', 'b.bytes-=r.built?.byteLength??0,r.built=null,r.grid=null,b.tiles=v.size');
    replace('c.castShadow=!0,c.receiveShadow=!0', 'c.castShadow=t.quality.shadows,c.receiveShadow=t.quality.shadows');

    source = "import { holdGeometrySlot as $holdGeometrySlot } from './geometry-residency.js';\n" + source;
    replace('e.data.tile?t.job?.run(L(t,e.data.tile))',
      'e.data.tile?($holdGeometrySlot(n,t.job,$buildingWorkerCount===1,()=>E.includes(n)&&P()),t.job?.run(L(t,e.data.tile)))');
    replace('if(t.terminate(),k.get(n.id)?.job?.cancel()',
      'if(t.terminate(),n.commitJob?.cancel(),k.get(n.id)?.job?.cancel()');
    replace('if(typeof Worker<`u`)for(let e=0;e<Fe;e++)',
      'const $buildingWorkerCount=t.quality.level===`mobile`?1:Fe;if(typeof Worker<`u`)for(let e=0;e<$buildingWorkerCount;e++)');
    source = "import { mobileFacadeShader as $mobileFacadeShader } from './mobile-facade.js';\n" + source;
    replace('function ue(e,t){let n=', 'function ue(e,t){const $facadeSource=t.mobile?$mobileFacadeShader(se):se;let n=');
    replace('`+se).replace(`#include <normal_fragment_maps>`', '`+$facadeSource).replace(`#include <normal_fragment_maps>`');
    replace('m=ue(d,{textures:!1})', 'm=ue(d,{textures:!1,mobile:t.quality.level===`mobile`})');
    replace('`facade-v2-${t.textures?`tex`:`proc`}`', '`facade-v5-${t.mobile?`mobile`:t.textures?`tex`:`proc`}`');
    // The filtered wall/flat roof path uses vertex colors and the sign atlas.
    // Do not decode/upload unused facade photos or recompile to the photo path.
    replace('async function U(){H++;', 'async function U(){if(t.quality.level===`mobile`){B=!0;return}H++;');
    // Fade nearby facade detail sooner, skipping room/shop interior shading
    // beyond the fade while retaining the existing windows and night lighting.
    replace('uDetailDist:{value:a===`ultra`||a===`high`?520:a===`medium`?380:260}',
      'uDetailDist:{value:a===`mobile`?96:a===`ultra`||a===`high`?520:a===`medium`?380:260}');
    source = "import { nextBuildingTile as $nextBuildingTile } from './mobile-build-policy.js';\n" + source;
    source = "import { buildingTextureUrl as $buildingTextureUrl, MOBILE_BUILDING_BUDGET as $buildingBudget } from './mobile-build-policy.js';\nimport { o as $mobileTextureUrl } from './quality-BuEwAkMy.js';\n" + source;
    replace('async function Q(e,t,n=!0,r){try{let a=await ne(e);',
      'async function Q(e,t,n=!0,r){try{e=$buildingTextureUrl($mobileTextureUrl(e));let a=await ne(e);');
    replace('a.anisotropy=Math.min(8,t.capabilities.getMaxAnisotropy())',
      'a.anisotropy=Math.min(e.includes(`/assets/textures-mobile/`)?$buildingBudget.anisotropy:8,t.capabilities.getMaxAnisotropy())');
    replace('function P(){for(;D.length;)', 'const $buildingContext=t;function P(){for(;D.length;)');
    replace('let t=D.shift();', 'let t=$nextBuildingTile(D,$buildingContext);');
  } else if (rel.endsWith('/vehicles-_zJz3z3J.js')) {
    // Keep the logical 1024px layout/UVs, painting directly into smaller mobile
    // canvases. Both livery and emissive maps otherwise allocate 1K per kind.
    replace('function ne(){let e=document.createElement(`canvas`);return e.width=e.height=M,[e,e.getContext(`2d`)]}',
      'function ne(size=M){let e=document.createElement(`canvas`);e.width=e.height=size;const g=e.getContext(`2d`);g.scale(size/M,size/M);return[e,g]}');
    replace('let[r,i]=ne(),[a,o]=ne();', 'let[r,i]=ne(n.textureSize),[a,o]=ne(n.textureSize);');
    replace('c=he(n,1+mt.indexOf(t)*.173,{doorSplit:',
      'c=he(n,1+mt.indexOf(t)*.173,{textureSize:this.ctx.quality.level===`mobile`?256:1024,doorSplit:');
    replace('l.colorSpace=m,l.anisotropy=8,l.generateMipmaps',
      'l.colorSpace=m,l.anisotropy=r.width<M?1:8,l.generateMipmaps');
    replace('u.colorSpace=m,u.anisotropy=4,{map:l',
      'u.colorSpace=m,u.anisotropy=a.width<M?1:4,{map:l');
    // Moving the iPhone parking window used Roads.load(), tearing down every
    // lane and recomputing every highway path twice per resident tile.
    replace('if(n&&$(C,t.camera.position)>64)for(let e of t.world.tiles.values())i.load(e);',
      'if(n&&$(C,t.camera.position)>64)for(let e of t.world.tiles.values())i.refreshParking(e);');
    const start = source.indexOf("      if (!['primary', 'secondary', 'tertiary', 'residential'].includes(r.cls)");
    const end = source.indexOf('\n    }\n    this.refreshHighways();', start);
    if (start < 0 || end < start) throw new Error('Parking generator anchor changed');
    const parking = source.slice(start, end);
    replace(parking, '');
    replace('    this.refreshHighways();\n  }\n\n          refreshHighways()', `    this.refreshParking(tile);
    this.refreshHighways();
  }

  refreshParking(tile) {
    const record = this.tiles.get(tile.key);
    if (!record) return;
    const previous = new Map(record.parked.map(car => [car.key, car]));
    record.parked = []; record.parkingSlots = 0;
    const camera = this.ctx.camera.position;
    const dx = Math.max(tile.tx * 256 - camera.x, 0, camera.x - (tile.tx + 1) * 256);
    const dz = Math.max(tile.tz * 256 - camera.z, 0, camera.z - (tile.tz + 1) * 256);
    if (!isIOS() || dx * dx + dz * dz <= 80 * 80) for (const r of tile.roads) {
${parking}
    }
    for (const car of previous.values()) removeBody(this.ctx, car);
  }

          refreshHighways()`);
    const near = '            if (isIOS() && (x - this.ctx.camera.position.x) ** 2 + (z - this.ctx.camera.position.z) ** 2 > 80 ** 2) continue;';
    replace(near, '');
    replace("            if (tile.props.some(p => p.kind === 'hydrant'", near + "\n            if (tile.props.some(p => p.kind === 'hydrant'");
    replace('            const car = makeCar(`p:${r.id}:${seed}:${slot * 2 + (side === 1 ? 0 : 1)}`, kind, x, ground(this.ctx, x, z), z,',
      '            const carKey = `p:${r.id}:${seed}:${slot * 2 + (side === 1 ? 0 : 1)}`;\n            const car = previous.get(carKey) ?? makeCar(carKey, kind, x, ground(this.ctx, x, z), z,');
    replace('            record.parked.push(car);', '            previous.delete(car.key);\n            record.parked.push(car);');
  } else if (rel.endsWith('/props-coU--UuE.js')) {
    replace('n.quality.level===`mobile`?.25:1', 'n.quality.level===`mobile`?.125:1920/4096');
    replace('this.texture.anisotropy=8,this.texture.generateMipmaps',
      'this.texture.anisotropy=n<1?1:8,this.texture.generateMipmaps');
  } else if (rel.endsWith('/builder.worker-CU7Og7am.js')) {
    // 32 signal frames fit in 1920 pixels at 60 pixels per frame.
    replace('function Gi(e=96)', 'function Gi(e=60)');
    // Scale the plywood drawing as a whole so permits/posters retain their UV
    // positions. Do not create a full-size canvas just to downsample it later.
    replace('function Hi(e=2048,t=512){let{c:n,g:r}=zi(e,t),i=ti(31),a=e/2;',
      'function Hi(e=2048,t=512,scale=.25){let{c:n,g:r}=zi(e*scale,t*scale),i=ti(31),a=e/2;r.scale(scale,scale);');
    replace('base:await Vr(Vi()),plywood:await Vr(Hi(e.data.mobile?1024:2048))',
      'base:await Vr(Vi(e.data.mobile?128:512)),plywood:await Vr(Hi(2048,512,e.data.mobile?.125:.25))');
  } else if (rel.endsWith('/mobile-SBC7KRMu.js')) {
    source = "import { createMobileProps as $mobileProps } from './mobile-props.js';\nimport { t as $mobileBuildScope } from './loading-DS_gLujL.js';\n" + source;
    const start = source.indexOf('function ae(e){let t=new p;');
    const end = source.indexOf('export{ae as createProps}', start);
    if (start < 0 || end < start) throw new Error('Mobile props entry anchor changed');
    replace(source.slice(start, end), `function ae(e){return $mobileProps(e,{Group:p,Material:c,InstancedMesh:C,Matrix4:s,Quaternion:m,Vector3:o,SignalNetwork:M,nearestProps:re,geometryFor:ie,streetLampPlacement:$streetLampPlacement,tileKey:E,tileIndex:D,buildScope:$mobileBuildScope})}`);
  } else if (rel.endsWith('/character-O1u3Gxpp.js')) {
    // Pedestrian spawning's four-second startup grace period used capped
    // simulation dt, stretching into minutes when mobile rendering is slow.
    replace('populationTime=0;', 'populationTime=0;populationStarted=performance.now();');
    replace('this.populationTime>=4',
      '(this.ctx.quality.level===`mobile`?performance.now()-this.populationStarted>=4000:this.populationTime>=4)');
  } else if (rel.endsWith('/environment-WQwLg8tn.js')) {
    // Static mobile foliage omits the wind shader work entirely. Freezing its
    // time uniform would still execute all four sine evaluations per vertex.
    replace('function qt(e,t,n,r,i){', 'function qt(e,t,n,r,i){const $staticTrees=e.quality.level===`mobile`;');
    replace('G(n,t?`env-tree-crown-v4`:`env-tree-leaves-v4`,',
      'G(n,($staticTrees?`static-`:``)+(t?`env-tree-crown-v4`:`env-tree-leaves-v4`),');
    replace('uTime:r.uTime,uWind:r.uWind,uWetness:r.uWetness,uTreeSun:d',
      '...($staticTrees?{}:{uTime:r.uTime,uWind:r.uWind}),uWetness:r.uWetness,uTreeSun:d');
    replace('uniform float uTime; uniform vec2 uWind; attribute vec3 aLeaf;',
      '${$staticTrees?``:`uniform float uTime; uniform vec2 uWind; `}attribute vec3 aLeaf;');
    const windStart = source.indexOf('          // three tiers:');
    const windEndText = 'transformed.y += treeFlutter * treeWind * 0.0025 * aLeaf.x * position.y;';
    const windEnd = source.indexOf(windEndText, windStart);
    if (windStart < 0 || windEnd < windStart) throw new Error('Tree wind shader anchor changed');
    const wind = source.slice(windStart, windEnd + windEndText.length);
    replace(wind, '${$staticTrees?``:`' + wind + '`}');
    replace('update(t){let n=e.camera.position,i=r.uWind.value.length();for(let e of s)e.windBounds(i);',
      'update(t){let n=e.camera.position,i=$staticTrees?0:r.uWind.value.length();if(!$staticTrees)for(let e of s)e.windBounds(i);');
    source = "import { terrainWorkerInput as $terrainWorkerInput, emptyTerrainPixels as $emptyTerrainPixels, terrainTexturePixels as $terrainTexturePixels, updateTerrainTexture as $updateTerrainTexture } from './terrain-worker-input.js';\n" + source;
    source = "import { shouldInvalidateMask as $shouldInvalidateMask, markMaskDirty as $markMaskDirty, canBuildMask as $canBuildMask, beginMaskBuild as $beginMaskBuild } from './mobile-build-policy.js';\n" + source;
    // Share existing terrain textures with scenery; no second texture allocation/upload.
    replace('uSoilScale:{value:1/n.soil.size}};function c(e)',
      'uSoilScale:{value:1/n.soil.size}};t.userData.sceneryGround={...o,uWetness:i.uWetness,uSeason:i.uSeason};function c(e)');
    replace('function F(e,t){for(let n=e-1;', 'function F(e,t){const $tx=e,$tz=t;for(let n=e-1;');
    replace('r&&(r.revision=++S,r.job?.cancel(),r.job=o.job(`environment mask ${t}`),x.add(t))',
      'r&&$shouldInvalidateMask(r,$tx,$tz)&&($markMaskDirty(r),r.revision=++S,r.job?.cancel(),r.job=o.job(`environment mask ${t}`),x.add(t))');
    replace('let a=i.tile,o=(a.tx*256+128-e.camera.position.x)',
      'if(!$canBuildMask(i,e))continue;let a=i.tile,o=(a.tx*256+128-e.camera.position.x)');
    replace('if(t){if(x.delete(t.tile.key),T)',
      'if(t){x.delete(t.tile.key);$beginMaskBuild(t);if(!t.tile.parks.length&&!t.tile.water.length){R(t,$emptyTerrainPixels(),t.job);return}if(T)');
    replace('T.postMessage({id:A,tile:t.tile,roads:e.world.roadsNear(n,r,184.32),buildings:e.world.buildingsNear(n,r,184.32)})',
      'T.postMessage($terrainWorkerInput(A,t.tile,e.world))');
    replace('let r=new g(n,512,512,D,te)', 'const $pixels=$terrainTexturePixels(n);let r=new g($pixels.data,$pixels.size,$pixels.size,D,te)');
    replace('t.tex.image.data=n,t.tex.needsUpdate=!0', '$updateTerrainTexture(t.tex,n)');
    replace('let e=this.ctx.quality.level===`mobile`?`low`:this.ctx.quality.level', 'let e=this.ctx.quality.level');
    replace('let n=e===`low`?256:512', 'let n=e===`mobile`?128:e===`low`?256:512');
    replace('anisotropy:this.ctx.renderer.capabilities.getMaxAnisotropy()',
      'anisotropy:this.ctx.quality.level===`mobile`?1:this.ctx.renderer.capabilities.getMaxAnisotropy()');
    replace('Ve(e.renderer.capabilities.getMaxAnisotropy())',
      'Ve(e.quality.level===`mobile`?1:e.renderer.capabilities.getMaxAnisotropy())');
    replace('leaves(t,n,r){return', 'leaves(t,n,r){if(this.ctx.quality.level===`mobile`)t=Math.min(t,128);return');
  } else if (rel.endsWith('/textures.worker--LU96PcS.js')) {
    replace('let n=e===`low`?256:512', 'let n=e===`mobile`?128:e===`low`?256:512');
  } else {
    source = "import { mobileTextureSize as $mobileTextureSize } from './mobile-build-policy.js';\n" + source;
    if (rel.endsWith('/texture.worker-CaHoFbYF.js')) {
      replace('n.includes(`/assets/textures-mobile/`)?Math.min(1,256/Math.max(r.width,r.height)):1',
        'Math.min(1,(n.includes(`/assets/textures-mobile/`)?$mobileTextureSize(n):1920)/Math.max(r.width,r.height))');
    } else {
      replace('t.includes(`/assets/textures-mobile/`)?Math.min(1,256/Math.max(n.width,n.height)):1',
        'Math.min(1,(t.includes(`/assets/textures-mobile/`)?$mobileTextureSize(t):1920)/Math.max(n.width,n.height))');
    }
  }
  return source;
}
