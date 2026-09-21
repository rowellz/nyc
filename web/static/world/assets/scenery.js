import { g as BufferGeometry, h as BufferAttribute, kt as Mesh, Z as Group, Pt as MeshStandardMaterial, At as MeshBasicMaterial, ar as Sphere, Or as Vector3 } from './textureRelease-2U-gT89r.js';
import { SCENERY_VERSION, compactSceneryIndex } from './scenery-format.js';
import { createSceneryStream, sceneryBudget } from './scenery-stream.js?v=rail-portal-guards-76';
import { createSceneryTransport } from './scenery-transport.js';

// Same world-space noise as nearby terrain. The distant path samples only albedo;
// normal maps and fine edge wear have already filtered away at this distance.
const GROUND_PARS = `
uniform sampler2D uAsphalt, uConcrete, uGrass;
uniform vec4 uTexScale;
uniform float uGroundReady, uWetness, uSeason;

float envHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 envHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float envNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash12(i), envHash12(i + vec2(1.0, 0.0)), f.x), mix(envHash12(i + vec2(0.0, 1.0)), envHash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float envFbm(vec2 p) {
  return (envNoise(p) * 0.5 + envNoise(p * 2.03 + 7.1) * 0.25 + envNoise(p * 4.07 + 3.3) * 0.125) / 0.875;
}
vec4 envTexNoTile(sampler2D tex, vec2 uv) {
  float k = envNoise(uv * 0.06);
  vec2 duvdx = dFdx(uv), duvdy = dFdy(uv);
  float l = k * 8.0;
  float f = fract(l);
  float ia = floor(l), ib = ia + 1.0;
  vec2 offa = sin(vec2(3.0, 7.0) * ia);
  vec2 offb = sin(vec2(3.0, 7.0) * ib);
  vec4 cola = textureGrad(tex, uv + offa, duvdx, duvdy);
  vec4 colb = textureGrad(tex, uv + offb, duvdx, duvdy);
  return mix(cola, colb, smoothstep(0.2, 0.8, f - 0.1 * dot(cola.xyz - colb.xyz, vec3(1.0))));
}
`;

/** A visible near mesh, rather than a downloaded tile, owns the LOD handoff. */
export function nearSceneryCoverage(worldGroup) {
  const ready = { buildings: new Set(), roads: new Set(), ground: new Set() };
  for (const root of worldGroup.children) {
    if (!root.visible) continue;
    const kind = root.name === 'buildings' ? 'buildings' : root.name === 'streets' ? 'roads' : root.name === 'environment' ? 'ground' : null;
    if (!kind) continue;
    const prefix = { buildings: 'bld-', roads: 'streets:', ground: 'env-ground-' }[kind];
    for (const child of root.children) if (child.visible && child.name.startsWith(prefix)) ready[kind].add(child.name.slice(prefix.length));
  }
  return ready;
}

