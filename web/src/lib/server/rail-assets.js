/** Rail hooks for the SvelteKit world. Guard anchors so upstream changes fail
 * during preparation instead of silently separating meshes from collision. */
export const railAssetPaths = new Set([
  'world/assets/main-D_3aygO4.js',
  'world/assets/tile.worker-Ai2ZdmRL.js',
  'world/assets/streets-CfYSUqyW.js',
  'world/assets/character-O1u3Gxpp.js',
  'world/assets/vehicles-_zJz3z3J.js',
  'world/assets/props-coU--UuE.js',
]);

export function railAssetTransform(rel, source) {
  if (!railAssetPaths.has(rel)) return source;
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error(`Rail override anchor changed in ${rel}: ${before}`);
    source = source.replace(before, after);
  };
  if (rel.endsWith('/main-D_3aygO4.js')) {
    source = "import { installRail as $installRail } from './rail/runtime.js';\n" + source;
    replace('k.modules.set(`telemetry`,ku(k))', 'k.modules.set(`telemetry`,ku(k)),$installRail(k)');
    // The old presentation guard assumed everything below street level was a
    // fall into water, including the free camera. Platforms and stairwells are
    // valid support; ordinary unsupported falls retain the existing guard.
    replace('i=!n.screenshotMode&&!n.adminFlying;i&&n.welcomed',
      'i=!n.screenshotMode&&!n.adminFlying;const $rf=e.modules.get("rail")?.support(r.state.x,r.state.z,r.state.y,NaN),$railSafe=Number.isFinite($rf);i&&n.welcomed&&!$railSafe');
    replace('let o=-1;i&&(o=.6)', 'let o=-100;i&&(o=$railSafe?Math.min(.6,$rf+.2):.6)');
  } else if (rel.endsWith('/tile.worker-Ai2ZdmRL.js')) {
    source = "import { cutRailStreets as $railCuts } from './rail/cuts.js';\n" + source;
    replace('let e=mi(n);self.postMessage({id:t,built:e}', 'let e=$railCuts(mi(n),n.tile);self.postMessage({id:t,built:e}');
  } else if (rel.endsWith('/character-O1u3Gxpp.js')) {
    replace('inView(e,t){this.sphere.center.set(e,.9,t)', 'inView(e,t,y=0){this.sphere.center.set(e,y+.9,t)');
    source=source.replace(/this\.inView\(([a-z])\.x,\1\.z\)/g,(_,p)=>`this.inView(${p}.x,${p}.z,${p}.gy??0)`);
    replace('(o||s>Yi||u||l)&&!i&&this.despawn(t)', '(o||s>(n.stationVisit?300:Yi)||(!n.stationVisit&&(u||l)))&&!i&&this.despawn(t)');
    replace('this.think(t,e),this.move(t,e,o.x,o.z,s),',
      '(this.ctx.modules.get("rail")?.updatePed(t,e,this)||(this.think(t,e),this.move(t,e,o.x,o.z,s))),');
    replace('!r.seat&&(n+this.slot)%12==0&&(r.gy=this.walkingHeight(r.x,r.z))',
      '!r.seat&&!r.stationVisit&&(n+this.slot)%12==0&&(r.gy=this.walkingHeight(r.x,r.z))');
    replace('despawn(e){let t=this.peds[e];', 'despawn(e){let t=this.peds[e];this.ctx.modules.get("rail")?.releasePed(t);');
    replace('update(e,t){let n=this.ctx,r=n.state,i=r.local.state,a=n.input;',
      'update(e,t){let n=this.ctx,r=n.state,i=r.local.state,a=n.input;if(n.modules.get("rail")?.carryPassenger(e)){this.place(i.x,i.y+this.height/2+.1,i.z);this.vel.set(0,0,0);this.vy=0;this.speed=0;this.animState="idle";this.pendingSync=false;return;}');
  } else if (rel.endsWith('/vehicles-_zJz3z3J.js')) {
    replace('function de(){let e=t.now??0;', 'function de(){if(t.modules.get("rail")?.controlsInteraction())return;let e=t.now??0;');
  } else if (rel.endsWith('/props-coU--UuE.js')) {
    source="import { functionalEntrance as $functionalEntrance, entranceYaw as $entranceYaw, entranceClosed as $entranceClosed } from './rail/access.js?v=terrain-elevation-92';\n"+source;
    replace('case`subway_entrance`:{let e=$(t.roads,l);e&&(f=Math.atan2(-e.dz,e.dx));',
      'case`subway_entrance`:{let e=$(t.roads,l);e&&(f=Math.atan2(-e.dz,e.dx));f=$entranceYaw(l.x,l.z)??f;');
    replace('v(`stairwell`,0,.025)', '(!$functionalEntrance(l.x,l.z)&&v(`stairwell`,0,.025))');
    replace('let i=l.text?.trim()&&/^[A-Z0-9 ]+$/.test(l.text.trim())','let i=$entranceClosed(l.x,l.z)?"|Entrance closed|Use another entrance":l.text?.trim()&&/^[A-Z0-9 ]+$/.test(l.text.trim())');
  } else if (rel.endsWith('/streets-CfYSUqyW.js')) {
    // Streets installs its own height sampler after rail starts. Apply rail
    // support last, with the player's level, so it cannot clamp players on a
    // platform back onto the independent street above or below them.
    replace('return $tunnelSupport(e.world,t,n,y,i>0?Math.max(r,i):r)',
      'const h=$tunnelSupport(e.world,t,n,y,i>0?Math.max(r,i):r);return e.modules.get("rail")?.support(t,n,y,h)??h');
  }
  return source;
}
