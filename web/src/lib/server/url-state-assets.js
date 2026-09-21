/** Keep restoration inside the camera controllers that own the next frame. */
export const urlStateAssetPaths=new Set(['world/assets/main-D_3aygO4.js','world/assets/character-O1u3Gxpp.js']);
export function urlStateAssetTransform(rel,source) {
  if(!urlStateAssetPaths.has(rel))return source;
  const replace=(before,after)=>{
    if(source.split(before).length!==2)throw Error(`URL state override anchor changed in ${rel}: ${before}`);
    source=source.replace(before,after);
  };
  if(rel.endsWith('/main-D_3aygO4.js')) {
    source="import {installUrlState as $installUrlState} from './url-state.js';\n"+source;
    replace('return{name:`character`,update(n){y&&(y=!1,S())',
      'return{name:`character`,restoreView(heading,pitch){y&&(y=!1,S());d=-heading*Math.PI/180;f=E.clamp(pitch*Math.PI/180,-1.2,.9)},update(n){y&&(y=!1,S())');
    replace('console.info(`[core] running`)','$installUrlState(window.__game,se),console.info(`[core] running`)');
  }else {
    replace('let D={orbit(e,t){u.injectLook.dx+=e,u.injectLook.dy+=t}',
      'let D={restoreView(){u.regain()},orbit(e,t){u.injectLook.dx+=e,u.injectLook.dy+=t}');
  }
  return source;
}