export function createScenery(ctx, builtLandmarks = new Set()) {
  const mobile = ctx.quality.level === 'mobile';
  const budget = sceneryBudget(mobile, ctx.quality.farDistance, ctx.world.ios === true);
  const group = new Group(); group.name = 'buildings-far'; ctx.worldGroup.add(group);
  const treeTiles = new Map(); ctx.worldGroup.userData.sceneryTreeTiles = treeTiles;
  const focus = { value: [0,0] }, range = { value: budget.distance }, night = { value: 0 };
  const sun = { value: [.4,.8,.3] }, sunColor = { value: [0,0,0] };
  const skyLight = { value: [.4,.4,.4] }, groundLight = { value: [.15,.15,.15] };
  const terrain = { uGroundReady:{value:0}, uAsphalt:{value:null}, uConcrete:{value:null}, uGrass:{value:null},
    uTexScale:{value:[1/2.4,1/3,1/1.6,1]}, uWetness:{value:0}, uSeason:{value:0} };
  const originalFog = ctx.scene.fog?.isFog ? { fog:ctx.scene.fog, near:ctx.scene.fog.near, far:ctx.scene.fog.far } : null;
  // Keep the nearby city clear until halfway to the scenery limit, then blend
  // detailed meshes and proxies into the same haze before scenery disappears.
  if (mobile && originalFog) {
    originalFog.fog.near = budget.distance * .5;
    originalFog.fog.far = budget.distance;
  }
  const transport = createSceneryTransport();
  let disposed=false, manifest=null, manifestRequest=null, retryAt=0, manifestController=null, manifestTimer=null, coverageSignature='', lastPublication=-Infinity;
  const uncovered=new Float32Array(16);
  const stats = { chunks:0, fetched:0, total:0, done:false, buildings:0, bytes:0, inFlight:0, failed:0 };
  const url = `${ctx.world.baseUrl ?? '/world/world'}/lod`;
  function material(kind, coverage) {
    const mat = mobile ? new MeshBasicMaterial({ vertexColors:true, fog:true })
      : new MeshStandardMaterial({ vertexColors:true, roughness:1, metalness:0, fog:true });
    mat.name=`scenery-${kind}`;
    mat.userData.lodCoverage={value:coverage};
    mat.customProgramCacheKey = () => `scenery-v5-${mobile?'mobile':'standard'}-${kind}`;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { uLodFocus:focus, uLodRange:range, uLodNight:night, uLodSun:sun, uLodSunColor:sunColor, uLodSky:skyLight, uLodGround:groundLight, ...terrain, uLodCovered:mat.userData.lodCoverage });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float aOwner;
flat varying float vLodOwner;
varying vec3 vLodPosition;
varying vec3 vLodLight;
${kind === 'buildings' ? 'varying vec2 vLodWindow; varying float vLodWall;' : ''}
uniform vec3 uLodSun, uLodSunColor, uLodSky, uLodGround;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vLodOwner=aOwner;
vLodPosition=(modelMatrix*vec4(position,1.0)).xyz;
${kind === 'buildings' ? `
// Project onto the wall tangent so diagonal facades retain evenly spaced bays.
vec2 tangent=vec2(-normal.z,normal.x)/max(length(normal.xz),.001);
vLodWindow=vec2(dot(vLodPosition.xz,tangent)/3.0,vLodPosition.y/3.2);
vLodWall=1.0-abs(normal.y);` : ''}
// Lambert diffuse from the same scene lights as the detailed materials.
vec3 lodNormal=normalize(mat3(modelMatrix)*normal);
vLodLight=mix(uLodGround,uLodSky,lodNormal.y*.5+.5)+uLodSunColor*max(0.0,dot(lodNormal,uLodSun));`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
flat varying float vLodOwner;
varying vec3 vLodPosition;
varying vec3 vLodLight;
${kind === 'buildings' ? 'varying vec2 vLodWindow; varying float vLodWall;' : ''}
uniform float uLodCovered[16];
uniform vec2 uLodFocus;
uniform float uLodRange;
uniform float uLodNight;
${kind === 'ground' ? GROUND_PARS : ''}`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if(uLodCovered[int(vLodOwner+.5)]>.5)discard;
float lodDistance=distance(vLodPosition.xz,uLodFocus);
if(lodDistance>uLodRange)discard;`).replace('#include <color_fragment>', `#include <color_fragment>
${kind === 'ground' ? `
vec2 wp=vLodPosition.xz;
float n1=envFbm(wp*.045), n3=envNoise(wp*.11+31.7);
vec3 paved=mix(vec3(.055,.055,.058),vec3(.24,.23,.22),smoothstep(.44,.62,n1));
vec3 grass=vec3(.065,.105,.018);
if(uGroundReady>.5) {
  paved=mix(envTexNoTile(uAsphalt,wp*uTexScale.x).rgb,envTexNoTile(uConcrete,wp*uTexScale.y).rgb,smoothstep(.44,.62,n1));
  grass=envTexNoTile(uGrass,wp*uTexScale.z).rgb;
}
grass*=mix(vec3(1.0),vec3(1.22,1.04,.70),uSeason*smoothstep(.52,.8,n3));
grass*=mix(.78,1.22,smoothstep(.25,.75,n1));
float natural=step(.5,vColor.g);
diffuseColor.rgb=mix(paved,grass,natural)*(1.0-uWetness*mix(.55,.28,natural));
` : ''}
`).replace('#include <opaque_fragment>', `
${mobile ? 'outgoingLight*=vLodLight;' : ''}
${kind === 'buildings' ? `
vec2 pixel=fwidth(vLodWindow);
vec2 aa=clamp(pixel*.5,vec2(.001),vec2(.18));
vec2 bay=fract(vLodWindow);
vec2 aperture=smoothstep(vec2(.32,.22)-aa,vec2(.32,.22)+aa,bay)
  *(1.0-smoothstep(vec2(.68,.78)-aa,vec2(.68,.78)+aa,bay));
// Stable sparse occupancy, with both warm and cool rooms. Fade unresolved
// windows out instead of averaging their light over the entire wall.
vec3 room=vec3(floor(vLodWindow),vLodOwner);
float occupied=fract(sin(dot(room,vec3(12.9898,78.233,37.719)))*43758.5453);
float resolved=1.0-smoothstep(.35,1.1,max(pixel.x,pixel.y));
float windows=aperture.x*aperture.y*step(.76,occupied)*resolved*vLodWall;
vec3 lamp=mix(vec3(1.0,.8,.55),vec3(.7,.85,1.0),step(.91,occupied));
outgoingLight+=lamp*windows*.65*uLodNight;
` : ''}
#include <opaque_fragment>`);

    };
    return mat;
  }
  function syncHandle(handle, ready) {
    for (const mesh of handle.children) {
      const { coverage, kind, tiles }=mesh.userData;
      for (let i=0;i<tiles.length;i++) coverage[i]=ready[kind].has(tiles[i])?1:0;
      if(mobile) compactMesh(mesh);
    }
  }
  function compactMesh(mesh) {
    const count=compactSceneryIndex(mesh.userData,mesh.userData.coverage,builtLandmarks);
    mesh.geometry.setDrawRange(0,count);
    mesh.geometry.index.needsUpdate=true;
  }
  function syncLandmarks(handle) {
    for(const mesh of handle.children) {
      if(mobile){compactMesh(mesh);continue;}
      const {features,sourceIndex}=mesh.userData;
      if(!features.length)continue;
      const index=mesh.geometry.index.array;
      index.set(sourceIndex);
      for(const f of features) if(builtLandmarks.has(f.id)) index.fill(0,f.start,f.start+f.count);
      mesh.geometry.index.needsUpdate=true;
    }
  }
  function publish(chunk) {
    const root=new Group(); root.name=`scenery:${chunk.key}:${chunk.tier}`;
    root.userData.buildings=chunk.buildings;
    root.userData.treeTiles=chunk.treeTiles ?? [];
    try {
      for (const layer of chunk.layers) {
        const geometry=new BufferGeometry(), coverage=new Float32Array(16);
        geometry.setAttribute('position',new BufferAttribute(layer.position,3));
        geometry.setAttribute('normal',new BufferAttribute(layer.normal,3,true));
        geometry.setAttribute('color',new BufferAttribute(layer.color,3,true));
        geometry.setAttribute('aOwner',new BufferAttribute(layer.owner,1));
        geometry.setIndex(new BufferAttribute(layer.renderIndex,1));
        geometry.boundingSphere=new Sphere(new Vector3(...layer.bounds.center),layer.bounds.radius);
        const mesh=new Mesh(geometry,material(layer.kind,coverage));
        mesh.position.set(chunk.ox,0,chunk.oz); mesh.renderOrder=1;
        mesh.updateMatrix(); mesh.matrixAutoUpdate=false;
        mesh.castShadow=mesh.receiveShadow=false;
        // The skyline mirror hides near meshes, so keep their proxies in that pass.
        mesh.onBeforeRender=(_renderer,_scene,camera)=>{mesh.material.userData.lodCoverage.value=camera===ctx.camera?coverage:uncovered;};
        mesh.userData={coverage,kind:layer.kind,tiles:chunk.tiles,features:layer.features,
          sourceIndex:layer.index,renderIndex:layer.renderIndex,owner:layer.owner};
        root.add(mesh);
      }
      syncHandle(root,nearSceneryCoverage(ctx.worldGroup));
      if(!mobile)syncLandmarks(root);
      group.add(root);
      for(const tile of root.userData.treeTiles) treeTiles.set(tile.key,tile);
      return root;
    } catch(error) { remove(root); throw error; }
  }
  function remove(root) {
    for(const tile of root.userData.treeTiles) if(treeTiles.get(tile.key)===tile) treeTiles.delete(tile.key);
    root.removeFromParent();
    for (const mesh of root.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }
  const stream=createSceneryStream({budget,publish,remove,fetchChunk:(key,tier,signal)=>
    transport.load(`${url}/${key}.${tier}.bin?v=${manifest.revision}`,key,tier,signal,budget.decodeBytes)});
  return {
    group,stats,
    syncLandmarks() {for(const rec of stream.resident.values())syncLandmarks(rec.handle);},
    update() {
      if(disposed)return;
      const distance = ctx.quality.farDistance;
      if (distance !== budget.distance) {
        budget.distance = range.value = distance;
        if (mobile && originalFog) {
          originalFog.fog.near = distance * .5;
          originalFog.fog.far = distance;
        }
      }
      // The scenery layer is optional; it never extends the startup busy gate.
      if(!globalThis.__ready)return;
      const now=performance.now();
      if(!manifest&&!manifestRequest&&now>=retryAt) {
        manifestController=new AbortController();
        manifestTimer=setTimeout(()=>manifestController.abort(),15000);
        manifestRequest=fetch(`${url}/manifest.json`,{signal:manifestController.signal,cache:'no-cache'})
          .then(r=>{if(!r.ok)throw Error('Scenery manifest unavailable');return r.json();})
          .then(m=>{if(disposed)return;if(m.version!==SCENERY_VERSION||m.chunkSize!==1024)throw Error('Unsupported scenery manifest');manifest=m;stats.total=m.chunks.length;stream.setManifest(m);})
          .catch(()=>{retryAt=performance.now()+10000;}).finally(()=>{clearTimeout(manifestTimer);manifestRequest=null;});
      }
      focus.value[0]=ctx.camera.position.x; focus.value[1]=ctx.camera.position.z;
      night.value=1-Math.max(0,Math.min(1,ctx.time.daylight??1));
      // Reading existing scene lights keeps mobile proxies cheap without inventing
      // a second daylight/color model. No per-fragment PBR or extra shadow maps.
      for (const light of ctx.scene.children) {
        const scale=light.intensity/Math.PI;
        if(light.isDirectionalLight) {
          const dx=light.position.x-light.target.position.x, dy=light.position.y-light.target.position.y, dz=light.position.z-light.target.position.z;
          const length=Math.hypot(dx,dy,dz)||1;
          sun.value[0]=dx/length;sun.value[1]=dy/length;sun.value[2]=dz/length;
          sunColor.value[0]=light.color.r*scale;sunColor.value[1]=light.color.g*scale;sunColor.value[2]=light.color.b*scale;
        } else if(light.isHemisphereLight) {
          skyLight.value[0]=light.color.r*scale;skyLight.value[1]=light.color.g*scale;skyLight.value[2]=light.color.b*scale;
          groundLight.value[0]=light.groundColor.r*scale;groundLight.value[1]=light.groundColor.g*scale;groundLight.value[2]=light.groundColor.b*scale;
        }
      }
      const sharedGround=ctx.worldGroup.getObjectByName('environment')?.userData.sceneryGround;
      terrain.uGroundReady.value=sharedGround?1:0;
      if(sharedGround) for(const key of Object.keys(terrain)) if(sharedGround[key]) terrain[key].value=sharedGround[key].value;
      // Prefer detailed work, but continuous driving must not starve the cheap
      // scenery forever. Under pressure allow at most two publications/second.
      const before=stream.stats.fetched;
      stream.update(...focus.value,(ctx.busy??0)<4||now-lastPublication>=500);
      if(stream.stats.fetched!==before)lastPublication=now;
      const ready=nearSceneryCoverage(ctx.worldGroup);
      const signature=Object.values(ready).map(s=>[...s].join(',')).join('|');
      if(signature!==coverageSignature) {
        for(const rec of stream.resident.values())syncHandle(rec.handle,ready);
        coverageSignature=signature;
      }
      // Retire the old coarse square ground only once real coastal ground exists.
      if(stream.resident.size) {
        const old=ctx.worldGroup.getObjectByName('env-far-ground');
        if(old)old.visible=false;
      }
      Object.assign(stats,stream.stats);stats.done=!!manifest&&!stats.inFlight;
      stats.buildings=[...stream.resident.values()].reduce((n,r)=>n+r.handle.userData.buildings,0);
    },
    dispose() {if(mobile&&originalFog){originalFog.fog.near=originalFog.near;originalFog.fog.far=originalFog.far;}disposed=true;manifestController?.abort();clearTimeout(manifestTimer);stream.dispose();transport.dispose();treeTiles.clear();if(ctx.worldGroup.userData.sceneryTreeTiles===treeTiles)delete ctx.worldGroup.userData.sceneryTreeTiles;Object.assign(stats,stream.stats);stats.buildings=0;group.removeFromParent();},
  };
}
