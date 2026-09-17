import { g as BufferGeometry, h as BufferAttribute, kt as Mesh, Z as Group, Pt as MeshStandardMaterial, At as MeshBasicMaterial, ar as Sphere, Or as Vector3 } from './textureRelease-2U-gT89r.js';
import { SCENERY_VERSION } from './scenery-format.js';
import { createSceneryStream, sceneryBudget } from './scenery-stream.js';
import { createSceneryTransport } from './scenery-transport.js';

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
  const focus = { value: [0,0] }, range = { value: budget.distance }, haze = { value: [.55,.65,.73] }, night = { value: 0 };
  const sun = { value: [.4,.8,.3] };
  const transport = createSceneryTransport();
  let disposed=false, manifest=null, manifestRequest=null, retryAt=0, manifestController=null, manifestTimer=null, coverageSignature='', lastPublication=-Infinity;
  const uncovered=new Float32Array(16);
  const stats = { chunks:0, fetched:0, total:0, done:false, buildings:0, bytes:0, inFlight:0, failed:0 };
  const url = `${ctx.world.baseUrl ?? '/world/world'}/lod`;
  function material(kind, coverage) {
    const mat = mobile ? new MeshBasicMaterial({ vertexColors:true, fog:false })
      : new MeshStandardMaterial({ vertexColors:true, roughness:1, metalness:0, fog:false });
    mat.name=`scenery-${kind}`;
    mat.userData.lodCoverage={value:coverage};
    mat.customProgramCacheKey = () => `scenery-v2-${mobile?'mobile':'standard'}-${kind}`;
    mat.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, { uLodFocus:focus, uLodRange:range, uLodHaze:haze, uLodNight:night, uLodSun:sun, uLodCovered:mat.userData.lodCoverage });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
attribute float aOwner;
flat varying float vLodOwner;
varying vec3 vLodPosition;
varying float vLodWall;
varying float vLodLight;
uniform vec3 uLodSun;`).replace('#include <begin_vertex>', `#include <begin_vertex>
vLodOwner=aOwner;
vLodPosition=(modelMatrix*vec4(position,1.0)).xyz;
vLodWall=1.0-abs(normal.y);
vLodLight=.55+.45*max(0.0,dot(normal,uLodSun));`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
flat varying float vLodOwner;
varying vec3 vLodPosition;
varying float vLodWall;
varying float vLodLight;
uniform float uLodCovered[16];
uniform vec2 uLodFocus;
uniform float uLodRange,uLodNight;
uniform vec3 uLodHaze;`).replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if(uLodCovered[int(vLodOwner+.5)]>.5)discard;
float lodDistance=distance(vLodPosition.xz,uLodFocus);
if(lodDistance>uLodRange)discard;`).replace('#include <opaque_fragment>', `
${mobile ? 'outgoingLight*=vLodLight*mix(.15,1.0,1.0-uLodNight);' : ''}
${kind === 'buildings' ? `float windows=step(.5,fract((vLodPosition.x+vLodPosition.z)/3.0))*step(.35,fract(vLodPosition.y/3.2));
float lit=step(.7,fract(floor(vLodPosition.y/3.2)*.618+floor((vLodPosition.x+vLodPosition.z)/3.0)*.382));
outgoingLight+=vec3(.9,.65,.3)*windows*lit*vLodWall*uLodNight;` : ''}
outgoingLight=mix(outgoingLight,uLodHaze,smoothstep(uLodRange*.4,uLodRange,lodDistance));
#include <opaque_fragment>`);
    };
    return mat;
  }
  function syncHandle(handle, ready) {
    for (const mesh of handle.children) {
      const { coverage, kind, tiles }=mesh.userData;
      for (let i=0;i<tiles.length;i++) coverage[i]=ready[kind].has(tiles[i])?1:0;
    }
  }
  function syncLandmarks(handle) {
    for(const mesh of handle.children) {
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
        mesh.userData={coverage,kind:layer.kind,tiles:chunk.tiles,features:layer.features,sourceIndex:layer.index};
        root.add(mesh);
      }
      syncHandle(root,nearSceneryCoverage(ctx.worldGroup));
      syncLandmarks(root);
      group.add(root); return root;
    } catch(error) { remove(root); throw error; }
  }
  function remove(root) {
    root.removeFromParent();
    for (const mesh of root.children) { mesh.geometry.dispose(); mesh.material.dispose(); }
  }
  const stream=createSceneryStream({budget,publish,remove,fetchChunk:(key,tier,signal)=>
    transport.load(`${url}/${key}.${tier}.bin?v=${manifest.revision}`,key,tier,signal)});
  return {
    group,stats,
    syncLandmarks() {for(const rec of stream.resident.values())syncLandmarks(rec.handle);},
    update() {
      if(disposed)return;
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
      night.value=1-(ctx.time.daylight??1);
      const direction=ctx.time.sunDir;
      if(direction){sun.value[0]=direction.x;sun.value[1]=direction.y;sun.value[2]=direction.z;}
      const color=ctx.scene.fog?.color;
      if(color){haze.value[0]=color.r;haze.value[1]=color.g;haze.value[2]=color.b;}
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
    dispose() {disposed=true;manifestController?.abort();clearTimeout(manifestTimer);stream.dispose();transport.dispose();Object.assign(stats,stream.stats);stats.buildings=0;group.removeFromParent();},
  };
}
