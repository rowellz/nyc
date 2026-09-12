/** Publish shared lane assignments and the recovered traffic classes. */
import {readFileSync,writeFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
const root=new URL('../',import.meta.url);
for(const name of ['lane-layout.js','lane-paths.js','edges.js'])writeFileSync(new URL('public/world/assets/'+name,root),readFileSync(new URL('src/client/src/streets/'+name,root)));
const source=name=>stripTypeScriptTypes(readFileSync(new URL('src/client/src/vehicles/'+name+'.ts',root),'utf8')
 .replace(/^import[\s\S]*?;\n/gm,'').replace(/^export /gm,'')
 .replace('constructor(private ctx: GameContext) {}','constructor(ctx: GameContext) { this.ctx = ctx; }')
 .replace('constructor(private ctx: GameContext, private roads: Roads) {}','constructor(ctx: GameContext, roads: Roads) { this.ctx = ctx; this.roads = roads; }')).replace(/[\t ]+$/gm, '');
const path=new URL('public/world/assets/vehicles-_zJz3z3J.js',root);let code=readFileSync(path,'utf8');
const start=code.indexOf('ln=(e,t,n)=>'),end=code.indexOf(';function wn(',start);
if(start<0||end<start)throw new Error('Cannot locate served traffic classes');
const body=`ln=(e,t,n)=>\`\${Math.round(e*2)},\${Math.round(t*2)},\${n}\`, $laneClasses=(()=>{
const highwayLanePath=$highwayLanePath,isHighway=$isHighway,laneCount=$laneCount,laneWidth=$laneWidth,lanePoint=$lanePoint;
const isIOS=e,TILE_SIZE=256,KINDS=Z,hash01=ht,pickKind=vt,makeCar=kt,ground=jt,poseMatrix=At,removeBody=Q,createObstacle=Mt,distance2=$,trafficHeight=$tunnelHeight,tunnelConnections=$tunnelConnections;
${source('roads')}
${source('traffic')}
return {Roads,Traffic,isAvenue};})(),vn=$laneClasses.Roads,Cn=$laneClasses.Traffic,_n=$laneClasses.isAvenue`;
code=code.slice(0,start)+body+code.slice(end);
if(!code.includes('highwayLanePath as $highwayLanePath'))code="import { highwayLanePath as $highwayLanePath, lanePoint as $lanePoint } from './lane-paths.js';\nimport { isHighway as $isHighway, laneCount as $laneCount, laneWidth as $laneWidth } from './lane-layout.js';\n"+code;
writeFileSync(path,code);
console.log('Published shared motorway lane geometry and traffic routing.');
