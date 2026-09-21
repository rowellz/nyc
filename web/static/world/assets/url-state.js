// Share world metres and camera angles without navigating or growing history.
const round=(value,places=2)=>Number(value.toFixed(places));
const heading=yaw=>((-yaw*180/Math.PI)%360+360)%360;
function tuple(raw,count) {
  if(!raw)return null;
  const parts=raw.split(',');
  if(parts.length!==count||parts.some(p=>!p.trim()))return null;
  const values=parts.map(Number);return values.every(Number.isFinite)?values:null;
}
const inCity=([x,y,z])=>x>=-7000&&x<=9000&&y>=-1000&&y<=5000&&z>=-17000&&z<=11000;
export function readUrlState(url) {
  const pos=tuple(url.searchParams.get('pos'),4),view=tuple(url.searchParams.get('view'),6);
  return {
    pos:pos&&inCity(pos)&&pos[3]>=0&&pos[3]<=360?pos:null,
    view:view&&inCity(view)&&view[3]>=0&&view[3]<=360&&Math.abs(view[4])<=90&&view[5]>10&&view[5]<150?view:null,
  };
}
export function installUrlState(game,shots,host=window) {
  const ctx=game.ctx,state=ctx.state,initial=readUrlState(new URL(host.location.href));
  let restorePosition=!!initial.pos,restoreView=!!initial.view,disposed=false,timer=null;
  function applyView() {
    const [x,y,z,bearing,pitch,fov]=initial.view;
    ctx.camera.position.set(x,y,z);
    ctx.camera.rotation.set(pitch*Math.PI/180,-bearing*Math.PI/180,0,'YXZ');
    ctx.camera.fov=fov;ctx.camera.updateProjectionMatrix();
  }
  function restore() {
    if(!state.screenshotMode&&!state.welcomed)return;
    if(restorePosition) {
      const [x,y,z,bearing]=initial.pos;
      if(state.screenshotMode)Object.assign(state.local.state,{x,y,z,yaw:-bearing*Math.PI/180});
      else {
        state.local.state.yaw=-bearing*Math.PI/180;
        game.teleport(x,z,y);
        if(state.admin)ctx.net.send({t:'adminTeleport',x,y,z,yaw:state.local.state.yaw});
      }
      restorePosition=false;
    }
    if(!restoreView)return;
    const character=host.__character??ctx.modules.get('character');
    if(state.screenshotMode&&shots.cam) {
      const [x,y,z,bearing,pitch]=initial.view;
      applyView();shots.cam.place(x,y,z,bearing,pitch);restoreView=false;
    }else if(!state.screenshotMode&&character?.restoreView) {
      applyView();character.restoreView(initial.view[3],initial.view[4]);restoreView=false;
    }else if(ctx.input.look?.dx||ctx.input.look?.dy||Math.hypot(ctx.input.move?.x??0,ctx.input.move?.y??0)>.01) {
      // Never reset a heading the user chose while a mobile module was loading.
      restoreView=false;
    }
  }
  function save() {
    if(disposed||restorePosition||restoreView||(!state.screenshotMode&&!state.welcomed)||!(ctx.stats.drawCalls>0))return;
    const p=state.local.state,c=ctx.camera.position,e=ctx.camera.rotation.clone().reorder('YXZ');
    const pos=[p.x,p.y,p.z,heading(p.yaw)],view=[c.x,c.y,c.z,heading(e.y),e.x*180/Math.PI,ctx.camera.fov];
    if(![...pos,...view].every(Number.isFinite)||!inCity(pos)||!inCity(view))return;
    const url=new URL(host.location.href);
    url.searchParams.set('pos',pos.map(v=>round(v)).join(','));
    url.searchParams.set('view',view.map(v=>round(v)).join(','));
    // The existing boot parser knows fly; view restores its absolute height
    // after terrain loads. A shared admin flight opens as an ordinary camera.
    if(state.screenshotMode||state.adminFlying) {
      const ground=ctx.physics.groundHeight(c.x,c.z);
      url.searchParams.set('fly',[c.x,c.z,c.y-(Number.isFinite(ground)?ground:0),view[3],view[4]].map(v=>round(v)).join(','));
      url.searchParams.set('fov',String(round(ctx.camera.fov)));
    }else url.searchParams.delete('fly');
    url.searchParams.delete('spot'); // Named spots otherwise override fly on boot.
    if(url.href===host.location.href)return;
    try {
      host.history.replaceState(host.history.state,'',url.href);
      if(state.screenshotMode||state.adminFlying)host.sessionStorage.setItem('nyc.web.camera-return',url.search);
    }catch { /* Browser history/storage restrictions must not stop the game. */ }
  }
  function start(){if(!disposed&&timer===null)timer=host.setInterval(save,5000);}
  function stop(){if(timer!==null)host.clearInterval(timer);timer=null;}
  const module={name:'urlState',update:restore,dispose(){disposed=true;stop();host.removeEventListener('pagehide',stop);host.removeEventListener('pageshow',start);}};
  ctx.modules.get('urlState')?.dispose();ctx.modules.set('urlState',module);
  host.addEventListener('pagehide',stop);host.addEventListener('pageshow',start);
  restore();start();return module;
}
