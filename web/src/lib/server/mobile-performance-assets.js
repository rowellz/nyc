/** Mobile scheduling/texture fixes applied only by the SvelteKit service. */
export const mobilePerformanceAssetPaths = new Set([
  'world/assets/loading-DS_gLujL.js', 'world/assets/streets-CfYSUqyW.js',
  'world/assets/tile.worker-Ai2ZdmRL.js', 'world/assets/texture.worker-CaHoFbYF.js',
  'world/assets/transfer-CN3_6JL-.js',
  'world/assets/character-O1u3Gxpp.js',
  'world/assets/vehicles-_zJz3z3J.js',
  'world/assets/mobile-SBC7KRMu.js',
  'world/assets/buildings-BDmduZ8y.js',
  'world/assets/landmarks-KpQKy0CX.js',
  'world/assets/geom-8zUJB5A-.js',
]);

export function mobilePerformanceAssetTransform(rel, source) {
  if (!mobilePerformanceAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Mobile performance override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel.endsWith('/geom-8zUJB5A-.js')) {
    // Geometry disposal does not release an InstancedMesh's instance buffers.
    // Landmark furniture owns both and is rebuilt as tiles/footprints change.
    replace('t.geometry&&t.geometry.dispose()',
      't.isInstancedMesh&&t.dispose(),t.geometry&&t.geometry.dispose()');
  } else if (rel.endsWith('/landmarks-KpQKy0CX.js')) {
    // The skyline used a separate 6 km radius even on the 512 m mobile tier.
    replace('let me=ve,ke=me**2,je=(me+256)**2;',
      'let me=e.quality.level===`mobile`?Math.min(ve,e.quality.drawDistance):ve,ke=me**2,je=(me+256)**2;');
    // Large landmarks (bridges) can have a nearby edge and a distant center.
    // Use the distance to that edge on mobile, for building and releasing alike.
    replace('function de(t){return(e.camera.position.x-t.center[0])**2+(e.camera.position.z-t.center[1])**2}',
      'function de(t){const d=(e.camera.position.x-t.center[0])**2+(e.camera.position.z-t.center[1])**2;return e.quality.level===`mobile`?Math.max(0,Math.sqrt(d)-t.radius)**2:d}');
    replace('n<(e.quality.drawDistance+t.radius)**2',
      'n<(e.quality.drawDistance+(e.quality.level===`mobile`?0:t.radius))**2');
  } else if (rel.endsWith('/loading-DS_gLujL.js')) {
    source = "import { nextSceneBuild as $nextSceneBuild } from './mobile-build-policy.js';\n" + source;
    replace('ctx;ready=[];frame=0;', 'ctx;ready=[];frame=0;turn=0;');
    replace('this.ready.push({job:s,steps:t})', 'this.ready.push({job:s,steps:t,label:e})');
    replace('let e=this.ready.shift();', 'let e=$nextSceneBuild(this.ready,this.ctx,this.turn++);');
  } else if (rel.endsWith('/streets-CfYSUqyW.js')) {
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
  } else if (rel.endsWith('/buildings-BDmduZ8y.js')) {
    source = "import { nextBuildingTile as $nextBuildingTile } from './mobile-build-policy.js';\n" + source;
    source = "import { buildingTextureUrl as $buildingTextureUrl, MOBILE_BUILDING_BUDGET as $buildingBudget } from './mobile-build-policy.js';\nimport { o as $mobileTextureUrl } from './quality-BuEwAkMy.js';\n" + source;
    replace('async function Q(e,t,n=!0,r){try{let a=await ne(e);',
      'async function Q(e,t,n=!0,r){try{e=$buildingTextureUrl($mobileTextureUrl(e));let a=await ne(e);');
    replace('a.anisotropy=Math.min(8,t.capabilities.getMaxAnisotropy())',
      'a.anisotropy=Math.min(e.includes(`/assets/textures-mobile/`)?$buildingBudget.anisotropy:8,t.capabilities.getMaxAnisotropy())');
    replace('function P(){for(;D.length;)', 'const $buildingContext=t;function P(){for(;D.length;)');
    replace('let t=D.shift();', 'let t=$nextBuildingTile(D,$buildingContext);');
  } else if (rel.endsWith('/vehicles-_zJz3z3J.js')) {
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
  } else {
    source = "import { mobileTextureSize as $mobileTextureSize } from './mobile-build-policy.js';\n" + source;
    if (rel.endsWith('/texture.worker-CaHoFbYF.js')) {
      replace('256/Math.max(r.width,r.height)', '$mobileTextureSize(n)/Math.max(r.width,r.height)');
    } else {
      replace('256/Math.max(n.width,n.height)', '$mobileTextureSize(t)/Math.max(n.width,n.height)');
    }
  }
  return source;
}
