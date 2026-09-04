import{o as e}from"./quality-BuEwAkMy.js";import{f as t,p as n}from"./index-DQv-X5z6.js";import{At as r,B as i,Bt as a,C as o,Dr as s,Et as c,Gt as l,Hn as u,K as d,Mr as f,Nt as p,Or as m,Ot as h,P as g,Pt as _,Q as v,Qn as y,Ut as b,V as x,Yn as S,Z as C,Zn as w,Zt as T,_t as E,an as D,ar as O,dr as k,g as A,gt as j,h as M,j as N,kr as P,kt as F,m as I,or as L,rt as R,ur as z,w as B,y as ee,yr as te,yt as ne}from"./textureRelease-2U-gT89r.js";import{t as re}from"./loading-DS_gLujL.js";import{a as ie}from"./geo-Db9f_zPw.js";import{t as ae}from"./BufferGeometryUtils-BXgKkxAN.js";import{a as oe,i as V,n as H,r as se,t as U}from"./geom-BgyHPiiG.js";import{o as W}from"./main-D_3aygO4.js";function ce(e){let t=2166136261;for(let n=0;n<e.length;n++)t^=e.charCodeAt(n),t=Math.imul(t,16777619);return(t>>>0).toString(36)}function G(e,t,n){let r=null,i=!1,a=function(t,a){if(!i){i=!0;try{n(t,a),r&&r.call(e,t,a)}finally{i=!1}}};Object.defineProperty(e,"onBeforeCompile",{configurable:!0,enumerable:!0,get:()=>a,set:t=>{r=typeof t==`function`&&t!==a?t:null,e.needsUpdate=!0}}),e.customProgramCacheKey=()=>r?`${t}|${ce(r.toString())}`:t}var le=`
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
`,ue=`
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
`,de=class{ctx;cv;c2;pxPerM=2;constructor(e){this.ctx=e;let t,n=null;typeof OffscreenCanvas<`u`?(t=new OffscreenCanvas(512,512),n=t.getContext(`2d`,{willReadFrequently:!0})):(t=document.createElement(`canvas`),t.width=t.height=512,n=t.getContext(`2d`,{willReadFrequently:!0})),n||=(t=document.createElement(`canvas`),t.width=t.height=512,t.getContext(`2d`,{willReadFrequently:!0})),this.cv=t,this.c2=n}paint(e,t){let n=e.tx*256,r=e.tz*256,i=t?.data??new Uint8ClampedArray(1048576);t&&i.fill(0);let a=this.c2,s=this.ctx.world,c=n+128,l=r+128,u=s.roadsNear(c,l,184.32),d=s.buildingsNear(c,l,184.32),f=e.parks,p=e=>(a.setTransform(1,0,0,1,0,0),a.clearRect(0,0,512,512),a.setTransform(this.pxPerM,0,0,this.pxPerM,-n*this.pxPerM,-r*this.pxPerM),e(),a.getImageData(0,0,512,512).data),m=(e,t)=>{if(e.length){a.fillStyle=t;for(let t of e)if(!(!t.length||t[0].length<3)){a.beginPath();for(let e of t)if(!(e.length<3)){a.moveTo(e[0][0],e[0][1]);for(let t=1;t<e.length;t++)a.lineTo(e[t][0],e[t][1]);a.closePath()}a.fill(`evenodd`)}}},h=(e,t,n)=>{a.strokeStyle=t,a.lineCap=`round`,a.lineJoin=`round`;for(let t of e){if(t.tunnel||t.bridge||t.pts.length<2)continue;let e=n(t);if(!(e<=0)){a.lineWidth=e,a.beginPath(),a.moveTo(t.pts[0][0],t.pts[0][1]);for(let e=1;e<t.pts.length;e++)a.lineTo(t.pts[e][0],t.pts[e][1]);a.stroke()}}},_=e=>e.cls===`footway`||e.cls===`steps`||e.cls===`pedestrian`||e.cls===`cycleway`,v=(e,t)=>{for(let n of f)if(H(e,t,n))return!0;return!1},y=u.filter(e=>_(e)&&e.pts.length>=2&&v(e.pts[Math.floor(e.pts.length/2)][0],e.pts[Math.floor(e.pts.length/2)][1])),b=(e,t)=>{for(let n=0,r=t;n<e.length;n+=4,r+=4)i[r]=e[n]};if(e.water.length&&b(p(()=>m(e.water,`#fff`)),0),f.length){b(p(()=>{m(f,`#fff`),m(e.plazas,`#000`),m(e.roadbeds,`#000`),m(e.sidewalks,`#000`),m(e.parking,`#000`),m(d.map(e=>e.footprint),`#000`),h(u,`#000`,e=>_(e)?Math.max(.8,(e.width||2.5)-.4):Math.max(3,e.width||6)+1)}),1);let t=e.plazas.filter(e=>se(e,f));t.length&&b(p(()=>m(t,`#fff`)),2),y.length&&b(p(()=>h(y,`#fff`,e=>(e.width||2.5)+1.6)),3)}if(t)return t.tex.needsUpdate=!0,t;let x=new g(i,512,512,D,te);return x.minFilter=j,x.magFilter=j,x.generateMipmaps=!1,x.wrapS=x.wrapT=o,x.colorSpace=``,x.needsUpdate=!0,{key:e.key,ox:n,oz:r,data:i,tex:x}}};function fe(e,t,n,r){let i=Math.min(511,Math.max(0,Math.floor((t-e.ox)/256*512))),a=Math.min(511,Math.max(0,Math.floor((n-e.oz)/256*512)));return e.data[(a*512+i)*4+r]}var K=-1.6,pe=.3999999999999999,me=-2.8,he=-.95,ge=1,_e=2.4,ve=1.1,ye=`
uniform sampler2D uMask;
uniform vec2 uMaskOrigin;
// Leave room for four CSM shadow maps and the environment on 16-sampler GPUs.
uniform sampler2D uAsphalt, uAsphaltN, uConcrete, uGrass, uGrassN, uGravel, uGravelN, uSoil, uSoilN;
uniform vec4 uTexScale;
uniform float uSoilScale;
uniform float uWetness, uSeason;
uniform vec3 uSafe;
varying vec2 vWorldXZ;
${le}
`,be=`
vec2 wp = vWorldXZ;
vec4 m = texture2D(uMask, (wp - uMaskOrigin) / ${256 .toFixed(1)});
if (m.r > 0.5) discard;
float camD = length(vViewPosition);
float n1 = envFbm(wp * 0.045);
float n2 = envNoise(wp * 0.5);
float n3 = envNoise(wp * 0.11 + 31.7);
// paved base: dark asphalt with concrete yards / lots
vec4 asA = envTexNoTile(uAsphalt, wp * uTexScale.x);
vec3 asN = envTexNoTile(uAsphaltN, wp * uTexScale.x).xyz;
float asR = 0.8 + n2 * 0.1;
vec4 coA = envTexNoTile(uConcrete, wp * uTexScale.y);
vec3 coN = mix(vec3(0.5, 0.5, 1.0), asN, 0.45);
float lot = smoothstep(0.44, 0.62, n1);
vec3 pavedC = mix(asA.rgb, coA.rgb, lot);
vec3 pavedN = mix(asN, coN, lot);
float pavedR = mix(asR, 0.74, lot);
// natural: lawn with dry patches, worn to dirt along paths and at the edges
vec4 grA = envTexNoTile(uGrass, wp * uTexScale.z);
vec3 grN = envTexNoTile(uGrassN, wp * uTexScale.z).xyz;
vec4 soA = envTexNoTile(uSoil, wp * uSoilScale);
vec3 soN = envTexNoTile(uSoilN, wp * uSoilScale).xyz;
vec4 gvA = envTexNoTile(uGravel, wp * uTexScale.w);
vec3 gvN = envTexNoTile(uGravelN, wp * uTexScale.w).xyz;
vec3 grassC = grA.rgb * mix(vec3(1.0), vec3(1.22, 1.04, 0.70), uSeason * smoothstep(0.52, 0.8, n3));
// The 1.4 m albedo repeat mips to its average across a lawn. Keep broad, world-fixed
// growth variation after that filtering, reusing the noise already sampled above.
grassC *= mix(0.78, 1.22, smoothstep(0.25, 0.75, n1));
// World-space size of this fragment. Procedural detail finer than the footprint has to be faded out
// rather than left to alias: unfiltered fract()/noise is exactly what flattened the lawn to one mat.
float envFp = max(fwidth(wp.x), fwidth(wp.y));
// 2-5 m patches of drier / darker turf. No mown lawn is one tone, and this is the scale that reads at 5-60 m.
float turf = envNoise(wp * 0.28 + 5.1) * 0.62 + n2 * 0.38;
grassC *= mix(vec3(1.0), mix(vec3(0.80, 0.85, 0.80), vec3(1.15, 1.11, 0.90), smoothstep(0.28, 0.74, turf)), 1.0 - smoothstep(1.1, 3.0, envFp));
// How close this fragment is to the edge of the grass polygon, from the mask 1.6 m out in each direction:
// gEdge ~1 hard against a kerb / lawn curb / path edge, gTramp the wider band people walk over.
float gEdge = 0.0, gTramp = 0.0;
if (m.g > 0.02) {
  vec2 mo = (wp - uMaskOrigin) / ${256 .toFixed(1)};
  float e = 1.6 / ${256 .toFixed(1)};
  float gMin = min(min(texture2D(uMask, mo + vec2(e, 0.0)).g, texture2D(uMask, mo - vec2(e, 0.0)).g), min(texture2D(uMask, mo + vec2(0.0, e)).g, texture2D(uMask, mo - vec2(0.0, e)).g));
  gEdge = (1.0 - smoothstep(0.0, 0.5, gMin)) * smoothstep(0.3, 0.7, m.g);
  gTramp = (1.0 - smoothstep(0.12, 0.9, gMin)) * smoothstep(0.4, 0.7, m.g);
}
float safeD = distance(wp, uSafe.xy);
if (safeD < uSafe.z) {
  // Bryant Park lawn: 1.8 m mowing bands along the lawn's long axis (bearing 119 deg), browner worn patches
  // where people sit, and a trampled band just inside the granite curb.
  vec2 dir = vec2(0.4848, -0.8746);
  float s = dot(wp, dir) / 3.6;
  float sw = fwidth(s);
  // Filtered square wave: soften the band edge to the pixel footprint, then drop the pattern once a whole
  // period is sub-pixel, so the stripes stay a stripe pattern at 40 m instead of averaging to flat green.
  float k = clamp(0.25 + sw * 1.5, 0.25, 0.5);
  float band = (smoothstep(0.5 - k, 0.5 + k, fract(s)) - 0.5) * 2.0 * (1.0 - smoothstep(0.30, 0.75, sw));
  float fade = 1.0 - smoothstep(uSafe.z * 0.85, uSafe.z, safeD);
  float patches = smoothstep(0.54, 0.82, envNoise(wp * 0.17 + 11.3) * 0.72 + 0.28 * envNoise(wp * 0.4 + 3.7));
  float worn = max(patches * 0.7 * (1.0 - smoothstep(1.0, 2.6, envFp)), gTramp * (0.35 + 0.5 * n2)) * fade;
  grassC *= 1.0 + band * 0.15 * fade * (1.0 - worn);
  grassC = mix(grassC, mix(grassC * vec3(1.45, 1.12, 0.55), soA.rgb * vec3(1.05, 0.95, 0.8), 0.45), worn * 0.65);
}
float gCov = smoothstep(0.30 + 0.25 * n2, 0.72 - 0.15 * n2, m.g);
float wear = clamp(m.a * 1.2 + (1.0 - gCov) * smoothstep(0.02, 0.35, m.g) * 0.8, 0.0, 1.0);
wear = smoothstep(0.15, 0.85, wear + 0.25 * (n2 - 0.5));
vec3 natC = mix(grassC, soA.rgb, wear);
vec3 natN = mix(grN, soN, wear);
float natR = mix(0.92, 0.95, wear);
float natAmt = smoothstep(0.03, 0.30, m.g);
vec3 col = mix(pavedC, natC, natAmt);
vec3 nrm = mix(pavedN, natN, natAmt);
float rough = mix(pavedR, natR, natAmt);
float gv = smoothstep(0.35, 0.65, m.b);
col = mix(col, gvA.rgb, gv);
nrm = mix(nrm, gvN, gv);
rough = mix(rough, 0.92, gv); // landmarks GRAVEL style roughness, so the promenade cap and the tile gravel match
// Ground contact: the strip right against a kerb, the lawn curb or a path edge sees almost no sky.
col *= 1.0 - 0.32 * gEdge;
// wetness: darker albedo, puddles in the low spots of paved ground
float pavedAmt = 1.0 - natAmt;
float puddle = smoothstep(0.50, 0.64, n2 * 0.5 + envNoise(wp * 0.23 + 7.3) * 0.5) * uWetness * pavedAmt;
col *= 1.0 - uWetness * mix(0.28, 0.55, pavedAmt);
rough = mix(rough, 0.10, max(puddle, uWetness * 0.6 * pavedAmt));
nrm = mix(nrm, vec3(0.5, 0.5, 1.0), puddle);
float nStr = 1.0 - smoothstep(25.0, 140.0, camD);
vec3 envNormalW = normalize(vec3((nrm.x * 2.0 - 1.0) * nStr, 1.0, -(nrm.y * 2.0 - 1.0) * nStr));
float envRough = rough;
diffuseColor.rgb *= col;
`,xe=`
varying float vWY;
varying vec2 vWXZ;
uniform float uWetness, uTime;
${le}
`,Se=`
float along = vWXZ.x + vWXZ.y;
float n = envFbm(vec2(along, vWY) * 1.7);
// streaks running down the face from the cap, bulkhead sections every ~6 m, rust bleeding from the tie rods
float streak = envNoise(vec2(along * 0.8, vWY * 0.15)) * (1.0 - smoothstep(-0.4, 0.4, vWY));
float joint = smoothstep(0.05, 0.0, abs(fract(along / 6.0) - 0.5) * 6.0 - 2.85);
float rust = smoothstep(0.78, 0.92, envNoise(vec2(along * 1.5, 0.0))) * (1.0 - smoothstep(-0.8, 0.2, vWY));
diffuseColor.rgb *= (0.85 + 0.3 * n) * (1.0 - 0.25 * streak) * (1.0 - 0.35 * joint);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.07, 0.03), rust * 0.6);
// high-water tide band (wet, dark) and the black-green slime below the mean waterline
float wl = 1.0 - smoothstep(-1.05, -0.35, vWY);
diffuseColor.rgb *= mix(1.0, 0.45, wl);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.065, 0.04), (1.0 - smoothstep(-1.55, -0.95, vWY)) * 0.75);
// pale salt/dry line just above the highest water
diffuseColor.rgb *= 1.0 + 0.25 * exp(-pow((vWY + 0.3) / 0.1, 2.0));
diffuseColor.rgb *= 1.0 - 0.35 * uWetness;
`,Ce=`
varying vec2 vFoamUv;
uniform float uTime, uWind2;
${le}
`,we=`
{
  float a = vFoamUv.x, x = vFoamUv.y; // metres along the wall, metres out from it
  float t = uTime;
  // waves slap the wall and wash back: a bright line hugging the face that surges outward every few seconds
  float surge = 0.5 + 0.5 * sin(a * 0.9 - t * 1.7 + envNoise(vec2(a * 0.25, t * 0.3)) * 4.0);
  float reach = 0.25 + 0.55 * surge;
  float edge = smoothstep(reach, reach - 0.35, x);
  float lace = envNoise(vec2(a * 3.0 + t * 0.4, x * 6.0 - t * 1.1)) * 0.6 + envNoise(vec2(a * 9.0 - t * 0.7, x * 14.0)) * 0.4;
  float foam = edge * smoothstep(0.35, 0.75, lace + 0.25 * surge) * (0.35 + 0.65 * surge);
  diffuseColor.a = clamp(foam, 0.0, 1.0) * 0.85;
}
`;function Te(e,t,n,i,a={}){let o={uAsphalt:{value:n.asphalt.map},uAsphaltN:{value:n.asphalt.normal},uConcrete:{value:n.concrete.map},uGrass:{value:n.grass.map},uGrassN:{value:n.grass.normal},uGravel:{value:n.gravel.map},uGravelN:{value:n.gravel.normal},uSoil:{value:n.soil.map},uSoilN:{value:n.soil.normal},uTexScale:{value:new P(1/n.asphalt.size,1/n.concrete.size,1/n.grass.size,1/n.gravel.size)},uSoilScale:{value:1/n.soil.size}};function c(e){let t=new _({color:16777215,roughness:1,metalness:0,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1}),n={value:e.tex},r={value:new s(e.ox,e.oz)};return G(t,`env-ground-v6`,e=>{Object.assign(e.uniforms,o,{uMask:n,uMaskOrigin:r,uWetness:i.uWetness,uSeason:i.uSeason,uSafe:i.uSafe}),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec2 vWorldXZ;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+ye).replace(`#include <map_fragment>`,be).replace(`#include <roughnessmap_fragment>`,`float roughnessFactor = envRough;`).replace(`#include <normal_fragment_maps>`,`normal = normalize((viewMatrix * vec4(envNormalW, 0.0)).xyz);`)}),t}let u=new _({vertexColors:!0,roughness:.92,metalness:0});G(u,`env-seawall-v3`,e=>{e.uniforms.uWetness=i.uWetness,e.uniforms.uTime=i.uTime,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying float vWY; varying vec2 vWXZ;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vec4 envWP = modelMatrix * vec4(transformed, 1.0); vWY = envWP.y; vWXZ = envWP.xz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+xe).replace(`#include <map_fragment>`,Se)});let d=new _({color:3356474,roughness:.5,metalness:.55}),f=new I(.06,ge,.06);f.translate(0,ge/2,0);let p=new _({color:14212310,roughness:.9,metalness:0,transparent:!0,depthWrite:!1,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-4});G(p,`env-foam-v1`,e=>{e.uniforms.uTime=i.uTime,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec2 vFoamUv;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vFoamUv = uv;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+Ce).replace(`#include <map_fragment>`,we)});let m=new l(1,1).rotateX(-Math.PI/2),g=new r({color:16777215,transparent:!0,depthWrite:!1,toneMapped:!1,fog:!1,blending:5,blendEquation:100,blendSrc:200,blendDst:202,blendSrcAlpha:200,blendDstAlpha:201});G(g,`env-contact-v1`,e=>{e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec2 vAoXZ; varying float vAoD;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vAoXZ = position.xz;`).replace(`#include <project_vertex>`,`#include <project_vertex>
vAoD = -mvPosition.z;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
varying vec2 vAoXZ; varying float vAoD;`).replace(`#include <map_fragment>`,`float aoR = length(vAoXZ) * 2.0;
float ao = 0.34 * (1.0 - smoothstep(0.18, 1.0, aoR)) * (1.0 - smoothstep(45.0, 90.0, vAoD));
diffuseColor.rgb = vec3(1.0 - ao);`)});let v=new _({color:3486511,roughness:1,metalness:0,polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:3});G(v,`env-far-v1`,e=>{e.uniforms.uWetness=i.uWetness,e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform float uWetness;`).replace(`#include <map_fragment>`,`diffuseColor.rgb *= 1.0 - 0.45 * uWetness;`)});let y=null,b=new Map,x=new Set;function S(e,t){t?x.add(e):x.delete(e);let n=b.get(e);if(n===void 0||!y)return;let r=y.geometry.getAttribute(`position`);for(let e=0;e<4;e++)r.setY(n*4+e,t?-3.6:-.25);r.addUpdateRange(n*12,12),r.needsUpdate=!0}function w(e,t){let n=e*256,r=t*256,i=new l(256,256,4,4);return i.rotateX(-Math.PI/2),i.translate(n+128,0,r+128),i.computeBoundingSphere(),i}function T(e,t){if(!e.trees.length)return null;let n=new R(m,g,e.trees.length),r=new h;for(let i=0;i<e.trees.length;i++){let a=e.trees[i],o=fe(t,a.x,a.z,2)>127?.205:fe(t,a.x,a.z,1)>127?.02:.168,s=Math.min(2.4,Math.max(.8,.5+Math.max(0,a.dbh)*.0254*2));r.makeScale(s*2,1,s*2),r.setPosition(a.x,o,a.z),n.setMatrixAt(i,r)}return n.instanceMatrix.needsUpdate=!0,n.computeBoundingSphere(),n.name=`env-contact-${e.key}`,n.castShadow=n.receiveShadow=!1,n.matrixAutoUpdate=!1,n.renderOrder=2,n}function E(n,r){let i=c(r),o=new F(w(n.tx,n.tz),i);o.receiveShadow=!0,o.castShadow=!1,o.name=`env-ground-${n.key}`,o.matrixAutoUpdate=!1,t.add(o);let s=null,l=null;if(n.water.length){let r=De(n,a.skipEdge);if(r.wall&&(s=new F(r.wall,u),s.receiveShadow=!0,s.castShadow=e.quality.shadows,s.name=`env-seawall-${n.key}`,s.matrixAutoUpdate=!1,t.add(s)),r.rails||r.posts.length||r.foam){if(l=new C,l.name=`env-bulkhead-${n.key}`,l.matrixAutoUpdate=!1,r.rails){let e=new F(r.rails,d);e.castShadow=!1,e.receiveShadow=!0,e.matrixAutoUpdate=!1,l.add(e)}if(r.posts.length){let e=new R(f,d,r.posts.length),t=new h;r.posts.forEach((n,r)=>{t.makeRotationY(n.yaw),t.setPosition(n.x,n.y,n.z),e.setMatrixAt(r,t)}),e.instanceMatrix.needsUpdate=!0,e.computeBoundingSphere(),e.castShadow=!1,e.receiveShadow=!0,e.matrixAutoUpdate=!1,l.add(e)}if(r.foam){let e=new F(r.foam,p);e.receiveShadow=!0,e.matrixAutoUpdate=!1,e.renderOrder=3,l.add(e)}t.add(l)}}let m=T(n,r);return m&&t.add(m),{key:n.key,mesh:o,mat:i,seawall:s,extras:l,contact:m}}function D(e){if(t.remove(e.mesh),e.mesh.geometry.dispose(),e.mat.dispose(),e.seawall&&(t.remove(e.seawall),e.seawall.geometry.dispose()),e.extras){t.remove(e.extras);for(let t of e.extras.children){let e=t.geometry;e&&e!==f&&e.dispose(),t.isInstancedMesh&&t.dispose()}}e.contact&&(t.remove(e.contact),e.contact.dispose())}function O(e){o.uAsphalt.value=e.asphalt.map,o.uAsphaltN.value=e.asphalt.normal,o.uConcrete.value=e.concrete.map,o.uGrass.value=e.grass.map,o.uGrassN.value=e.grass.normal,o.uGravel.value=e.gravel.map,o.uGravelN.value=e.gravel.normal,o.uSoil.value=e.soil.map,o.uSoilN.value=e.soil.normal,o.uTexScale.value.set(1/e.asphalt.size,1/e.concrete.size,1/e.grass.size,1/e.gravel.size),o.uSoilScale.value=1/e.soil.size}function k(e){if(b.clear(),y&&=(t.remove(y),y.geometry.dispose(),null),!e||!e.tiles.length)return;let n=e.tiles.length,r=new Float32Array(n*12),i=new Float32Array(n*12),a=new Uint32Array(n*6),o=0;for(let t of e.tiles){let[e,n]=t.split(`_`).map(Number);if(!Number.isFinite(e)||!Number.isFinite(n))continue;b.set(t,o);let s=e*256,c=n*256,l=x.has(t)?-3.6:-.25,u=o*12;r.set([s,l,c,s+256,l,c,s+256,l,c+256,s,l,c+256],u),i.set([0,1,0,0,1,0,0,1,0,0,1,0],u);let d=o*4;a.set([d,d+2,d+1,d,d+3,d+2],o*6),o++}let s=new A;s.setAttribute(`position`,new M(r.subarray(0,o*12),3)),s.setAttribute(`normal`,new M(i.subarray(0,o*12),3)),s.setIndex(new M(a.subarray(0,o*6),1)),s.computeBoundingSphere(),y=new F(s,v),y.name=`env-far-ground`,y.receiveShadow=!0,y.matrixAutoUpdate=!1,y.frustumCulled=!1,t.add(y)}return{addTile:E,removeTile:D,setTextures:O,buildFar:k,setTileLoaded:S,dispose(){u.dispose(),d.dispose(),p.dispose(),f.dispose(),m.dispose(),g.dispose(),v.dispose(),y&&(t.remove(y),y.geometry.dispose())}}}function Ee(e,t,n,r,i,a,o,s,c,l,u,d){let f=e.length/3,p=s*d/2,m=c*d/2,h=[[r-p,i-m],[a-p,o-m],[a+p,o+m],[r+p,i+m]],g=[[0,1,l,u,-s,0,-c],[2,3,l,u,s,0,c],[1,2,l,u,a-r,0,o-i],[3,0,l,u,r-a,0,i-o]],_=f;for(let[r,i,a,o,s,c,l]of g){let u=Math.hypot(s,l)||1,[d,f]=h[r],[p,m]=h[i];e.push(d,a,f,p,a,m,p,o,m,d,o,f);for(let e=0;e<4;e++)t.push(s/u,c,l/u);n.push(_,_+1,_+2,_,_+2,_+3,_,_+2,_+1,_,_+3,_+2),_+=4}for(let[n,r]of h)e.push(n,u,r),t.push(0,1,0);n.push(_,_+1,_+2,_,_+2,_+3,_,_+2,_+1,_,_+3,_+2)}function De(e,t){let n=e.tx*256,r=e.tz*256,i=[],a=[],o=[],s=[],c=[],l=[],u=[],f=[],p=.15,m=(e,t,i,a)=>Math.abs(e-n)<p&&Math.abs(i-n)<p||Math.abs(e-n-256)<p&&Math.abs(i-n-256)<p||Math.abs(t-r)<p&&Math.abs(a-r)<p||Math.abs(t-r-256)<p&&Math.abs(a-r-256)<p,h=e.water,g=(e,t,n)=>{for(let r of h)if(r!==n&&H(e,t,r))return!0;return!1},_=[],v=[],y=[],b=[],x=[],S=new B(5790293),C=new B(8223349),w=new B(5063220);for(let d of h){if(!d.length)continue;let h=!d[0].some(([e,t])=>Math.abs(e-n)<p||Math.abs(e-n-256)<p||Math.abs(t-r)<p||Math.abs(t-r-256)<p)&&se(d,e.parks),T=h?w:S,E=h?w:C;for(let e=0;e<d.length;e++){let n=d[e];if(n.length<3)continue;let r=oe(n)<0,p=e>0;for(let e=0;e<n.length;e++){let[S,C]=n[e],[w,D]=n[(e+1)%n.length];if(m(S,C,w,D))continue;let O=w-S,k=D-C,A=Math.hypot(O,k);if(A<.05)continue;let j=-k/A,M=O/A;r||(j=-j,M=-M),p&&(j=-j,M=-M);let N=(S+w)/2,P=(C+D)/2;if(g(N-j*.4,P-M*.4,d))continue;let F=!h&&!!t&&t(N,P),I=h?.12:F?he:pe,L=_.length/3;_.push(S,me,C,w,me,D,w,I,D,S,I,C);for(let e=0;e<4;e++)v.push(j,0,M);b.push(0,0,A,0,A,1,0,1),-k*j+O*M>0?y.push(L,L+1,L+2,L,L+2,L+3):y.push(L,L+2,L+1,L,L+3,L+2);for(let e=0;e<4;e++)x.push(T.r,T.g,T.b);if(F)continue;let R=h?1.2:.45,z=_.length/3,B=h?.04:I;_.push(S,I,C,w,I,D,w-j*R,B,D-M*R,S-j*R,B,C-M*R);for(let e=0;e<4;e++)v.push(0,1,0);b.push(0,0,A,0,A,R,0,R),-k*j*R+O*M*R>0?y.push(z,z+1,z+2,z,z+2,z+3):y.push(z,z+2,z+1,z,z+3,z+2);for(let e=0;e<4;e++)x.push(E.r,E.g,E.b);if(h)continue;let ee=-j*.2,te=-M*.2,ne=S+ee,re=C+te,ie=w+ee,ae=D+te,oe=O/A,V=k/A;for(let[e,t,n]of[[I+ge-.06,I+ge,.06],[I+ge*.55,I+ge*.55+.035,.035],[I+.1,I+.135,.035]])Ee(i,a,o,ne,re,ie,ae,j,M,e,t,n);let H=Math.max(1,Math.ceil(A/_e)),se=Math.atan2(oe,V);for(let t=0;t<=H;t++){if(t===H&&A>.6&&e+1<n.length)continue;let r=Math.min(A,A/H*t);s.push({x:ne+oe*r,y:I,z:re+V*r,yaw:se})}let W=c.length/3,ce=-1.57,G=.7+.6*U(S,C);c.push(S,ce,C,w,ce,D,w+j*ve*G,ce,D+M*ve*G,S+j*ve*G,ce,C+M*ve*G);for(let e=0;e<4;e++)l.push(0,1,0);u.push(0,0,A,0,A,ve*G,0,ve*G),k*j-O*M>0?f.push(W,W+1,W+2,W,W+2,W+3):f.push(W,W+2,W+1,W,W+3,W+2)}}}let T=(e,t,n,r,i)=>{if(!e.length)return null;let a=new A;return a.setAttribute(`position`,new d(e,3)),a.setAttribute(`normal`,new d(t,3)),r&&a.setAttribute(`uv`,new d(r,2)),i&&a.setAttribute(`color`,new d(i,3)),a.setIndex(n),a.computeBoundingSphere(),a};return{wall:T(_,v,y,b,x),rails:T(i,a,o),posts:s,foam:T(c,l,f,u)}}var Oe=`
uniform sampler2D uWaterN;
uniform sampler2D uMirrorTex;
uniform float uTime, uRain;
uniform vec3 uWaterHorizon;
uniform float uWaterFogDensity, uWaterPostFog, uMirrorOn;
uniform vec2 uWind;
varying vec2 vWorldXZ;
varying vec4 vMirrorClip;
${le}
vec2 envRot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// Smooth, non-periodic-in-UV phase offsets break the normal image's square
// lattice without extra texture fetches or discontinuous per-cell rotations.
vec2 envWaterUV(vec2 uv, float fade) {
  return uv + fade * 0.23 * vec2(sin(dot(uv, vec2(1.73, 2.31))), sin(dot(uv, vec2(-2.17, 1.41))));
}
vec2 envRainRipples(vec2 p, float t) {
  vec2 acc = vec2(0.0);
  vec2 cell = floor(p * 2.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = cell + vec2(float(i), float(j));
    vec2 h = envHash22(c);
    vec2 center = (c + h) * 0.5;
    float phase = fract(t * 1.4 + envHash12(c * 1.7 + 3.1));
    float r = length(p - center);
    float ringR = phase * 0.42;
    float ring = exp(-pow((r - ringR) / 0.045, 2.0)) * (1.0 - phase);
    acc += normalize(p - center + vec2(1e-4)) * ring * sin((r - ringR) * 70.0);
  }
  return acc;
}
`,ke=`
vec2 envSlope = vec2(0.0); // world-space wave slope, filled by the normal block, used by the planar mirror
vec2 wp = vWorldXZ;
float ws = length(uWind);
vec2 wd = ws > 0.01 ? uWind / ws : vec2(0.7, 0.7);
float wDist = length(vViewPosition);
// Silt-laden estuary: broad, slow drifts of turbidity (hundreds of metres), never 50 m blotches.
float murk = envFbm(wp * 0.005 + uTime * 0.003) * 0.65 + envNoise(wp * 0.028 - uTime * 0.008) * 0.35;
diffuseColor.rgb *= mix(0.86, 1.14, murk);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.075, 0.068, 0.046), smoothstep(0.55, 0.85, murk) * 0.35); // brown silt plumes
// wind streaks: long dark/light lanes along the wind (Hudson from the shore)
float lane = envNoise(vec2(dot(wp, vec2(-wd.y, wd.x)) * 0.05, dot(wp, wd) * 0.006 + uTime * 0.01));
diffuseColor.rgb *= mix(0.94, 1.06, lane);
// whitecaps only in real wind (>4 m/s), breaking crests aligned with it, near field only
float capN = envNoise(wp * 0.35 + wd * uTime * 0.18) * 0.6 + envNoise(wp * 1.3 - wd * uTime * 0.4) * 0.4;
float cap = smoothstep(0.72, 0.80, capN) * smoothstep(4.0, 10.0, ws) * (1.0 - smoothstep(120.0, 500.0, wDist));
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.58, 0.56), cap);
// Oily flats: slow patches 100-300 m long, stretched ~3x along the wind, where the chop is damped and the water
// turns to a darker, sharper mirror of the sky (the Hudson from the shore: dark glassy lanes between chop).
vec2 wpp = vec2(-wd.y, wd.x);
float envSlick = smoothstep(0.54, 0.70, envFbm(vec2(dot(wp, wd) * 0.0045, dot(wp, wpp) * 0.013) + uTime * 0.0015));
envSlick *= 1.0 - smoothstep(1.0, 9.0, ws) * 0.7 - uRain;
envSlick = clamp(envSlick, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0, 0.86, envSlick);
// Looking upwind you see the steep windward faces (brighter, rougher); downwind the backs (darker, smoother).
vec2 envViewXZ = normalize(wp - cameraPosition.xz + vec2(1e-4, 0.0));
float envUpwind = dot(envViewXZ, -wd) * 0.5 + 0.5;
// Roughness: glassy facets close up (the sun glitters, the sky reflects as a broken mirror); chop that the
// normal octaves no longer resolve with distance becomes lobe width instead of vanishing into a flat mirror.
float envLod = smoothstep(20.0, 400.0, wDist);
float envRough = mix(0.05, 0.24, envLod) + 0.08 * smoothstep(1.0, 9.0, ws) + 0.25 * uRain;
envRough += 0.05 * (envUpwind - 0.5);
envRough *= mix(1.0, 0.45, envSlick);
envRough = mix(envRough, 0.75, cap);
`,Ae=`
{
  vec2 wp = vWorldXZ;
  float ws = length(uWind);
  vec2 wd = ws > 0.01 ? uWind / ws : vec2(0.7, 0.7);
  float t = uTime;
  float d = length(vViewPosition);
  float nearWarp = 1.0 - smoothstep(30.0, 120.0, d);
  // Fade short waves first; the old common cutoff kept the repeating pattern
  // sharp for hundreds of metres, then flattened every octave into a hard band.
  // Swell (20-40 m, slow, low slope: 30 cm on 30 m is ~0.06 rad) under four chop octaves at non-harmonic
  // scales/rotations so no repeat shows; short waves fade first with distance.
  vec2 uv0 = envRot(wp / 31.0, 0.35) + wd * t * 0.020;
  vec2 uv1 = envRot(wp / 61.0, -0.4) + wd * t * 0.010;
  vec2 uv2 = envRot(wp / 17.0, 0.9) - wd * t * 0.04;
  vec2 uv3 = envRot(wp / 5.3, 2.1) + wd * t * 0.09;
  vec2 uv4 = envRot(wp / 1.7, -0.7) - envRot(wd, 0.5) * t * 0.16;
  vec3 n0 = texture2D(uWaterN, uv0).xyz * 2.0 - 1.0;
  vec3 n1 = texture2D(uWaterN, envWaterUV(uv1, nearWarp)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(uWaterN, envWaterUV(uv2, nearWarp)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(uWaterN, envWaterUV(uv3, nearWarp)).xyz * 2.0 - 1.0;
  vec3 n4 = texture2D(uWaterN, envWaterUV(uv4, nearWarp)).xyz * 2.0 - 1.0;
  // Real wind-chop slopes are ~0.1-0.25 rms; the old 0.8/0.7 weights tilted the far water 30-40 degrees, so
  // every distant facet mirrored the dark lower hemisphere (navy speckle) instead of the sky. The 61 m octave
  // at 0.22 was a 2 m swell: the far field read as uniform-contrast corrugation instead of broad sky mirror.
  float chop = 0.6 + 0.6 * smoothstep(0.0, 9.0, ws);
  float mediumFade = 1.0 - smoothstep(80.0, 600.0, d);
  float fineFade = 1.0 - smoothstep(20.0, 160.0, d);
  // Distance alone misses grazing-angle/subpixel waves in the near field.
  float footprint = max(length(dFdx(wp)), length(dFdy(wp)));
  fineFade *= 1.0 - smoothstep(0.06, 0.22, footprint);
  float finestFade = (1.0 - smoothstep(4.0, 28.0, d)) * (1.0 - smoothstep(0.02, 0.08, footprint));
  // micro-chop at half its old weight near the camera; damped further on the oily flats (the swell stays)
  float slickDamp = mix(1.0, 0.25, envSlick);
  vec2 swell = n0.xy * 0.07 + n1.xy * 0.08;
  vec2 nxy = swell * (0.8 + 0.4 * chop)
    + (n2.xy * 0.15 * mediumFade + n3.xy * 0.10 * fineFade + n4.xy * 0.05 * finestFade) * chop * slickDamp;
  if (uRain > 0.01 && fineFade > 0.0) nxy += envRainRipples(wp, t) * uRain * 0.55 * fineFade;
  nxy *= 1.0 - smoothstep(600.0, 5000.0, d);
  envSlope = nxy;
  vec3 nW = normalize(vec3(nxy.x, 1.0, -nxy.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;function je(e,t,n,r=!0){let i=new p({color:new B().setRGB(.04,.055,.05,ne),roughness:.08,metalness:0,ior:1.333,specularIntensity:1,envMapIntensity:.8,fog:!0,depthWrite:!0,polygonOffset:!0,polygonOffsetFactor:2,polygonOffsetUnits:4}),a={value:t},o=r?new f(2,2,{type:v,minFilter:j,magFilter:j,depthBuffer:!0,generateMipmaps:!1}):null;o&&(o.texture.name=`water.skyline-mirror`);let c=new b,u={value:o?.texture??null},d={value:new h},g={value:0},_={uWaterHorizon:{value:new B(10201786)},uWaterFogDensity:{value:24e-5},uWaterPostFog:{value:0}};G(i,`env-water-v7`,e=>{Object.assign(e.uniforms,_,{uWaterN:a,uTime:n.uTime,uRain:n.uRain,uWind:n.uWind,uMirrorTex:u,uMirrorMat:d,uMirrorOn:g}),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying vec2 vWorldXZ;
varying vec4 vMirrorClip;
uniform mat4 uMirrorMat;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
vec4 envWPos = modelMatrix * vec4(transformed, 1.0);
vWorldXZ = envWPos.xz;
vMirrorClip = uMirrorMat * envWPos;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+Oe).replace(`#include <map_fragment>`,ke).replace(`#include <roughnessmap_fragment>`,`float roughnessFactor = envRough;`).replace(`#include <normal_fragment_maps>`,Ae).replace(`#include <opaque_fragment>`,`
        // With aerial perspective active, only close the distant horizon seam;
        // otherwise supply water fog here. Never apply two full fog layers.
        float waterD = length(vViewPosition);
        float waterFog = 1.0 - exp(-uWaterFogDensity * waterD);
        waterFog *= mix(1.0, smoothstep(4000.0, 11000.0, waterD), uWaterPostFog);
        #ifdef USE_FOG
          waterFog = 0.0;
        #endif
        vec3 envV = normalize(vViewPosition);
        float envCosT = clamp(dot(normal, envV), 0.0, 1.0);
        float envF = 0.02 + 0.98 * pow(1.0 - envCosT, 5.0);
        // Planar skyline mirror. The env map carries only sky, so the towers come from a second, half-res
        // render of the far-LOD layer through a camera reflected about the water plane, projected here by
        // world position. Fresnel decides how much of the body colour it replaces (0.65 at 5 deg grazing).
        if (uMirrorOn > 0.5) {
          vec2 mUv = vMirrorClip.xy / max(vMirrorClip.w, 1e-4);
          // The slope displaces the mirrored image. Keep the lateral term small: a reflected tower is a
          // vertical bar and sideways smear is what dissolves it, while vertical smear is what chop does.
          mUv += vec2(envSlope.x * 0.010, envSlope.y * 0.15) * (1.0 - smoothstep(1200.0, 6000.0, waterD));
          vec2 mEdge = min(mUv, 1.0 - mUv);
          float mIn = smoothstep(0.0, 0.02, min(mEdge.x, mEdge.y));
          if (mIn > 0.0) {
            vec2 mStep = vec2(0.0011, 0.0052) * clamp(envRough / 0.30, 0.15, 1.8);
            vec2 mLo = vec2(0.001), mHi = vec2(0.999);
            vec4 mC = texture2D(uMirrorTex, clamp(mUv, mLo, mHi)) * 0.36;
            mC += texture2D(uMirrorTex, clamp(mUv + vec2(0.0, mStep.y), mLo, mHi)) * 0.22;
            mC += texture2D(uMirrorTex, clamp(mUv - vec2(0.0, mStep.y), mLo, mHi)) * 0.22;
            mC += texture2D(uMirrorTex, clamp(mUv + vec2(mStep.x, 0.0), mLo, mHi)) * 0.10;
            mC += texture2D(uMirrorTex, clamp(mUv - vec2(mStep.x, 0.0), mLo, mHi)) * 0.10;
            // the mirror pass never goes through the aerial-perspective post pass: the reflected tower is at
            // least as far as the water carrying it, so ramp it toward the horizon colour by that distance.
            vec3 mRgb = mix(mC.rgb / max(mC.a, 1e-3), uWaterHorizon, 0.12 + 0.38 * smoothstep(60.0, 2200.0, waterD));
            outgoingLight = mix(outgoingLight, mRgb * 0.92, clamp(mC.a, 0.0, 1.0) * mIn * envF * (1.0 - cap));
          }
        }
        // Sun path: the GGX lobe gives the glitter; this broad lobe (sub-facet slopes the normal octaves do not
        // carry, foam, spray) is the soft body of the path that widens toward the camera when the sun faces it.
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 envR = reflect(-envV, normal);
          float envMu = max(dot(envR, directionalLights[0].direction), 0.0);
          outgoingLight += directionalLights[0].color * (pow(envMu, 26.0) * 0.13 + pow(envMu, 6.0) * 0.030) * envF * (1.0 - cap);
        }
        #endif
        outgoingLight *= mix(0.95, 1.05, envUpwind);
        outgoingLight = mix(outgoingLight, uWaterHorizon, waterFog);
        #include <opaque_fragment>`)});let y=new l(26e3,26e3,1,1);y.rotateX(-Math.PI/2);let x=new F(y,i);x.name=`env-water`,x.receiveShadow=!0,x.frustumCulled=!1,x.renderOrder=2,x.position.y=K,e.add(x);let S=.5,C=new h().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),w=new s,T=new B,E=new h,D=new m,O=new m,k=[],A=null,M=-1e9,N=!1,P=!1;return x.onBeforeRender=(e,t,n,r,a)=>{if(!o||!N||P||a!==i)return;let s=n;if(!s.isPerspectiveCamera)return;if(N=!1,!A?.parent){if(g.value=0,e.info.render.frame-M<30)return;M=e.info.render.frame,A=t.getObjectByName(`buildings-far`)??null}if(!A?.parent||!A.visible||s.position.y<=-1.35){g.value=0;return}P=!0,E.extractRotation(s.matrixWorld),D.set(0,0,-1).applyMatrix4(E),O.set(0,1,0).applyMatrix4(E),c.position.set(s.position.x,2*K-s.position.y,s.position.z),c.up.set(O.x,-O.y,O.z),c.lookAt(c.position.x+D.x,c.position.y-D.y,c.position.z+D.z),c.fov=s.fov,c.aspect=s.aspect,c.near=s.near,c.far=Math.min(s.far,6e3),c.updateProjectionMatrix(),c.updateMatrixWorld(!0),d.value.copy(C).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse),e.getDrawingBufferSize(w);let l=Math.max(64,Math.min(720,Math.round(w.x*S))),u=Math.max(64,Math.min(720,Math.round(w.y*S)));(o.width!==l||o.height!==u)&&o.setSize(l,u);for(let e=A;e.parent;e=e.parent)for(let t of e.parent.children)t!==e&&t.visible&&(t.visible=!1,k.push(t));let f=e.getRenderTarget(),p=t.background,m=t.matrixWorldAutoUpdate,h=e.info.autoReset,_=e.shadowMap.autoUpdate,v=e.shadowMap.needsUpdate,y=e.getClearAlpha();e.getClearColor(T),t.background=null,t.matrixWorldAutoUpdate=!1,e.info.autoReset=!1,e.shadowMap.autoUpdate=!1,e.shadowMap.needsUpdate=!1;try{e.setRenderTarget(o),e.setClearColor(0,0),e.render(t,c),g.value=1}finally{e.setRenderTarget(f),e.setClearColor(T,y),t.background=p,t.matrixWorldAutoUpdate=m,e.shadowMap.autoUpdate=_,e.shadowMap.needsUpdate=v,e.info.autoReset=h;for(let e of k)e.visible=!0;k.length=0,P=!1}},{mesh:x,mat:i,update(e){x.position.x=e.position.x,x.position.z=e.position.z,x.updateMatrixWorld(),N=r},setEnvMap(e){i.envMap!==e&&(i.envMap=e,i.needsUpdate=!0)},setHaze(e,t,n){_.uWaterHorizon.value.copy(e),_.uWaterFogDensity.value=t,_.uWaterPostFog.value=+!!n},setNormalMap(e){a.value=e},dispose(){e.remove(x),x.onBeforeRender=()=>{},y.dispose(),i.dispose(),o?.dispose()}}}var Me=class{renderer;texture=null;pmrem;scene=new w;mat;rt=null;lastDay=-1;lastSun=new m(0,-1,0);lastAt=-1e9;constructor(e){this.renderer=e,this.pmrem=new W(e),this.mat=new y({side:1,depthWrite:!1,uniforms:{uSun:{value:new m(0,1,0)},uDay:{value:1}},vertexShader:`varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,fragmentShader:`
        varying vec3 vDir; uniform vec3 uSun; uniform float uDay;
        void main(){
          vec3 d = normalize(vDir); float h = clamp(d.y, -1.0, 1.0);
          vec3 zen = mix(vec3(0.012, 0.016, 0.03), vec3(0.14, 0.30, 0.66), uDay);
          vec3 hor = mix(vec3(0.03, 0.03, 0.045), vec3(0.60, 0.68, 0.80), uDay);
          vec3 gnd = mix(vec3(0.012, 0.012, 0.012), vec3(0.16, 0.15, 0.13), uDay);
          vec3 c = h > 0.0 ? mix(hor, zen, pow(h, 0.55)) : mix(hor, gnd, pow(-h, 0.4));
          float sd = max(0.0, dot(d, uSun));
          c += vec3(1.0, 0.86, 0.62) * (pow(sd, 500.0) * 30.0 + pow(sd, 6.0) * 0.3) * uDay;
          gl_FragColor = vec4(c, 1.0);
        }`});let t=new F(new L(500,24,16),this.mat);this.scene.add(t)}update(e,t,n){let r=this.lastSun.distanceTo(e)>.06||Math.abs(t-this.lastDay)>.08;if(this.texture&&!r||this.texture&&n-this.lastAt<4)return!1;this.lastAt=n,this.lastSun.copy(e),this.lastDay=t,this.mat.uniforms.uSun.value.copy(e),this.mat.uniforms.uDay.value=t;let i=this.rt;return this.rt=this.pmrem.fromScene(this.scene,0,1,2e3),this.texture=this.rt.texture,i&&i.dispose(),!0}dispose(){this.rt?.dispose(),this.pmrem.dispose(),this.mat.dispose(),this.scene.traverse(e=>{e instanceof F&&e.geometry.dispose()}),this.scene.clear()}},Ne=4;function Pe(){let e=[],t=[],n=[],r=[],i=[1,.72,.08];for(let a=0;a<3;a++){let o=a*Math.PI/3,s=Math.cos(o),c=Math.sin(o),l=e.length/3;for(let r=0;r<3;r++){let a=r/2,o=i[r]*.5;e.push(-o*s,a,-o*c,o*s,a,o*c),t.push(0,1,0,0,1,0),n.push(a,a)}for(let e=0;e+1<3;e++){let t=l+e*2;r.push(t,t+1,t+2,t+1,t+3,t+2)}}let a=new A;return a.setAttribute(`position`,new d(e,3)),a.setAttribute(`normal`,new d(t,3)),a.setAttribute(`aTip`,new d(n,1)),a.setIndex(r),a.boundingSphere=new O(new m,1e6),a}function Fe(e,t,n){let r={low:{n:6e3,r:7},medium:{n:18e3,r:9},high:{n:4e4,r:12},ultra:{n:6e4,r:13}}[t],i=r.r,a=Math.ceil(i*2/Ne)+1,o=a*a,c=Math.max(1,Math.floor(r.n/o)),l=c*o,u=new g(new Uint8Array(4),1,1,D,te);u.needsUpdate=!0;let d={uCamCell:{value:new s},uCell:{value:Ne},uRadius:{value:i},uPerCell:{value:c},uSide:{value:a},uBladeHeight:{value:new s(.05,.08)},uBladeBase:{value:new B(.038,.098,.048)},uBladeTip:{value:new B(.18,.3,.055)},uMask0:{value:u},uMask1:{value:u},uMask2:{value:u},uMask3:{value:u},uMaskO:{value:new s}},f=new _({color:16777215,roughness:.85,metalness:0,side:2});G(f,`env-grass-v5`,e=>{Object.assign(e.uniforms,d,{uTime:n.uTime,uWind:n.uWind,uSafe:n.uSafe,uSeason:n.uSeason,uWetness:n.uWetness}),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
uniform vec2 uCamCell; uniform float uCell, uRadius, uPerCell, uSide;
uniform vec2 uBladeHeight;
uniform sampler2D uMask0, uMask1, uMask2, uMask3; uniform vec2 uMaskO;
uniform float uTime, uSeason; uniform vec2 uWind; uniform vec3 uSafe;
attribute float aTip;
varying float vTip; varying vec3 vTint;
${ue}
float envMaskGrass(vec2 p) {
  vec2 rel = (p - uMaskO) / ${256 .toFixed(1)};
  vec2 sel = step(1.0, rel);
  vec2 uv = clamp(rel - sel, 0.0, 1.0);
  if (sel.x < 0.5) { return sel.y < 0.5 ? texture2D(uMask0, uv).g : texture2D(uMask2, uv).g; }
  return sel.y < 0.5 ? texture2D(uMask1, uv).g : texture2D(uMask3, uv).g;
}`).replace(`#include <begin_vertex>`,`
float envId = float(gl_InstanceID);
float envCellI = floor(envId / uPerCell);
float envK = envId - envCellI * uPerCell;
vec2 envCellOff = vec2(mod(envCellI, uSide), floor(envCellI / uSide)) - (uSide - 1.0) * 0.5;
vec2 envCell = uCamCell + envCellOff;
vec2 envH = envHash22(envCell * 7.31 + envK * 0.173);
vec2 envH2 = envHash22(envCell * 3.17 + envK * 0.611 + 5.0);
vec2 envP = (envCell + envH) * uCell;
float envD = distance(envP, cameraPosition.xz);
float envG = envMaskGrass(envP);
float envDens = 1.0 - smoothstep(uRadius * 0.25, uRadius, envD) * 0.85;
float envKeep = step(envH2.x, envDens) * step(0.5, envG) * step(envD, uRadius);
float envSafeD = distance(envP, uSafe.xy);
float envMowed = 1.0 - smoothstep(uSafe.z * 0.9, uSafe.z * 1.15, envSafeD);
// Bryant Park lawn: worn patches (same noise as the ground shader) carry shorter, sparser, browner blades
float envWorn = 0.7 * smoothstep(0.54, 0.82, envNoise(envP * 0.17 + 11.3) * 0.72 + 0.28 * envNoise(envP * 0.4 + 3.7)) * (1.0 - smoothstep(uSafe.z * 0.85, uSafe.z, envSafeD));
float envHgt = mix(uBladeHeight.x, uBladeHeight.y, envH2.y);
float envSc = envKeep * envHgt * (1.0 - smoothstep(uRadius * 0.55, uRadius, envD)) * (1.0 - 0.6 * envWorn);
float envYaw = envH.x * 6.2832;
float envCy = cos(envYaw), envSy = sin(envYaw);
vec3 transformed = vec3(position.x * envCy - position.z * envSy, position.y, position.x * envSy + position.z * envCy);
transformed.xz *= envSc * 0.16 * mix(1.0, 1.3, envMowed);
transformed.y *= envSc;
transformed.xz += vec2(envH2.x - 0.5, envH.y - 0.5) * 0.5 * position.y * position.y * envSc;
float envWl = length(uWind);
vec2 envWd = envWl > 0.01 ? uWind / envWl : vec2(1.0, 0.0);
float envGust = envNoise(envP * 0.12 - envWd * uTime * 0.9) * 0.7 + 0.3 * sin(uTime * 2.3 + envP.x * 0.8 + envP.y * 0.6 + envH.y * 6.28);
float envBend = position.y * position.y * (0.15 + 0.85 * min(envWl, 9.0) / 9.0) * envGust * 0.55;
transformed.xz += envWd * envBend * envSc;
vec3 envWpos = vec3(envP.x, 0.0, envP.y) + transformed;
vTip = aTip;
float envDry = smoothstep(0.52, 0.8, envNoise(envP * 0.11 + 31.7)) * uSeason;
// broad growth variation matching the ground shader's macro noise: darker damp patches, paler worn ones
float envMacro = envNoise(envP * 0.045);
vec3 envTint = mix(vec3(1.0), vec3(1.3, 1.1, 0.6), envDry) * (0.8 + 0.4 * envH2.y) * mix(0.8, 1.2, smoothstep(0.25, 0.75, envMacro));
// per-blade hue: turf is a mix of yellow-green and blue-green blades, never one flat colour
envTint *= mix(vec3(1.07, 1.0, 0.84), vec3(0.90, 1.0, 1.16), envHash12(envCell * 2.11 + envK * 0.37 + 17.0));
if (envSafeD < uSafe.z) {
  // mowing stripes along the streets (the lawn's long axis), matching ground.ts
  vec2 sdir = vec2(0.4848, -0.8746);
  float s = dot(envP, sdir) / 3.6;
  envTint *= 1.0 + (smoothstep(0.35, 0.65, fract(s)) - 0.5) * 2.0 * 0.13 * (1.0 - smoothstep(uSafe.z * 0.85, uSafe.z, envSafeD)) * (1.0 - envWorn);
  envTint = mix(envTint, envTint * vec3(1.45, 1.12, 0.55), envWorn * 0.85);
}
vTint = envTint;`).replace(`#include <project_vertex>`,`vec4 mvPosition = viewMatrix * vec4(envWpos, 1.0);
gl_Position = projectionMatrix * mvPosition;`).replace(`#include <worldpos_vertex>`,`vec4 worldPosition = vec4(envWpos, 1.0);`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
varying float vTip; varying vec3 vTint; uniform float uWetness; uniform vec3 uBladeBase, uBladeTip;`).replace(`#include <map_fragment>`,`vec3 envBase = mix(uBladeBase, uBladeTip, vTip);
diffuseColor.rgb *= envBase * vTint * (1.0 - 0.25 * uWetness);`).replace(`#include <normal_fragment_begin>`,`vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;`)});let p=Pe(),m=new R(p,f,l);return m.count=l,m.frustumCulled=!1,m.castShadow=!1,m.receiveShadow=!0,m.name=`env-grass`,m.instanceMatrix.setUsage(z),e.add(m),{mesh:m,update(e,t){let n=e.position.x,r=e.position.z;d.uCamCell.value.set(Math.floor(n/Ne),Math.floor(r/Ne));let a=Math.floor((n-128)/256),o=Math.floor((r-128)/256);d.uMaskO.value.set(a*256,o*256);let s=t(a,o),c=t(a+1,o),l=t(a,o+1),f=t(a+1,o+1);d.uMask0.value=s?s.tex:u,d.uMask1.value=c?c.tex:u,d.uMask2.value=l?l.tex:u,d.uMask3.value=f?f.tex:u;let p=!1;for(let e of[s,c,l,f]){if(!e)continue;let t=e.data,a=i+Ne;for(let i=r-a;i<=r+a&&!p;i+=a/4)for(let r=n-a;r<=n+a;r+=a/4){if(r<e.ox||r>=e.ox+256||i<e.oz||i>=e.oz+256)continue;let n=Math.floor((r-e.ox)/256*512);if(t[(Math.floor((i-e.oz)/256*512)*512+n)*4+1]>60){p=!0;break}}if(p)break}m.visible=p},dispose(){e.remove(m),m.dispose(),p.dispose(),f.dispose(),u.dispose()}}}var Ie=[`plane`,`locust`,`pear`,`ginkgo`,`oak`];function Le(e,t,n){let r=Math.imul(e|0,374761393)+Math.imul(t|0,668265263)+Math.imul(n|0,1274126177)|0;return r=Math.imul(r^r>>>13,1274126177),r^=r>>>16,(r>>>0)/4294967296}var Re=e=>e*e*(3-2*e),q=(e,t,n)=>e+(t-e)*n,ze=e=>e<0?0:e>1?1:e,J=(e,t,n)=>{let r=ze((n-e)/(t-e));return r*r*(3-2*r)};function Y(e,t,n,r,i){let a=Math.floor(e),o=Math.floor(t),s=Re(e-a),c=Re(t-o),l=e=>(e%n+n)%n,u=e=>(e%r+r)%r,d=Le(l(a),u(o),i),f=Le(l(a+1),u(o),i),p=Le(l(a),u(o+1),i),m=Le(l(a+1),u(o+1),i);return q(q(d,f,s),q(p,m,s),c)}function X(e,t,n,r,i,a,o=.5){let s=0,c=1,l=0,u=n,d=r;for(let n=0;n<i;n++)s+=Y(e*u,t*d,u,d,a+n*31)*c,l+=c,c*=o,u*=2,d*=2;return s/l}var Be=4;function Ve(e){Be=Math.min(8,Math.max(1,e))}function He(e,t,n,r){let i=new g(e,t,n,D,te);return i.wrapS=i.wrapT=u,i.minFilter=E,i.magFilter=j,i.generateMipmaps=!0,i.anisotropy=Be,i.colorSpace=r?S:``,i.needsUpdate=!0,i}function*Ue(e,t,n){let r=new Uint8Array(t*n*4);for(let i=0,a=0;i<t*n;i++,a+=4)i%t===0&&(yield),r[a]=ze(e[i*3])*255,r[a+1]=ze(e[i*3+1])*255,r[a+2]=ze(e[i*3+2])*255,r[a+3]=255;return He(r,t,n,!0)}function*We(e,t,n,r){let i=new Uint8Array(t*n*4);for(let a=0;a<n;a++){yield;let o=(a-1+n)%n,s=(a+1)%n;for(let n=0;n<t;n++){let c=(n-1+t)%t,l=(n+1)%t,u=(e[a*t+l]-e[a*t+c])*.5*r,d=(e[s*t+n]-e[o*t+n])*.5*r,f=-u,p=d,m=1,h=Math.hypot(f,p,m)||1;f/=h,p/=h,m/=h;let g=(a*t+n)*4;i[g]=(f*.5+.5)*255,i[g+1]=(p*.5+.5)*255,i[g+2]=(m*.5+.5)*255,i[g+3]=255}}return He(i,t,n,!1)}function*Ge(e,t,n){let r=new Uint8Array(t*n*4);for(let i=0,a=0;i<t*n;i++,a+=4){i%t===0&&(yield);let n=ze(e[i])*255;r[a]=n,r[a+1]=n,r[a+2]=n,r[a+3]=255}return He(r,t,n,!1)}function*Ke(e,t,n){let r=new Float32Array(e*t*3),i=new Float32Array(e*t),a=new Float32Array(e*t),o=[0,0,0,0,.8];for(let s=0;s<t;s++){yield;for(let c=0;c<e;c++){n(c/e,s/t,c,s,o);let l=s*e+c;r[l*3]=o[0],r[l*3+1]=o[1],r[l*3+2]=o[2],i[l]=o[3],a[l]=o[4]}}return{rgb:r,h:i,r:a}}function*qe(e,t,n,r,i,a){return{map:yield*Ue(e.rgb,t,n),normal:yield*We(e.h,t,n,i),rough:a?yield*Ge(e.r,t,n):null,size:r,procedural:!0}}function*Je(e){return yield*qe(yield*Ke(e,e,(t,n,r,i,a)=>{let o=X(t,n,6,6,4,11),s=X(t,n,120,120,2,12),c=Y(t*e,n*e,e,e,13),l=X(t+.31,n+.17,5,5,3,14),u=J(.035,0,Math.abs(l-.5))*J(.48,.62,o),d=J(.42,.78,s),f=J(.6,.8,X(t+.7,n+.2,3,3,3,15)),p=.26+.09*(o-.5)+.11*(d-.4)+.05*(c-.5)-.42*u+.07*f;a[0]=p*1,a[1]=p*1,a[2]=p*1.03,a[3]=d*.6+c*.25+o*.15-u*1.5,a[4]=.8+.15*d-.12*f}),e,e,2.4,2.2,!0)}function*Ye(e){return yield*qe(yield*Ke(e,e,(e,t,n,r,i)=>{let a=X(e,t,4,4,4,21),o=X(e,t,64,64,3,22),s=J(.72,.86,Y(e*200,t*200,200,200,23)),c=J(.56,.78,X(e+.3,t+.6,3,3,3,24)),l=.55+.07*(a-.5)+.06*(o-.5)-.09*s-.11*c;i[0]=l,i[1]=l*.985,i[2]=l*.955,i[3]=o*.5+a*.3-s,i[4]=.74+.1*o-.06*c}),e,e,3,1.6,!0)}function*Xe(e){return yield*qe(yield*Ke(e,e,(e,t,n,r,i)=>{let a=X(e,t,22,22,4,31),o=Y(e*180,t*26,180,26,32),s=Y(e*90+3,t*14,90,14,33),c=J(.56,.74,X(e,t,3,3,3,34)),l=J(0,.35,a),u=[.27,.4,.12],d=[.38,.46,.17],f=[.58,.51,.27];for(let e=0;e<3;e++){let t=q(q(u[e],d[e],a),f[e],c*.8);t*=(.7+.45*o)*(.85+.25*s)*(.72+.28*l),i[e]=t}i[3]=a*.55+o*.3+s*.15,i[4]=.9}),e,e,1.6,1.8,!1)}function*Ze(e){return yield*qe(yield*Ke(e,e,(e,t,n,r,i)=>{let a=X(e,t,30,30,3,41),o=Y(e*110,t*110,110,110,42),s=Y(e*180+7,t*180+3,180,180,43),c=J(.55,.66,o),l=J(.6,.7,s),u=Le(Math.floor(e*110),Math.floor(t*110),44),d=[.685,.634,.584],f=u<.3?[.535,.514,.522]:u<.6?[.77,.721,.684]:[.642,.568,.497];for(let e=0;e<3;e++){let t=d[e]*(.86+.28*a);t=q(t,f[e],c*.9),t=q(t,d[e]*1.12,l*.5),i[e]=t}i[3]=c*.8+l*.4+a*.2,i[4]=.86}),e,e,1.1,2.4,!1)}function*Qe(e){return yield*qe(yield*Ke(e,e,(t,n,r,i,a)=>{let o=X(t,n,12,12,4,51),s=J(.6,.72,Y(t*70,n*24,70,24,52)),c=J(.62,.74,Y(t*40+5,n*90,40,90,53)),l=Y(t*e,n*e,e,e,54),u=[.23,.17,.12],d=[.42,.31,.2];for(let e=0;e<3;e++){let t=u[e]*(.75+.5*o)*(.85+.3*l);t=q(t,d[e],s*.8),t=q(t,u[e]*.55,c*.7),a[e]=t}a[3]=s*.7+c*.4+l*.2,a[4]=.95}),e,e,1,1.6,!1)}function*$e(e){let t=[[3,1,.5,.3],[1,4,.42,1.7],[5,-3,.3,2.9],[-2,7,.24,.9],[8,5,.16,4.1],[11,-9,.12,2.2],[14,3,.08,5],[-6,13,.07,1.1]],n=new Float32Array(e*e);for(let r=0;r<e;r++){yield;for(let i=0;i<e;i++){let a=i/e,o=r/e,s=0;for(let[e,n,r,i]of t)s+=r*Math.sin(2*Math.PI*(e*a+n*o)+i);s+=(X(a,o,12,12,3,61)-.5)*.9,n[r*e+i]=s}}return yield*We(n,e,e,1.4)}function*et(e,t,n){return yield*qe(yield*Ke(t,n,(r,i,a,o,s)=>{let c=Y(r*t*.5,i*n*.5,t*.5,n*.5,71);if(e===`plane`){let e=X(r,i,6,4,3,72),t=X(r+.4,i+.2,4,3,3,73),n=X(r*1.3+.7,i+.5,9,6,2,77),a=J(.46,.53,e),o=J(.48,.56,t),l=J(.5,.58,n),u=[.8,.76,.6],d=[.56,.58,.38],f=[.47,.44,.36],p=[.34,.29,.22];for(let e=0;e<3;e++){let t=q(u[e],d[e],l),n=q(p[e],f[e],o);s[e]=q(n,t,a)*(.9+.2*c)}s[3]=.35*(1-a)+.25*o*(1-a)+.08*l+c*.1,s[4]=q(.9,.7,a)}else if(e===`dark`){let e=J(.36,.64,X(r,i,14,3,4,74)),t=[.12,.1,.08],n=[.36,.31,.26];for(let r=0;r<3;r++)s[r]=q(t[r],n[r],e)*(.85+.3*c);s[3]=e*1.2+c*.15,s[4]=.92}else{let e=J(.025,0,Math.abs(X(r,i,9,2,3,75)-.5)),t=J(.7,.8,Y(r*20,i*120,20,120,76)),n=.5-.22*e+.1*t;s[0]=n*1,s[1]=n*.97,s[2]=n*.92,s[3]=-e*1+t*.3+c*.1,s[4]=.8}}),t,n,.6,e===`dark`?3:1.5,!1)}function tt(e,t=e){if(typeof OffscreenCanvas<`u`)return new OffscreenCanvas(e,t);let n=document.createElement(`canvas`);return n.width=e,n.height=t,n}function nt(e){return e.getContext(`2d`,{willReadFrequently:!0})}function rt(e,t,n,r,i,a=.9){e.beginPath();for(let o=0;o<=40;o++){let s=o/40*Math.PI*2,c=t*(1-r+r*Math.abs(Math.cos(n*s/2))**+a),l=Math.sin(s)*c,u=-Math.cos(s)*c*i;o===0?e.moveTo(l,u):e.lineTo(l,u)}e.closePath()}function it(e,t){e.beginPath(),e.moveTo(0,-t),e.bezierCurveTo(t*.72,-t*.55,t*.7,t*.5,0,t),e.bezierCurveTo(-t*.7,t*.5,-t*.72,-t*.55,0,-t),e.closePath()}function at(e){switch(e){case`plane`:return{base:[84,128,50],vary:18,count:76,size:25,sprite:!1,draw:(e,t)=>{rt(e,t,5,.46,1.05,.55),e.fill(),e.beginPath();for(let n=-2;n<=2;n++)e.moveTo(0,t*.4),e.lineTo(Math.sin(n*.55)*t*.85,-Math.cos(n*.55)*t*.85);e.stroke()}};case`locust`:return{base:[118,156,62],vary:18,count:36,size:34,sprite:!0,draw:(e,t)=>{e.beginPath(),e.moveTo(0,t),e.lineTo(0,-t),e.stroke();for(let n=0;n<8;n++){let r=t*.9-n/7*1.8*t;for(let n of[-1,1])e.beginPath(),e.ellipse(n*t*.15,r,t*.16,t*.065,n*.45,0,Math.PI*2),e.fill()}}};case`pear`:return{base:[58,98,42],vary:14,count:70,size:21,sprite:!0,draw:(e,t)=>{it(e,t),e.fill(),e.beginPath(),e.moveTo(0,t*.9),e.lineTo(0,-t*.85),e.stroke()}};case`ginkgo`:return{base:[124,154,62],vary:14,count:64,size:20,sprite:!1,draw:(e,t)=>{e.beginPath(),e.moveTo(0,t*.95),e.lineTo(0,t*.15),e.stroke(),e.beginPath(),e.moveTo(0,t*.15);for(let n=0;n<=14;n++){let r=-1.05+n/14*2.1,i=t*(.95+.06*Math.sin(n*2.3))*(n===7?.82:1);e.lineTo(Math.sin(r)*i,t*.15-Math.cos(r)*i)}e.closePath(),e.fill()}};default:return{base:[74,112,46],vary:18,count:58,size:26,sprite:!0,draw:(e,t)=>{rt(e,t*.7,7,.3,1.75),e.fill(),e.beginPath(),e.moveTo(0,t*1.2),e.lineTo(0,-t*1.2),e.stroke()}}}}function ot(e){let t=e|0;return()=>{t=t+1831565813|0;let e=Math.imul(t^t>>>15,1|t);return e=e+Math.imul(e^e>>>7,61|e)^e,((e^e>>>14)>>>0)/4294967296}}function st(e,t,n,r,i){let a=nt(n),o=n.width;a.globalCompositeOperation=`source-over`,a.clearRect(0,0,o,o),a.drawImage(t,0,0,o,o),a.globalCompositeOperation=`multiply`,a.fillStyle=i,a.fillRect(0,0,o,o),a.globalCompositeOperation=`destination-in`,a.drawImage(t,0,0,o,o),e.drawImage(n,-r*.72,-r,r*1.44,r*2)}function*ct(e,t,n){let r=at(e),i=r.sprite&&!!n&&n.length>0,a=tt(t),o=nt(a),s=ot(e.length*977+e.charCodeAt(0)*13),c=t/512,l=tt(96);o.clearRect(0,0,t,t),o.strokeStyle=`rgba(62,46,32,0.95)`,o.lineCap=`round`;for(let e=0;e<6;e++){let e=s()*Math.PI*2;o.lineWidth=2.6*c,o.beginPath(),o.moveTo(t/2,t/2);let n=t/2+Math.cos(e+.3)*t*.2,r=t/2+Math.sin(e+.3)*t*.2;o.quadraticCurveTo(n,r,t/2+Math.cos(e)*t*.4,t/2+Math.sin(e)*t*.4),o.stroke(),o.lineWidth=1.5*c,o.beginPath(),o.moveTo(n,r),o.lineTo(n+Math.cos(e+.9)*t*.18,r+Math.sin(e+.9)*t*.18),o.stroke()}let u=Math.round(r.count*(i?1:1.15)),d=[],f=e===`plane`?[[.5,.5],[.3,.36],[.68,.62],[.42,.72]]:null;for(let e=0;e<u;e++){let n=s()*Math.PI*2,i=f?f[e%f.length]:null,a=Math.sqrt(s())*(i?.24:.45)*t,o=i?i[0]*t:t/2,l=i?i[1]*t:t/2;d.push({x:o+Math.cos(n)*a,y:l+Math.sin(n)*a,r:s()*Math.PI*2,s:r.size*c*(.65+.7*s()),l:s(),i:Math.floor(s()*9)})}d.sort((e,t)=>e.l-t.l);for(let t of d){yield;let a=.55+.6*t.l,u=+(s()<(e===`plane`?.09:.06)),d=(s()-.5)*r.vary+u*40,f=(s()-.5)*r.vary+u*10,p=(s()-.5)*r.vary*.6-u*20,m=Math.round((r.base[0]+d)*a),h=Math.round((r.base[1]+f)*a),g=Math.round((r.base[2]+p)*a);o.save(),o.translate(t.x,t.y),o.rotate(t.r),i&&e!==`locust`?st(o,n[t.i%n.length],l,t.s,`rgb(${Math.min(255,Math.round(m*1.55))},${Math.min(255,Math.round(h*1.45))},${Math.min(255,Math.round(g*1.6))})`):(o.fillStyle=`rgb(${m},${h},${g})`,o.strokeStyle=`rgba(${Math.round(m*.6)},${Math.round(h*.62)},${Math.round(g*.5)},0.8)`,o.lineWidth=.9*c,r.draw(o,t.s,s)),o.restore()}return yield*ut(o,t,r.base),dt(a)}function*lt(e,t){let n=at(e),r=tt(t),i=nt(r),a=ot(e.charCodeAt(1)*431+7);i.clearRect(0,0,t,t);let o=e===`pear`?{rx:.36,ry:.47}:e===`ginkgo`?{rx:.3,ry:.48}:e===`locust`?{rx:.45,ry:.42}:{rx:.47,ry:.44},s=e===`locust`?.62:.85,c=Math.round(t*t*.0046*s);for(let e=0;e<c;e++){e%8==0&&(yield);let r=a()*Math.PI*2,s=a()**.6,c=.5+Math.cos(r)*s*o.rx,l=.5+Math.sin(r)*s*o.ry,u=.4+.85*(1-l)*(.55+.45*(1-s))+.12*(.5-c),d=(a()-.5)*n.vary*1.5;i.fillStyle=`rgba(${Math.round((n.base[0]+d)*u)},${Math.round((n.base[1]+d)*u)},${Math.round((n.base[2]+d*.5)*u)},${(.75+.25*a()).toFixed(2)})`;let f=t*(.012+.022*a())*(1-.3*s);i.beginPath(),i.ellipse(c*t,l*t,f,f*(.7+.5*a()),a()*3.14,0,Math.PI*2),i.fill()}i.strokeStyle=`rgba(58,44,32,0.6)`,i.lineWidth=t/512*2.2;for(let e=0;e<3;e++){let e=-Math.PI/2+(a()-.5)*2.2;i.beginPath(),i.moveTo(t*.5,t*.86),i.lineTo(t*(.5+Math.cos(e)*.3),t*(.62+Math.sin(e)*.3)),i.stroke()}return yield*ut(i,t,n.base),dt(r)}function*ut(e,t,n){let r=e.getImageData(0,0,t,t),i=r.data;for(let e=0;e<i.length;e+=4)if(e%(t*4)==0&&(yield),i[e+3]<250){let t=i[e+3]/255;i[e]=Math.round(i[e]*t+n[0]*.8*(1-t)),i[e+1]=Math.round(i[e+1]*t+n[1]*.8*(1-t)),i[e+2]=Math.round(i[e+2]*t+n[2]*.8*(1-t))}e.putImageData(r,0,0)}function dt(e){let t=new ee(e);return t.colorSpace=S,t.wrapS=t.wrapT=o,t.minFilter=E,t.magFilter=j,t.generateMipmaps=!0,t.anisotropy=Be,t.premultiplyAlpha=!1,t.needsUpdate=!0,t}async function ft(e,t){let n=e=>Ct(e);try{let[r,i]=await Promise.all([n(e),n(t)]),a=[],o=nt(tt(128));for(let e=0;e<3;e++)for(let t=0;t<3;t++){let n=r.width/3*t,s=r.height/3*e,c=r.width/3,l=r.height/3;o.clearRect(0,0,128,128),o.drawImage(r,n,s,c,l,0,0,128,128);let u=o.getImageData(0,0,128,128);o.clearRect(0,0,128,128),o.drawImage(i,i.width/3*t,i.height/3*e,i.width/3,i.height/3,0,0,128,128);let d=o.getImageData(0,0,128,128).data,f=u.data;for(let e=0;e<f.length;e+=4)f[e+3]=d[e]<40?0:d[e];let p=tt(128);nt(p).putImageData(u,0,0),await pt(),a.push(p)}return r.close(),i.close(),a}catch{return null}}var pt=()=>new Promise(e=>{typeof requestAnimationFrame==`function`?requestAnimationFrame(()=>e()):setTimeout(e,0)});function mt(e){let t=e.next();for(;!t.done;)t=e.next();return t.value}async function Z(e,t){if(t?.aborted)throw new DOMException(`Texture generation cancelled`,`AbortError`);if(typeof window>`u`)return mt(e);for(;;){if(await pt(),t?.aborted)throw e.return(void 0),new DOMException(`Texture generation cancelled`,`AbortError`);let n=performance.now()+1;do{let t=e.next();if(t.done)return t.value}while(performance.now()<n)}}async function ht(e,t,n){let r={};for(let i of Ie)r[i]=await Z(ct(i,e,t),n);return r}async function gt(e,t){let n=e===`low`?256:512,r=await Z(Je(n),t),i=await Z(Ye(n),t),a=await Z(Xe(n),t),o=await Z(Ze(n),t),s=await Z(Qe(n),t),c=await Z($e(n),t),l={};for(let e of[`plane`,`dark`,`grey`])l[e]=await Z(et(e,n/2,n),t);let u=await ht(n,null,t),d={};for(let e of Ie)d[e]=await Z(lt(e,n),t);return{asphalt:r,concrete:i,grass:a,gravel:o,soil:s,waterNormal:c,bark:l,leaves:u,crowns:d}}function _t(e){let t=[e.asphalt,e.concrete,e.grass,e.gravel,e.soil,e.bark.plane,e.bark.dark,e.bark.grey];for(let e of t)e.map.dispose(),e.normal.dispose(),e.rough?.dispose();e.waterNormal.dispose();for(let t of Ie)e.leaves[t].dispose(),e.crowns[t].dispose()}var vt=t(`/assets/textures/`);function yt(e,t){return/^(https?:)?\/\//.test(t)||t.startsWith(`/`)?t:t.startsWith(`assets/`)?`/`+t:e+t.replace(/^\.\//,``)}function bt(e,t,n=[],r=!1){let i=[],a=(e,t,n)=>{if(!(n>4||typeof e!=`object`||!e)){if(Array.isArray(e)){for(let r of e)a(r,t,n+1);return}i.push({key:t,obj:e});for(let t of Object.keys(e))a(e[t],t,n+1)}};a(e,``,0);let o=t.map(e=>e.toLowerCase()),s=n.map(e=>e.toLowerCase());for(let{key:e,obj:t}of i){let n=[e];for(let e of[`id`,`name`,`slug`,`title`,`tags`,`category`,`path`,`dir`,`folder`,`source`,`description`]){let r=t[e];if(typeof r==`string`)n.push(r);else if(Array.isArray(r))for(let e of r)typeof e==`string`&&n.push(e)}let i=n.join(` `).toLowerCase();if(!o.some(e=>i.includes(e))||s.some(e=>i.includes(e)))continue;let a=xt(t);if(r?!a.normal:!a.albedo)continue;let c=null;for(let e of[`size`,`sizeM`,`size_m`,`meters`,`scale`,`repeat`,`physicalSize`,`physicalSizeM`,`dimensions`]){let n=t[e];typeof n==`number`&&n>0&&n<50?c=n:Array.isArray(n)&&typeof n[0]==`number`&&n[0]>0&&n[0]<50&&(c=n[0])}let l=typeof t.dir==`string`?t.dir:typeof t.path==`string`&&!/\.(png|jpe?g|webp|ktx2)$/i.test(t.path)?t.path:typeof t.folder==`string`?t.folder:``,u=l?yt(vt,l.replace(/\/?$/,`/`)):vt;return{name:n[1]??e,albedo:a.albedo?yt(u,a.albedo):null,normal:a.normal?yt(u,a.normal):null,rough:a.rough?yt(u,a.rough):null,opacity:a.opacity?yt(u,a.opacity):null,size:c}}return null}function xt(e){let t=null,n=null,r=null,i=null,a=(e,a)=>{if(typeof a!=`string`)return;let o=e.toLowerCase(),s=a.toLowerCase();if(!/\.(png|jpe?g|webp|ktx2)$/i.test(s)&&!/^(albedo|color|diffuse|basecolor|base_color|map|normal|nor|normalgl|normal_gl|rough|roughness|arm|opacity|alpha)$/.test(o))return;let c=o+` `+s;/opacity|alpha/.test(c)&&!i?i=a:/normal|_nor|nor_gl|normalgl|_nrm/.test(c)&&!n?n=a:/rough|_arm|orm/.test(c)&&!r?r=a:/albedo|diff|color|basecolor|base_color|_col/.test(c)&&!t&&(t=a)};for(let[t,n]of Object.entries(e))if(/^(maps|files|textures|images)$/i.test(t)){if(n&&typeof n==`object`&&!Array.isArray(n))for(let[e,t]of Object.entries(n))a(e,t);else if(Array.isArray(n))for(let e of n)a(``,e)}for(let[t,n]of Object.entries(e))/^(albedo|color|diffuse|basecolor|base_color|map|normal|nor|normalgl|normal_gl|rough|roughness|arm|opacity|alpha)(map|url|path)?$/i.test(t)&&a(t,n);return{albedo:t,normal:n,rough:r,opacity:i}}async function St(){try{let e=await n(vt+`manifest.json`,{cache:`no-cache`});return e.ok?await e.json():null}catch{return null}}async function Ct(e){let t=await n(e);if(!t.ok)throw Error(`Texture ${e}: ${t.status}`);return createImageBitmap(await t.blob(),{imageOrientation:`none`,premultiplyAlpha:`none`,colorSpaceConversion:`none`})}function wt(e,t){let n=()=>{t.close(),e.removeEventListener(`dispose`,n)};e.addEventListener(`dispose`,n)}async function Tt(e,t){let n=await Ct(e),r=new k(n);return wt(r,n),r.wrapS=r.wrapT=u,r.flipY=!1,r.minFilter=E,r.magFilter=j,r.generateMipmaps=!0,r.anisotropy=Be,r.colorSpace=t?S:``,r.needsUpdate=!0,r}async function Et(e){if(!e.normal)return null;try{return await Tt(e.normal,!1)}catch{return null}}async function Dt(e,t){try{let n=await Tt(e.albedo,!0),r=e.normal?await Tt(e.normal,!1).catch(()=>null):null,i=e.rough?await Tt(e.rough,!1).catch(()=>null):null;return r?{map:n,normal:r,rough:i,size:e.size??t,procedural:!1}:(n.dispose(),i?.dispose(),null)}catch{return null}}var Ot=[...Ie,`allee`],kt=e=>e===`allee`?`plane`:e,At={plane:{width:.74,bot:.3,top:1.02,clusters:158,card:.132,shell:.2,bark:`plane`,branches:5},allee:{width:.98,bot:.44,top:1,clusters:140,card:.146,shell:.2,bark:`plane`,branches:4},locust:{width:.6,bot:.42,top:1,clusters:84,card:.142,shell:.24,bark:`dark`,branches:8},pear:{width:.46,bot:.3,top:1,clusters:100,card:.122,shell:.18,bark:`grey`,branches:7},ginkgo:{width:.38,bot:.34,top:1.02,clusters:80,card:.128,shell:.22,bark:`grey`,branches:7},oak:{width:.7,bot:.38,top:1,clusters:118,card:.152,shell:.2,bark:`dark`,branches:9}};function jt(e){let t=e.toLowerCase();return/plane|sycamore|platanus/.test(t)?`plane`:/locust|gleditsia|robinia/.test(t)?`locust`:/pear|pyrus/.test(t)?`pear`:/ginkgo/.test(t)?`ginkgo`:`oak`}function Mt(e){let t=ae(e,!1);for(let t of e)t.dispose();return t}function Q(e,t,n,r=.55,i=7){let a=t.clone().sub(e),o=new N(n*r,n,a.length(),i),s=o.getAttribute(`uv`);for(let e=0;e<s.count;e++)s.setXY(e,s.getX(e)*1.6,s.getY(e)*a.length()*14);return o.applyQuaternion(new T().setFromUnitVectors(new m(0,1,0),a.normalize())),o.translate((e.x+t.x)/2,(e.y+t.y)/2,(e.z+t.z)/2),o}function Nt(e,t,n,r,i,a,o,s,c){let u=new m(n.x/(i*i),(n.y-r)/(a*a),n.z/(i*i));u.lengthSq()<1e-9&&u.set(0,1,0),u.normalize(),u.y+=.32,u.normalize();let d=c(),f=new T().setFromEuler(new x(c()*Math.PI,c()*Math.PI,c()*Math.PI)),p=new m;for(let r=0;r<3;r++){let i=new l(t*(.82+c()*.42),t*(.82+c()*.42));r===1?i.rotateY(Math.PI/2):r===2&&i.rotateX(Math.PI/2),i.applyQuaternion(f);let a=i.getAttribute(`position`),m=new Float32Array(a.array),h=i.getAttribute(`normal`);p.set(h.getX(0),h.getY(0),h.getZ(0)),p.dot(u)<0&&p.negate();let g=u.clone().addScaledVector(p,.24).normalize();for(let e=0;e<h.count;e++)h.setXYZ(e,g.x,g.y,g.z);let _=new Float32Array(h.count*3);for(let e=0;e<h.count;e++)_[e*3]=o,_[e*3+1]=s,_[e*3+2]=d;i.setAttribute(`aLeaf`,new M(_,3)),i.setAttribute(`aCardOff`,new M(m,3)),i.translate(n.x,n.y,n.z),e.push(i)}}function Pt(e){let t=(e.top+e.bot)/2,n=(e.top-e.bot)/2,r=e.width/2,i=[];for(let[a,o,s]of[[0,1,0],[-r*.12,.92,Math.PI/3],[r*.12,.92,-Math.PI/3]]){let u=new l(e.width*o*1.08,(e.top-e.bot)*o*1.12);u.rotateY(s),u.translate(a,t+.02,0);let d=u.getAttribute(`normal`),f=u.getAttribute(`position`),p=new Float32Array(d.count*3);for(let i=0;i<d.count;i++){let a=new m(f.getX(i)/r,(f.getY(i)-t)/n+.3,f.getZ(i)/r).normalize();d.setXYZ(i,a.x,a.y,a.z),p[i*3]=1,p[i*3+1]=c.clamp((f.getY(i)-e.bot)/(e.top-e.bot),0,1),p[i*3+2]=0}u.setAttribute(`aLeaf`,new M(p,3)),u.setAttribute(`aCardOff`,new M(new Float32Array(d.count*3),3)),i.push(u)}return Mt(i)}function Ft(e){let t=At[e],n=V(e.charCodeAt(0)*31+e.length),r=e===`pear`||e===`ginkgo`?.016:.02,i=[Q(new m(0,-.02,0),new m(0,.05,0),r*1.45,.72),Q(new m(0,.045,0),new m(0,t.bot+.12,0),r,.62)],a=[],o=(t.top+t.bot)/2,s=(t.top-t.bot)/2,c=t.width/2;for(let e=0;e<t.branches;e++){let a=e*2.399+n()*.4,o=t.bot-.06+e/t.branches*.22,s=new m(0,o,0),l=.3+n()*.35,u=new m(Math.sin(a)*c*l,o+.16+n()*.2,Math.cos(a)*c*l);i.push(Q(s,u,r*.42));for(let e=0;e<2;e++){let e=u.clone().add(new m((n()-.5)*c*.6,.06+n()*.12,(n()-.5)*c*.6));i.push(Q(u,e,r*.2));for(let t=0;t<2;t++){if(n()>.34)continue;let t=e.clone().add(new m((n()-.5)*c*.26,.02+n()*.05,(n()-.5)*c*.26));i.push(Q(e,t,r*.07,.55,5))}}}for(let e=0;e<t.clusters;e++){let e=n()*2-1,r=n()*Math.PI*2,i=Math.sign(e)*Math.abs(e)**.8,l=Math.sqrt(1-i*i),u=t.shell+(1-t.shell)*n()**.35,d=new m(Math.cos(r)*l*c*u,o+i*s*u,Math.sin(r)*l*c*u);Nt(a,t.card*(.85+n()*.4),d,o,c,s,u,(i+1)/2,n)}return{wood:Mt(i),leaves:Mt(a),far:Pt(t),seeds:null}}function It(e){let t=At[e],n=e===`allee`,r=V(n?1201:907),i=n?.019:.016,a=(t.top+t.bot)/2,o=(t.top-t.bot)/2,u=t.width/2,d=[],f=[],p=[],h=[],g=[],_=t.bot+.12,v=e=>i*c.lerp(1,.55,c.clamp(e/_,0,1));d.push(Q(new m(0,-.02,0),new m(0,.05,0),i*1.55,.68,9));let y=[.045,.15,t.bot*.62,t.bot-.03,_],b=new m(0,y[0],0),x=new s((r()-.5)*.02,(r()-.5)*.02),S=e=>new m(x.x*e/_,e,x.y*e/_);for(let e=1;e<y.length;e++){let t=S(y[e]).add(new m((r()-.5)*.004,0,(r()-.5)*.004));d.push(Q(b,t,v(b.y),v(y[e])/v(b.y),9)),b=t}let C=(e,t)=>new m(Math.cos(t)*Math.sin(e),Math.sin(t),Math.cos(t)*Math.cos(e)),w=(e,i=.86)=>{n&&e.y>t.top-.04&&(e.y=t.top-.04-r()*.03);let s=Math.sqrt((e.x/u)**2+((e.y-a)/o)**2+(e.z/u)**2);return s>i&&(e.x/=s/i,e.z/=s/i,e.y=a+(e.y-a)/(s/i)),e},T=(e,t,n,r,i,a,o=.86)=>{let s=w(e.clone().addScaledVector(t,n),o);return d.push(Q(e,s,r,i,a)),s},E=t.branches;for(let e=0;e<E;e++){let a=e*(Math.PI*2/E)+(r()-.5)*.7,o=T(S(c.lerp(t.bot-.04,t.bot+.1,e/Math.max(1,E-1))),C(a,(n?1.05:.95)+(r()-.5)*.25),(n?.1:.15)+r()*.07,i*.5,.72,7),s=T(o,C(a+(r()-.5)*.5,(n?.05:.38)+(r()-.5)*.2),(n?.24:.2)+r()*.1,i*.36,.62,7),l=[];for(let[t,c]of[[o,1],[s,2]])for(let o=0;o<c;o++){let s=a+((e+o)%2==0?1:-1)*(.4+r()*.6),c=T(t,C(s,n?r()*.15:.3+r()*.45),.1+r()*.08,i*.17,.6,6,.74);l.push({p:c,yaw:s}),h.push(t.clone().lerp(c,.55),c)}for(let e of l)for(let t=0;t<3;t++){let a=t===1?-1:1,o=n?(r()-.35)*.4:.15+r()*.55,s=C(e.yaw+a*(.3+r()*.6)+t*.35,o),c=.05+r()*.05,l=w(e.p.clone().addScaledVector(s,c),.8);r()<.34&&d.push(Q(e.p,l,i*.075,.5,5)),g.push(l),h.push(l)}}let D=e=>c.clamp((e-t.bot)/(t.top-t.bot),0,1),O=e=>c.clamp(Math.sqrt((e.x/u)**2+((e.y-a)/o)**2+(e.z/u)**2),.12,1),k=(e,n)=>{Nt(f,t.card*n*(.82+r()*.42),e,a,u,o,O(e),D(e.y),r)};for(let e of h){let t=g.includes(e)?2+ +(r()<.5):1;for(let n=0;n<t;n++)k(w(e.clone().add(new m((r()-.5)*.1,(r()-.6)*.05,(r()-.5)*.1)),1),1)}for(let e=f.length/3;e<t.clusters;e++){let e=r()*2-1,i=r()*Math.PI*2,s=Math.sign(e)*Math.abs(e)**(n?.6:.8);n&&(s=Math.min(s,.85));let c=n?Math.sqrt(1-Math.max(0,s)**4)*(1-.5*Math.max(0,-s)):Math.sqrt(1-s*s),l=t.shell+(1-t.shell)*r()**.35;k(new m(Math.cos(i)*c*u*l,a+s*o*l,Math.sin(i)*c*u*l),1)}for(let e of g){if(r()>.45)continue;let t=new l(.014,.026);t.rotateY(r()*Math.PI*2),t.translate(e.x+(r()-.5)*.01,e.y-.016,e.z+(r()-.5)*.01),p.push(t)}return{wood:Mt(d),leaves:Mt(f),far:Pt(t),seeds:p.length?Mt(p):null}}var Lt=e=>e===`plane`||e===`allee`?It(e):Ft(e);function Rt(e,t){if(typeof document>`u`)return null;let n=document.createElement(`canvas`);n.width=n.height=e;let r=n.getContext(`2d`);if(!r)return null;t(r,e);let i=new ee(n);return i.colorSpace=S,i.wrapS=i.wrapT=o,i.anisotropy=4,i}function zt(){return Rt(64,(e,t)=>{e.clearRect(0,0,t,t),e.strokeStyle=`rgb(84,66,40)`,e.lineWidth=2.5,e.beginPath(),e.moveTo(t*.5,0),e.lineTo(t*.48,t*.34),e.lineTo(t*.6,t*.72),e.stroke();for(let[n,r,i]of[[.48,.42,.17],[.6,.8,.15]]){let a=e.createRadialGradient(t*(n-i*.3),t*(r-i*.3),t*i*.1,t*n,t*r,t*i);a.addColorStop(0,`rgb(150,132,84)`),a.addColorStop(1,`rgb(74,60,36)`),e.fillStyle=a,e.beginPath(),e.arc(t*n,t*r,t*i,0,Math.PI*2),e.fill(),e.fillStyle=`rgba(40,30,18,0.5)`;for(let a=0;a<10;a++){let o=a*.63,s=i*(.3+.55*(a*7%5)/5);e.beginPath(),e.arc(t*(n+Math.cos(o)*s),t*(r+Math.sin(o)*s),1.1,0,Math.PI*2),e.fill()}}})}function Bt(e,t,n,r){let i=[];if(r!==`plane`&&r!==`allee`&&r!==`oak`)return i;let a=n*.2,o=.28;for(let n=Math.ceil((e-a)/o);n<=Math.floor((e+a)/o);n++)for(let r=Math.ceil((t-a)/o);r<=Math.floor((t+a)/o);r++){if(U(n,r,42)>.12)continue;let s=n*o+(U(n,r,43)-.5)*.04,c=r*o+(U(n,r,44)-.5)*.04,l=.05+U(n,r,45)*.04,u=Math.hypot(s-e,c-t);u<.3||u+l/Math.SQRT2>a||i.push({key:`${n}:${r}`,x:s,z:c,size:l,yaw:U(n,r,46)*Math.PI*2})}return i}function Vt(){return Rt(128,(e,t)=>{e.clearRect(0,0,t,t);let n=Array.from({length:40},(e,t)=>{let n=t/40*Math.PI*2,r=.58+.42*Math.abs(Math.cos(2.5*n))**.55;return[Math.sin(n)*r,-Math.cos(n)*r]}),r=Math.min(...n.map(e=>e[0])),i=Math.max(...n.map(e=>e[0])),a=Math.min(...n.map(e=>e[1])),o=Math.max(...n.map(e=>e[1]));e.fillStyle=`rgb(138,105,57)`,e.beginPath(),n.forEach(([n,s],c)=>{let l=1+(n-r)/(i-r)*(t-2),u=1+(s-a)/(o-a)*(t-2);c===0?e.moveTo(l,u):e.lineTo(l,u)}),e.closePath(),e.fill()})}var Ht=class{parent;geo;mat;name;shadows;mesh=null;count=0;baseBounds=new O;maxScale=0;windRadius=0;windUnitRadius=0;cardUnitPad=0;constructor(e,t,n,r,i){this.parent=e,this.geo=t,this.mat=n,this.name=r,this.shadows=i;let a=t.getAttribute(`aLeaf`);if(a){t.computeBoundingBox();let e=t.boundingBox,n=Math.max(Math.abs(e.min.y),Math.abs(e.max.y)),r=0;for(let e=0;e<a.count;e++)r=Math.max(r,Math.abs(a.getX(e)));this.windUnitRadius=.0036*n*n+.0025*r*n;let i=t.getAttribute(`aCardOff`),o=0;if(i)for(let e=0;e<i.count;e++)o=Math.max(o,Math.hypot(i.getX(e),i.getY(e),i.getZ(e)));this.cardUnitPad=o*.17}}add(e,t){if(this.count===0&&(this.maxScale=0),this.maxScale=Math.max(this.maxScale,e.getMaxScaleOnAxis()),!this.mesh||this.count>=this.mesh.instanceMatrix.count){let e=this.mesh,n=new R(this.geo,this.mat,e?e.instanceMatrix.count*2:128);n.instanceMatrix.setUsage(i),n.name=this.name,n.castShadow=this.shadows,n.receiveShadow=!0,n.frustumCulled=!0,e&&(n.instanceMatrix.array.set(e.instanceMatrix.array),n.setColorAt(0,t),e.instanceColor&&n.instanceColor.array.set(e.instanceColor.array),this.parent.remove(e),e.dispose()),this.parent.add(n),this.mesh=n}this.mesh.setMatrixAt(this.count,e),this.mesh.setColorAt(this.count++,t)}sample(){let e=new R(this.geo,this.mat,1);return e.setColorAt(0,new B(1,1,1)),e.castShadow=this.shadows,e.receiveShadow=!0,e}finish(){this.mesh&&(this.mesh.count=this.count,this.mesh.visible=this.count>0,this.mesh.instanceMatrix.needsUpdate=!0,this.mesh.instanceColor&&(this.mesh.instanceColor.needsUpdate=!0),this.mesh.computeBoundingSphere(),this.mesh.boundingSphere.radius+=this.maxScale*this.cardUnitPad,this.baseBounds.copy(this.mesh.boundingSphere),this.windRadius=this.maxScale*this.windUnitRadius)}windBounds(e){!this.mesh||!this.count||(this.mesh.boundingSphere.radius=this.baseBounds.radius+this.windRadius*e)}dispose(){this.mesh&&(this.parent.remove(this.mesh),this.mesh.dispose()),this.geo.dispose(),this.mat.dispose()}};function Ut(e,t,n){let r=144,i=0;for(let a of e.roads){if(a.tunnel)continue;let e=a.pts;for(let a=1;a<e.length;a++){let o=e[a-1],s=e[a],c=s[0]-o[0],l=s[1]-o[1],u=c*c+l*l;if(!u)continue;let d=Math.max(0,Math.min(1,((t-o[0])*c+(n-o[1])*l)/u)),f=(o[0]+d*c-t)**2+(o[1]+d*l-n)**2;f<r&&(r=f,i=Math.atan2(-l,c))}}return i}var Wt=2.4,Gt=1.5,Kt=.156;function qt(e,t,n,r,i){let o=new Map,s=[],u=new Map,d={value:e.time.sunDir},f=[],p=(n,r,a,o=!1)=>{i(r);let c=new Ht(t,n,r,a,o&&e.quality.shadows);return s.push(c),c},h=(e,t)=>{let n=new _({map:e,alphaTest:t?.45:.4,side:2,roughness:.85});return G(n,t?`env-tree-crown-v4`:`env-tree-leaves-v4`,e=>{Object.assign(e.uniforms,{uTime:r.uTime,uWind:r.uWind,uWetness:r.uWetness,uTreeSun:d}),e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
uniform float uTime; uniform vec2 uWind; attribute vec3 aLeaf; attribute vec3 aCardOff; varying vec3 vLeaf;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
          vLeaf = aLeaf;
          vec3 treeOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          // per-tree card scale: the same prototype reads as a coarser or finer canopy tree to tree
          float treeCardK = 0.87 + 0.30 * fract(sin(dot(treeOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
          transformed += aCardOff * (treeCardK - 1.0);
          // three tiers: the whole crown leans slowly, the limbs sway, each cluster flutters on its own phase
          float treeLean = sin(uTime * 0.55 + treeOrigin.x * 0.05 + treeOrigin.z * 0.07);
          float treeSway = 0.62 * sin(uTime * 1.9 + treeOrigin.x * 0.31 + position.y * 3.2) + 0.33 * sin(uTime * 3.1 + treeOrigin.z * 0.27 + position.y * 6.0);
          float treeFlutter = sin(uTime * 4.6 + aLeaf.z * 6.2832);
          float treeWind = length(uWind);
          transformed.xz += (treeLean + treeSway + 0.45 * treeFlutter) * uWind * 0.0015 * position.y * position.y;
          transformed.y += treeFlutter * treeWind * 0.0025 * aLeaf.x * position.y;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
uniform float uWetness; uniform vec3 uTreeSun; varying vec3 vLeaf;`).replace(`#include <normal_fragment_begin>`,`vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;`).replace(`#include <map_fragment>`,`#include <map_fragment>
          // canopy self-shadow: leaf mass blocks sky and sun toward the crown centre and under the crown
          float treeOcc = mix(0.30, 1.0, smoothstep(0.05, 0.95, vLeaf.x)) * mix(0.48, 1.0, smoothstep(0.0, 0.78, vLeaf.y));
          // the sun reaches the interior even less than the sky does; a card seen from its back is the dull underside
          diffuseColor.rgb *= mix(1.0, treeOcc, 0.45) * (1.0 - 0.22 * uWetness);
          if (!gl_FrontFacing) diffuseColor.rgb *= vec3(0.82, 0.84, 0.78);`).replace(`#include <aomap_fragment>`,`reflectedLight.indirectDiffuse *= treeOcc;
          reflectedLight.indirectSpecular *= mix(1.0, treeOcc, 0.7);`).replace(`#include <emissivemap_fragment>`,`#include <emissivemap_fragment>
          // sun through the leaf: strongest when the leaf is between the eye and the sun (backlit), yellow-green
          vec3 treeLight = normalize((viewMatrix * vec4(uTreeSun, 0.0)).xyz);
          float treeBack = max(0.0, dot(-normalize(vViewPosition), treeLight));
          float treeUnder = 1.0 - 0.55 * max(0.0, dot(normal, treeLight));
          float treeThin = mix(0.72, 1.0, vLeaf.y) * (gl_FrontFacing ? 0.85 : 1.0) * vLeaf.x;
          // the far crown card already averages a whole canopy's worth of leaves, so it transmits far less than a shell card
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.5, 1.34, 0.42) * (0.06 + ${t?`0.24`:`0.85`} * treeBack * treeBack * treeBack) * treeUnder * treeThin * clamp(uTreeSun.y * 3.0, 0.0, 1.0);`)}),n},g=zt(),v=Vt();g&&f.push(g),v&&f.push(v);for(let e of Ot){let t=Lt(e),r=kt(e),i=n.bark[At[e].bark];u.set(e,{wood:p(t.wood,new _({map:i.map,normalMap:i.normal,roughnessMap:i.rough??null,roughness:.95}),`env-tree-${e}-wood`,!0),leaves:p(t.leaves,h(n.leaves[r],!1),`env-tree-${e}-leaves`,!0),far:p(t.far,h(n.crowns[r],!0),`env-tree-${e}-far`),seeds:t.seeds?p(t.seeds,new _({map:g??void 0,color:g?16777215:5917228,alphaTest:.5,side:2,roughness:.9}),`env-tree-${e}-seeds`):null})}let y=p(new l(Wt,Gt).rotateX(-Math.PI/2),new _({map:n.soil.map,normalMap:n.soil.normal,roughness:1,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2}),`env-tree-pits`),b=v?p(new l(1,1).rotateX(-Math.PI/2),new _({map:v,transparent:!0,opacity:.8,alphaTest:.12,depthWrite:!1,roughness:.9,polygonOffset:!0,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),`env-tree-litter`):null,x=[],S=Wt/2,w=Gt/2;for(let e of[-1,1]){for(let t of[.16,.46])x.push(new I(Wt,.028,.028).translate(0,t,e*w)),x.push(new I(.028,.028,Gt).translate(e*S,t,0));for(let t of[-1,1])x.push(new I(.04,.52,.04).translate(e*S,.26,t*w));for(let t=-3;t<=3;t++)x.push(new I(.014,.3,.014).translate(t*.32,.31,e*w));for(let t=-2;t<=2;t++)x.push(new I(.014,.3,.014).translate(e*S,.31,t*.3))}let T=p(Mt(x),new _({color:1316372,roughness:.55,metalness:.75}),`env-tree-guards`),E=new a,D=new B(1,1,1),O=!0,k=-1/0,A=new m(1/0,1/0,1/0),j=e.quality.level===`low`||e.quality.level===`mobile`?65:e.quality.level===`medium`?90:120,M=Math.min(j,70),N=Math.min(800,e.quality.drawDistance),P=(e,t)=>{let n=jt(e.species);if(e.species.toLowerCase()!==`tree`||!t)return n;let i=r.uSafe.value;return Math.hypot(e.x-i.x,e.z-i.z)<i.z+90?`allee`:U(e.x,e.z,8)<.5?`plane`:`oak`};return{addTile(e){let t=[];for(let n of e.trees){if(![n.x,n.z,n.dbh,n.height].every(Number.isFinite))continue;let r=e.parks.some(e=>H(n.x,n.z,e)),i=P(n,r),a=c.clamp(.75+Math.max(0,n.dbh)*.02,.8,1.35),o=c.clamp(n.height*(.94+U(n.x,n.z,4)*.12),3,32),s=o*a*(.9+U(n.x,n.z,5)*.2);E.position.set(n.x,0,n.z),E.rotation.set(0,U(n.x,n.z)*Math.PI*2,0),E.scale.set(s,o,s*(.92+U(n.x,n.z,6)*.16)),E.updateMatrix();let l=i===`plane`||i===`allee`,u=new B().setHSL(.21+U(n.x,n.z,7)*.05,.25,(l?.62:.68)+U(n.x,n.z,1)*(l?.14:.2));!l&&U(n.x,n.z,2)<.08&&u.setRGB(1.12,.95,.65),t.push({tree:n,form:i,matrix:E.matrix.clone(),tint:u,street:!r,guard:U(n.x,n.z,3)<.5,pitYaw:r?0:Ut(e,n.x,n.z),litter:Bt(n.x,n.z,s*At[i].width,i)})}o.set(e.key,t),O=!0},removeTile(e){o.delete(e),O=!0},update(t){let n=e.camera.position,i=r.uWind.value.length();for(let e of s)e.windBounds(i);if(!O&&(t-k<.15||A.distanceToSquared(n)<.25))return;O=!1,k=t,A.copy(n);for(let e of s)e.count=0;let a=new Set;for(let e of o.values())for(let t of e){let e=(t.tree.x-n.x)**2+(t.tree.z-n.z)**2;if(e>N*N)continue;let r=u.get(t.form);if(e<=j*j){if(r.wood.add(t.matrix,D),r.leaves.add(t.matrix,t.tint),e<=M*M&&(r.seeds?.add(t.matrix,D),b))for(let e of t.litter)a.has(e.key)||(a.add(e.key),E.position.set(e.x,.034,e.z),E.rotation.set(0,e.yaw,0),E.scale.set(e.size,1,e.size),E.updateMatrix(),b.add(E.matrix,D));t.street&&(E.position.set(t.tree.x,Kt,t.tree.z),E.rotation.set(0,t.pitYaw,0),E.scale.set(1,1,1),E.updateMatrix(),y.add(E.matrix,D),t.guard&&T.add(E.matrix,D))}else r.far.add(t.matrix,t.tint)}for(let e of s)e.finish(),e.windBounds(i)},async prepare(e){let t=new C;for(let e of s)t.add(e.sample());try{await e(t)}finally{for(let e of t.children)e.dispose();t.clear()}},setLeafCards(e){for(let t of Ot){let n=u.get(t).leaves.mat;n.map=e[kt(t)],n.needsUpdate=!0}},setBark(e,t){for(let n of Ot){if(At[n].bark!==e)continue;let r=u.get(n).wood.mat;r.map=t.map,r.normalMap=t.normal,r.roughnessMap=t.rough,r.needsUpdate=!0}},inPit(e,t){let n=Wt/2,r=Gt/2;for(let i=Math.floor((e-n)/256);i<=Math.floor((e+n)/256);i++)for(let a=Math.floor((t-n)/256);a<=Math.floor((t+n)/256);a++)for(let s of o.get(ie(i,a))??[]){if(!s.street)continue;let i=e-s.tree.x,a=t-s.tree.z;if(i*i+a*a>n*n)continue;let o=Math.cos(s.pitYaw),c=Math.sin(s.pitYaw);if(Math.abs(i*o-a*c)<=n&&Math.abs(i*c+a*o)<=r)return!0}return!1},dispose(){o.clear();for(let e of s)e.dispose();for(let e of f)e.dispose()}}}var $=new s(-.875,-.485),Jt=new s(.485,-.875),Yt=new s(-1506.3,-1068.2),Xt=80.5,Zt=-.06,Qt=.9,$t=.18,en=[{street:36,length:240,width:60,stumps:!0},{street:39,length:150,width:45,shed:6},{street:41,length:190,width:26,stumps:!0},{street:42.7,length:170,width:32},{street:44,length:200,width:60,stumps:!0},{street:46,length:265,width:40,carrier:!0},{street:48,length:330,width:62,shed:13},{street:50,length:330,width:62,shed:13},{street:52,length:330,width:62,shed:13},{street:54,length:200,width:62,shed:12},{street:57,length:150,width:60}];function tn(e){return Yt.clone().addScaledVector(Jt,(e.street-44)*Xt)}var nn=`
varying float vPileY;
varying vec3 vPileW;
${le}
`,rn=`
{
  float grain = envNoise(vec2(vPileW.x * 7.0 + vPileW.z * 3.0, vPileY * 1.3)) * 0.35 + 0.82;
  diffuseColor.rgb *= grain;
  // tide band: black-green slime below the high-water line, dry grey timber above, a pale salt line between
  float tide = 1.0 - smoothstep(-1.2, -0.35, vPileY);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.055, 0.04), tide * 0.85);
  diffuseColor.rgb *= 1.0 + 0.35 * exp(-pow((vPileY + 0.25) / 0.12, 2.0));
}
`;function an(e,t,n){let r=new _({color:7829359,roughness:.92,metalness:0,vertexColors:!0}),i=new _({color:10329752,roughness:.75,metalness:.1,vertexColors:!0}),a=new _({color:5918015,roughness:.95,metalness:0});G(a,`env-timber-v1`,e=>{e.uniforms.uTime=t.uTime,e.vertexShader=e.vertexShader.replace(`#include <common>`,`#include <common>
varying float vPileY; varying vec3 vPileW;`).replace(`#include <begin_vertex>`,`#include <begin_vertex>
#ifdef USE_INSTANCING
vec4 envPW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
#else
vec4 envPW = modelMatrix * vec4(transformed, 1.0);
#endif
vPileY = envPW.y; vPileW = envPW.xyz;`),e.fragmentShader=e.fragmentShader.replace(`#include <common>`,`#include <common>
`+nn).replace(`#include <map_fragment>`,rn)});let o=new N($t*.9,$t,1,7,1,!1);o.translate(0,.5,0);let c=new I(1,1,1);function l(e,t,n){let r=e.tx*256,i=e.tz*256;return t>=r&&t<r+256&&n>=i&&n<i+256}function u(e,t,n){for(let r of e.water)if(H(t,n,r))return!0;return!1}function f(e,t){if(!l(e,t.x,t.y)||!e.water.length)return t;for(let n=-60;n<=60;n+=1.5){let r=t.x+$.x*n,i=t.y+$.y*n;if(l(e,r,i)&&u(e,r,i))return new s(r,i)}return t}function p(e,t,n,r,i,a,o,s,l){let u=c.clone();u.scale(i,o,a),u.rotateY(Math.atan2(-$.y,$.x)),u.translate(t,n,r);let d=u.getAttribute(`position`),f=u.getAttribute(`normal`),p=e.pos.length/3;for(let t=0;t<d.count;t++){e.pos.push(d.getX(t),d.getY(t),d.getZ(t)),e.nrm.push(f.getX(t),f.getY(t),f.getZ(t));let n=f.getY(t)>.5?s:l;e.col.push(n.r,n.g,n.b)}let m=u.getIndex();for(let t=0;t<m.count;t++)e.idx.push(p+m.getX(t));u.dispose()}function g(e){if(!e.pos.length)return null;let t=new A;return t.setAttribute(`position`,new d(e.pos,3)),t.setAttribute(`normal`,new d(e.nrm,3)),t.setAttribute(`color`,new d(e.col,3)),t.setIndex(e.idx),t.computeBoundingSphere(),t}function v(e){if(!e.water.length)return null;let t=e.tx*256,c=e.tz*256,d=(e,n)=>e.x>t-n&&e.x<t+256+n&&e.y>c-n&&e.y<c+256+n,_={pos:[],nrm:[],col:[],idx:[]},v={pos:[],nrm:[],col:[],idx:[]},y=[],b=new B(8618875),S=new B(4868677),w=new B(9211272),E=new B(11777198),D=new B(6185318),O=new B(5001301);for(let t of en){let n=tn(t);if(!d(n,t.length+80))continue;let r=f(e,n),i=V(Math.round(t.street*10)),a=(e,t)=>new s(r.x+$.x*e+Jt.x*t,r.y+$.y*e+Jt.y*t),o=a((t.length-25)/2,0);if(l(e,o.x,o.y)&&p(_,o.x,Zt-Qt/2,o.y,t.length+25,t.width,Qt,b,S),t.shed){let n=a((t.length+10)/2-8,0);l(e,n.x,n.y)&&(p(v,n.x,Zt+t.shed/2,n.y,t.length-30,t.width-8,t.shed,w,E),p(v,n.x,Zt+t.shed+1.2,n.y,t.length-60,t.width*.35,2.4,w,E))}if(t.carrier){let n=a(t.length/2+15,t.width/2+20);if(l(e,n.x,n.y)){p(_,n.x,K+9,n.y,250,28,18.5,D,O),p(_,n.x,K+19.5,n.y,262,42,3,D,O);let e=a(t.length/2+45,t.width/2+20+16);p(_,e.x,K+29,e.y,34,8,16,D,O)}}let c=K-1.2,m=.44-c,h=1.74-c,g=(t,n,r)=>{l(e,t.x,t.y)&&u(e,t.x,t.y)&&y.push({x:t.x,z:t.y,h:n,tilt:r,yaw:i()*Math.PI*2})};for(let e=8;e<=t.length;e+=2.6)g(a(e,t.width/2+.3),m+i()*.15,i()*.04),g(a(e,-t.width/2-.3),m+i()*.15,i()*.04);for(let e=-t.width/2+1.3;e<t.width/2;e+=2.6)g(a(t.length+.3,e),m+i()*.15,i()*.04);for(let e of[1,-1]){let n=a(t.length+7,e*(t.width/2+3));for(let e=0;e<5;e++){let t=e/5*Math.PI*2;g(new s(n.x+Math.cos(t)*.55,n.y+Math.sin(t)*.55),h+i()*.3,.06)}}if(t.stumps)for(let e=14;e<=t.length-10;e+=2.2+i()*.8)g(a(e+i()*.6,-t.width/2-7-i()*.8),1.2+.15+i()*.9,.02+i()*.1)}let k=new C;k.name=`env-piers-${e.key}`;let A=g(_);if(A){let e=new F(A,r);e.castShadow=n,e.receiveShadow=!0,e.matrixAutoUpdate=!1,k.add(e)}let j=g(v);if(j){let e=new F(j,i);e.castShadow=n,e.receiveShadow=!0,e.matrixAutoUpdate=!1,k.add(e)}if(y.length){let e=new R(o,a,y.length),t=new h,r=new T,i=new x,s=new m,c=new m,l=K-1.2;y.forEach((n,a)=>{i.set(n.tilt,n.yaw,0),r.setFromEuler(i),c.set(n.x,l,n.z),s.set(1,n.h,1),t.compose(c,r,s),e.setMatrixAt(a,t)}),e.instanceMatrix.needsUpdate=!0,e.castShadow=n,e.receiveShadow=!0,e.matrixAutoUpdate=!1,e.frustumCulled=!0,e.computeBoundingSphere(),k.add(e)}return k.children.length?(k.matrixAutoUpdate=!1,k):null}function y(e,t){for(let n of en){let r=tn(n),i=e-r.x,a=t-r.y,o=i*$.x+a*$.y,s=i*Jt.x+a*Jt.y;if(o>-40&&o<n.length+3&&Math.abs(s)<n.width/2+1.5)return!0}return!1}return{build:v,onDeck:y,dispose(){r.dispose(),i.dispose(),a.dispose(),o.dispose(),c.dispose()}}}function on(e){if(!e||typeof e!=`object`)return e;if(`texturePacket`in e){let t=e,n=t.image,r=`data`in n?new g(n.data,n.width,n.height):new k(n);if(r.flipY=!1,r.wrapS=t.wrapS,r.wrapT=t.wrapT,r.minFilter=t.minFilter,r.magFilter=t.magFilter,r.colorSpace=t.colorSpace,r.anisotropy=t.anisotropy,r.generateMipmaps=t.generateMipmaps,!(`data`in n)){let e=()=>{n.close(),r.removeEventListener(`dispose`,e)};r.addEventListener(`dispose`,e)}return r.needsUpdate=!0,r}return Object.fromEntries(Object.entries(e).map(([e,t])=>[e,on(t)]))}function*sn(e){if(e instanceof k)yield e;else if(e&&typeof e==`object`)for(let t of Object.values(e))yield*sn(t)}var cn=class{ctx;scope;worker=null;nextId=0;waiting=new Map;disposed=!1;abort=new AbortController;constructor(e){if(this.ctx=e,this.scope=re(e),typeof Worker<`u`&&typeof OffscreenCanvas<`u`)try{this.worker=new Worker(new URL(`/world/assets/textures.worker--LU96PcS.js`,``+import.meta.url),{type:`module`,name:`environment-textures`}),this.worker.onmessage=({data:e})=>{let t=this.waiting.get(e.id);this.waiting.delete(e.id);let n=on(e.value);if(!t){for(let e of sn(n))e.dispose();return}e.error?t.reject(Error(e.error)):t.resolve(n)},this.worker.onerror=e=>{e.preventDefault(),this.stopWorker(Error(`Texture worker failed`))}}catch{this.stopWorker(Error(`Texture worker unavailable`))}}stopWorker(e){this.worker?.terminate(),this.worker=null;for(let t of this.waiting.values())t.reject(e);this.waiting.clear()}async request(e,t){if(this.disposed)throw new DOMException(`Environment disposed`,`AbortError`);if(this.worker)try{return await new Promise((t,n)=>{let r=++this.nextId;this.waiting.set(r,{resolve:e=>t(e),reject:n}),this.worker.postMessage({...e,id:r,anisotropy:this.ctx.renderer.capabilities.getMaxAnisotropy()})})}catch(e){if(this.disposed)throw e}return t()}hold(e){return this.scope.job(e)}async load(e,t){let n=this.scope.job(e),r,i=!1;try{if(!n.pending)throw new DOMException(`Environment disposed`,`AbortError`);if(r=await t(),n.pending&&n.run((function*(){yield*sn(r),i=!0})()),await n.done,!i||this.disposed)throw new DOMException(`Environment upload cancelled or failed`,`AbortError`);return r}catch(e){n.cancel();for(let e of sn(r))e.dispose();throw e}}generate(){let e=this.ctx.quality.level===`mobile`?`low`:this.ctx.quality.level;return this.load(`environment procedural textures`,()=>this.request({kind:`base`,quality:e},()=>gt(e,this.abort.signal)))}leaves(t,n,r){return n=e(n),r=e(r),this.load(`environment leaf atlas`,()=>this.request({kind:`leaves`,size:t,color:n,opacity:r},async()=>{let e=await ft(n,r);return e?ht(t,e,this.abort.signal):null}))}dispose(){this.disposed=!0,this.abort.abort(),this.scope.dispose(),this.stopWorker(new DOMException(`Environment disposed`,`AbortError`))}};async function ln(e){let t=()=>e.modules.get(`atmosphere`),n=t()?.uniforms,r={uTime:n?.uTime??{value:0},uWetness:n?.uWetness??{value:0},uRain:n?.uRain??{value:0},uNight:n?.uNight??{value:0},uWind:{value:new s},uSeason:{value:.18},uSafe:{value:new m(e.state.safeZone.x,e.state.safeZone.z,e.state.safeZone.radius)}};Ve(e.renderer.capabilities.getMaxAnisotropy());let i=new cn(e),a=await i.generate().catch(e=>{throw i.dispose(),e}),o=re(e),c=new C;c.name=`environment`,e.worldGroup.add(c);let l=e=>t()?.setupMaterial?.(e),u=an(c,r,e.quality.shadows),d=Te(e,c,a,r,{skipEdge:u.onDeck}),f=je(c,a.waterNormal,r,e.quality.level!==`mobile`),p=e.quality.level===`mobile`?null:Fe(c,e.quality.level,r),h=qt(e,c,a,r,l),_=e.world.index,v=new Set(_?.tiles??[]);d.buildFar(_??null);let y=e=>e.traverse(e=>{let t=e.material;Array.isArray(t)?t.forEach(l):t&&l(t)});y(c);let b=new Map,x=new Set,S=0,w=!1,T=null,E=null,O=null,k=null,A=0,M=null,N=new B;function P(){T?.terminate(),T=null,!w&&E&&b.get(E.record.tile.key)===E.record&&x.add(E.record.tile.key),E=null,O=null}if(typeof Worker<`u`&&typeof OffscreenCanvas<`u`)try{T=new Worker(new URL(`/world/assets/mask.worker-xVmTzvog.js`,``+import.meta.url),{type:`module`,name:`environment-masks`}),T.onmessage=e=>{O=e.data},T.onerror=e=>{e.preventDefault(),P()}}catch{P()}function F(e,t){for(let n=e-1;n<=e+1;n++)for(let e=t-1;e<=t+1;e++){let t=ie(n,e),r=b.get(t);r&&(r.revision=++S,r.job?.cancel(),r.job=o.job(`environment mask ${t}`),x.add(t))}}function I(e){x.delete(e);let t=b.get(e);t&&(t.job?.cancel(),b.delete(e),t.ground&&d.removeTile(t.ground),t.piers&&=(c.remove(t.piers),t.piers.traverse(e=>{let t=e;t.isMesh&&!t.isInstancedMesh&&t.geometry.dispose(),t.isInstancedMesh&&t.dispose()}),null),t.mask?.tex.dispose(),h.removeTile(e),d.setTileLoaded(e,!1),w||F(t.tile.tx,t.tile.tz))}function L(e){w||b.get(e.key)?.tile!==e&&(I(e.key),b.set(e.key,{tile:e,mask:null,ground:null,piers:null,revision:++S,job:null}),h.addTile(e),F(e.tx,e.tz))}function R(e,n,r){r.pending&&r.run((function*(){if(e.mask){let t=e.mask;yield{texture:t.tex,prepare:()=>{t.tex.image.data=n,t.tex.needsUpdate=!0}},t.data=n;return}let r=new g(n,512,512,D,te),i=!1;try{r.minFilter=r.magFilter=j,r.generateMipmaps=!1,r.needsUpdate=!0,yield r,e.mask={key:e.tile.key,ox:e.tile.tx*256,oz:e.tile.tz*256,data:n,tex:r},e.ground=d.addTile(e.tile,e.mask),l(e.ground.mat),e.ground.seawall&&y(e.ground.seawall),e.ground.extras&&y(e.ground.extras),e.piers=u.build(e.tile),e.piers&&(c.add(e.piers),y(e.piers)),d.setTileLoaded(e.tile.key,!0),i=!0;let a=e.ground.mesh,o=[],s=[];for(let t of[e.ground.seawall,e.ground.extras,e.piers])t&&(o.push(t),t.isGroup?s.push(...t.children):s.push(t));a.visible=!1;for(let e of s)e.visible=!1;try{yield t()?.prepareObjects?.(a);for(let e of o)yield t()?.prepareObjects?.(e)}finally{a.visible=!0;for(let e of s)e.visible=!0}}finally{i||r.dispose()}})())}function z(){if(O&&E){let e=O,t=E;O=null,E=null,e.error?(x.add(t.record.tile.key),P()):e.id===t.id&&e.data&&b.get(e.key)===t.record&&t.revision===t.record.revision&&R(t.record,e.data,t.job)}if(E||!x.size)return;let t,n=1/0;for(let r of x){let i=b.get(r);if(!i){x.delete(r);continue}let a=i.tile,o=(a.tx*256+128-e.camera.position.x)**2+(a.tz*256+128-e.camera.position.z)**2+(i.mask?1e8:0);o<n&&(n=o,t=i)}if(t){if(x.delete(t.tile.key),T){let n=(t.tile.tx+.5)*256,r=(t.tile.tz+.5)*256;E={record:t,revision:t.revision,id:++A,job:t.job},T.postMessage({id:A,tile:t.tile,roads:e.world.roadsNear(n,r,184.32),buildings:e.world.buildingsNear(n,r,184.32)})}else{k??=new de(e);let n=k.paint(t.tile);R(t,n.data,t.job),n.tex.dispose()}}}let ee=[e.events.on(`tileLoaded`,L),e.events.on(`tileUnloaded`,I)];for(let t of e.world.tiles.values())L(t);let ne=null,ae=[],oe=i.hold(`environment manifest`);(async()=>{let t=await St();if(!t||w)return;let n=bt(t,[`water-normal`,`waternormals`],[],!0);if(n){let e=await i.load(`water normal`,()=>Et(n));e&&!w?(ae.push(e),f.setNormalMap(e)):e?.dispose()}for(let[e,n]of[[`plane`,`bark-plane`],[`dark`,`bark-oak`]]){if(w)break;let r=bt(t,[n]);if(!r)continue;let o=await i.load(`bark ${e}`,()=>Dt(r,a.bark[e].size));o&&!w?(ae.push(o.map,o.normal),o.rough&&ae.push(o.rough),h.setBark(e,o)):o&&(o.map.dispose(),o.normal.dispose(),o.rough?.dispose())}let r=bt(t,[`leaf-atlas`,`leaf`]);if(r?.albedo&&r.opacity){let t=await i.leaves(e.quality.level===`low`?256:512,r.albedo,r.opacity);if(t&&!w){for(let e of Ie)ae.push(t[e]);h.setLeafCards(t)}else if(t)for(let e of Ie)t[e].dispose()}if(!w)for(let[e,n]of[[`asphalt`,[`asphalt-worn`]],[`concrete`,[`plaza-concrete`]],[`grass`,[`grass-lawn`]],[`soil`,[`dirt-mulch`]]]){if(w)break;let r=bt(t,[...n]);if(!r)continue;let o=await i.load(e,()=>Dt(r,a[e].size));if(!o)continue;if(w){o.map.dispose(),o.normal.dispose(),o.rough?.dispose();break}let s=a[e];a[e]=o,d.setTextures(a),e===`soil`?ne=s:(s.map.dispose(),s.normal.dispose(),s.rough?.dispose())}})().catch(e=>{w||console.warn(`[environment] using procedural textures`,e)}).finally(()=>oe.cancel());let V=t();return V?.prepareObjects&&(await V.prepareObjects(c),await h.prepare(e=>V.prepareObjects(e))),{name:`environment`,waterLevel:K,update(i,a){if(w)return;n?.uTime||(r.uTime.value=a),n?.uNight||(r.uNight.value=1-e.time.daylight),n?.uWetness||(r.uWetness.value=e.state.weather.wetness??0),n?.uRain||(r.uRain.value=e.state.weather.condition===`snow`?0:e.state.weather.precip??0);let o=e.state.weather;r.uWind.value.set(Math.sin(o.windDir)*o.wind,-Math.cos(o.windDir)*o.wind);let s=e.state.safeZone;r.uSafe.value.set(s.x,s.z,s.radius),_!==e.world.index&&(_=e.world.index,v=new Set(_?.tiles??[]),d.buildFar(_??null),y(c)),z();let l=e.scene.environment??t()?.envMap;if(l)f.setEnvMap(e.scene.environment?null:l),M?.dispose(),M=null;else if(!t()){M??=new Me(e.renderer),M.update(e.time.sunDir,e.time.daylight,a),f.setEnvMap(M.texture);let t=e.time.daylight;N.setRGB(.03+.57*t,.03+.65*t,.045+.755*t),f.setHaze(N,24e-5,!1)}n&&f.setHaze(n.uHorizonColor.value,n.uFogDensity.value,!!e.composer)},preRender(){w||(f.update(e.camera),p?.update(e.camera,(e,t)=>b.get(ie(e,t))?.mask??null),h.update(r.uTime.value))},surfaceAt(t,n){if(w||!Number.isFinite(t)||!Number.isFinite(n))return null;let r=ie(Math.floor(t/256),Math.floor(n/256)),i=b.get(r),a=i?.tile??e.world.tileAt(t,n);if(a?.water.some(e=>H(t,n,e))||!a&&(e.world.isWater?.(t,n)??(_?!v.has(r):!1)))return`water`;if(h.inPit(t,n))return`dirt`;if(i?.mask){if(fe(i.mask,t,n,0)>127)return`water`;if(fe(i.mask,t,n,2)>127||fe(i.mask,t,n,3)>127)return`dirt`;if(fe(i.mask,t,n,1)>127)return`grass`}else if(a?.parks.some(e=>H(t,n,e))&&!a.plazas.some(e=>H(t,n,e)))return`grass`;return`ground`},dispose(){if(!w){w=!0,i.dispose(),o.dispose(),ee.forEach(e=>e()),P(),x.clear();for(let e of b.keys())I(e);h.dispose(),p?.dispose(),f.dispose(),d.dispose(),u.dispose(),M?.dispose(),_t(a),ne?.map.dispose(),ne?.normal.dispose(),ne?.rough?.dispose();for(let e of ae)e.dispose();e.worldGroup.remove(c),c.clear()}}}}export{ln as createEnvironment};
//# sourceMappingURL=environment-WQwLg8tn.js.map