/** Schedule the mirrored client's tiles and street builds using the same route priority. */
export const streamingAssetPaths = new Set(['world/assets/main-D_3aygO4.js', 'world/assets/streets-CfYSUqyW.js',
  'world/assets/quality-BuEwAkMy.js', 'world/assets/buildings-BDmduZ8y.js']);

export function streamingAssetTransform(rel, source) {
  if (!streamingAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Streaming override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel.endsWith('/main-D_3aygO4.js')) {
    source = "import { configureStreaming as $configureStreaming, canCommitSceneTile as $canCommitSceneTile } from './predictive-streaming.js';\n" + source;
    source = "import { startDeferredModules as $startDeferredModules, startupProgress as $startupProgress } from './startup-policy.js';\n" + source;
    replace('(t.busy??0)<16', '$canCommitSceneTile(t,o)');
    // Three polls material.currentProgram after compile(). Tile retirement can
    // dispose that material before the timer fires, deleting currentProgram.
    // The resulting timer exception leaves the promise (and ctx.busy) pending
    // forever. Retain the compiled programs, skip destroyed ones, and reject
    // polling failures so the owning scene job always gets to finish.
    replace('this.compileAsync=function(e,t,n=null){let r=this.compile(e,t,n);return new Promise(t=>{function n(){if(r.forEach(function(e){I.get(e).currentProgram.isReady()&&r.delete(e)}),r.size===0){t(e);return}setTimeout(n,10)}He.get(`KHR_parallel_shader_compile`)===null?setTimeout(n,10):n()})}',
      `this.compileAsync=function(e,t,n=null){
        const materials=this.compile(e,t,n),programs=new Set;
        for(const material of materials)for(const program of I.get(material).programs?.values()??[])programs.add(program);
        return new Promise((resolve,reject)=>{
          function poll(){try{
            for(const program of programs)if(program.program===void 0||program.isReady())programs.delete(program);
            if(programs.size===0){resolve(e);return}
            setTimeout(poll,10);
          }catch(error){reject(error)}}
          He.get('KHR_parallel_shader_compile')===null?setTimeout(poll,10):poll();
        })
      }`);
    replace('O=new Pl(S,v,t.world)', 'O=$configureStreaming(new Pl(S,v,t.world),x.camera)');
    replace('async function de(){for(let e=1;e<Au.length;e++){let t=Au[e];if(t!==`audio`){do await new Promise(e=>setTimeout(e,1500));while(ve.running&&((k.busy??0)>0||!O.ready));if(!ve.running)return;await ue(t,e)}}h(`modules_ready`,ce.join(`, `)),se.modulesCreated()}',
      'async function de(){await $startDeferredModules({ctx:k,world:O,loop:ve,shots:se,order:Au,create:ue,stage:h,created:ce})}');
    replace('Mu(`streaming tiles around ${kt(e.x,e.z).lat.toFixed(4)}, ${kt(e.x,e.z).lon.toFixed(4)} — ${O.tiles.size} loaded`,.85+.15*Math.min(1,O.tiles.size/9))',
      '(()=>{const p=$startupProgress(k,O);Mu(p.text,p.fraction)})()');
    // Audio must not overlap an optional factory still allocating after entry.
    replace('he&&!_e&&e-he>=1e4', 'he&&!_e&&e-he>=1e4&&(k.busy??0)===0&&!k.startup?.initializing');
  } else if (rel.endsWith('/quality-BuEwAkMy.js')) {
    // Full simulation stays local; independently bounded prebuilt scenery
    // extends visibility without expanding the physics/traffic tile radius.
    replace('drawDistance:512,farDistance:768', 'drawDistance:512,farDistance:2500');
    replace('u.farDistance=u.drawDistance=512', 'u.drawDistance=256,u.farDistance=1500');
    replace('drawDistance:700,farDistance:3e3', 'drawDistance:768,farDistance:5e3');
    replace('drawDistance:600,farDistance:2500', 'drawDistance:768,farDistance:4e3');
    replace('drawDistance:1e3,farDistance:5e3', 'drawDistance:768,farDistance:6e3');
    replace('drawDistance:1200,farDistance:6e3', 'drawDistance:768,farDistance:8e3');
  } else if (rel.endsWith('/buildings-BDmduZ8y.js')) {
    source = "import { createScenery as $createScenery } from './scenery.js';\n" + source;
    replace('x=t.quality.farDistance>t.quality.drawDistance?Ee(t,d,y):null', 'x=$createScenery(t,y)');
  } else {
    replace('o=i*i+a*a;o<r&&(n=t,r=o)',
      'o=e.world.tilePriority?.(t.tile.tx,t.tile.tz)??i*i+a*a;o<r&&(n=t,r=o)');
  }
  return source;
}
