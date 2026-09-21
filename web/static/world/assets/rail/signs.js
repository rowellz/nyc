import {signData} from './sign-data.js?v=rail-portal-guards-76';
// Platform records carry their own services and travel direction. A station
// complex's route union is appropriate only at its street entrances.
export function platformSignInfo(station,route,index) {
 const data=signData.stations[station.key];
 if(data)return {...data,groups:index===undefined?data.groups:data.platformGroups?.[index]??data.groups};
 const path=/PATH/i.test(`${station.name} ${route.name} ${station.source?.tags?.network??''}`);
 return {name:station.name,groups:[{routes:[path?'PATH':route.label==='MN'?'MN':route.kind==='commuter'?'Rail': ''],label:path?(station.source?.tags?.destination??'PATH platform'):route.label==='MN'?'Metro-North':'Platform'}]};
}
export function combineSignInfo(info,others) {
 const groups=new Map();
 for(const item of [info,...others])for(const g of item.groups){const key=g.label;if(!groups.has(key))groups.set(key,{...g,routes:[]});groups.get(key).routes.push(...g.routes);}
 return {...info,groups:[...groups.values()].map(g=>({...g,routes:[...new Set(g.routes)].sort()}))};
}
export function routeBadge(id){return signData.routes[id]??{label:id,color:id==='MN'?'#0039a6':'#555e68',text:'#ffffff'};}
/** Canvas is deliberately separate from mesh construction for readable tests. */
export function paintSign(canvas,info,{heading=info.name}={}) {
 const rows=Math.max(1,info.groups.length);canvas.width=1024;canvas.height=58+rows*66;
 const c=canvas.getContext('2d');
 c.fillStyle='#101419';c.fillRect(0,0,canvas.width,canvas.height);
 c.fillStyle='#fff';c.textAlign='left';c.textBaseline='middle';c.font='bold 36px sans-serif';c.fillText(heading,22,29,980);
 c.fillStyle='#737b82';c.fillRect(22,56,980,2);
 info.groups.forEach((group,i)=>{
  const y=90+i*66;let x=22;
  for(const id of group.routes.filter(Boolean)){
   const badge=routeBadge(id),radius=25;
   c.fillStyle=badge.color;c.beginPath();c.arc(x+radius,y,radius,0,Math.PI*2);c.fill();
   c.fillStyle=badge.text;c.font=`bold ${badge.label.length>1?20:34}px sans-serif`;c.textAlign='center';c.fillText(badge.label,x+radius,y+1,46);x+=62;
  }
  c.textAlign='left';c.fillStyle='#fff';c.font='bold 36px sans-serif';c.fillText(group.label,x+12,y,990-x);
 });
 return canvas;
}

// Furniture repeats every 18 metres; boards occupy the clear middle of a bay.
export const boardPosition=s=>Math.floor(s/18)*18+9;
