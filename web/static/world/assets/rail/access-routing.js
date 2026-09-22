import {pathFrom,pathFloor} from './access-plan.js?v=rail-road-crossings-90';

// Route a level passage around the occupied volumes of neighboring stair
// flights. This runs before tile ownership, against the complete station plan.
export function routeConcourse(entry,hub,flights) {
 const flightEnd=entry.flightEnd??1;
 const base=entry.path[flightEnd].y,start=entry.path[flightEnd],goal=entry.path.at(-2),finish=entry.path.at(-1);
 const obstacles=flights.filter(path=>Math.abs(path[0].y-path.at(-1).y)>.1&&path.some(p=>Math.hypot(p.x-start.x,p.z-start.z)<350));
 const blocked=p=>obstacles.some(path=>{const y=pathFloor(path,p.x,p.z,2.1);return y!==null&&y>base+.25&&y<base+2.8;});
 const clear=(a,b)=>{const n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.5));for(let j=1;j<=n;j++)if(blocked({x:a.x+(b.x-a.x)*j/n,z:a.z+(b.z-a.z)*j/n}))return false;return true;};
 if(entry.path.slice(flightEnd+1).every((p,i)=>clear(entry.path[i+flightEnd],p)))return {entry,rerouted:false};
 const a=hub.path[0],b=hub.path[1],length=Math.hypot(b.x-a.x,b.z-a.z),dx=(b.x-a.x)/length,dz=(b.z-a.z)/length,step=1.5;
 const gx=((goal.x-start.x)*dx+(goal.z-start.z)*dz)/step,gz=(-(goal.x-start.x)*dz+(goal.z-start.z)*dx)/step;
 const point=(x,z)=>({x:start.x+(dx*x-dz*z)*step,y:base,z:start.z+(dz*x+dx*z)*step});
 const heap=[],best=new Map(),key=(x,z)=>`${x}:${z}`;
 function push(n){let i=heap.length;heap.push(n);while(i){const p=(i-1)>>1;if(heap[p].f<=n.f)break;heap[i]=heap[p];i=p;}heap[i]=n;}
 function pop(){const first=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1].f<heap[c].f)c++;if(heap[c].f>=last.f)break;heap[i]=heap[c];i=c;}heap[i]=last;}return first;}
 const initial={x:0,z:0,g:0,f:Math.abs(gx)+Math.abs(gz),previous:null};push(initial);best.set('0:0',0);
 let end=null,iterations=0;
 while(heap.length&&iterations++<50000) {
  const node=pop();if(node.g!==best.get(key(node.x,node.z)))continue;
  const p=point(node.x,node.z);
  if(Math.hypot(node.x-gx,node.z-gz)<1.5&&clear(p,goal)){end=node;break;}
  for(const [x,z] of [[node.x+1,node.z],[node.x-1,node.z],[node.x,node.z+1],[node.x,node.z-1]]) {
   if(x<Math.min(0,gx)-30||x>Math.max(0,gx)+30||z<Math.min(0,gz)-30||z>Math.max(0,gz)+30)continue;
   const g=node.g+1;if(g>=(best.get(key(x,z))??Infinity)||!clear(p,point(x,z)))continue;
   best.set(key(x,z),g);push({x,z,g,f:g+Math.abs(x-gx)+Math.abs(z-gz),previous:node});
  }
 }
 if(!end)return {entry,rerouted:false,blocked:true};
 const points=[];for(let n=end;n;n=n.previous)points.push(point(n.x,n.z));points.reverse();points.push(goal,finish);
 const compact=entry.path.slice(0,flightEnd);
 for(let i=0;i<points.length;i++) {
  const p=points[i],last=compact.at(-1),next=points[i+1];
  if(next&&i>0&&Math.abs((p.x-last.x)*(next.z-p.z)-(p.z-last.z)*(next.x-p.x))<.00001&&clear(last,next))continue;
  if(Math.hypot(p.x-last.x,p.z-last.z)>.01)compact.push(p);
 }
 return {entry:{...entry,path:pathFrom(compact)},rerouted:true};
}
