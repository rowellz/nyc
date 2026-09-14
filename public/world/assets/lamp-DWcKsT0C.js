import{$n as e,C as t,Dr as n,Dt as r,Et as i,Gt as a,Hn as o,Or as s,Ot as c,V as l,W as u,Yn as d,Zt as f,_t as p,g as m,gt as h,h as g,j as _,k as v,m as y,mr as b,or as x,ut as S,w as C,y as w}from"./textureRelease-2U-gT89r.js";import{t as T}from"./BufferGeometryUtils-BXgKkxAN.js";var E={none:0,lamp:1,nightGlow:2,lensRed:3,lensYellow:4,lensGreen:5,alwaysGlow:6,pedFace:7,mapGlowNight:8,mapGlow:9},D=new c,O=new f,k=new l,A=new s,j=new s;new r;var M=new C;function N(e,t=new c){return e?(k.set(e.rx??0,e.ry??0,e.rz??0,`XYZ`),O.setFromEuler(k),A.set(e.sx??1,e.sy??1,e.sz??1),t.compose(new s(e.x??0,e.y??0,e.z??0),O,A)):t.identity()}var P=class{parts=[];triangles=0;add(e,t,n){e.index||(e=F(e));for(let t of Object.keys(e.attributes))t!==`position`&&t!==`normal`&&t!==`uv`&&e.deleteAttribute(t);e.attributes.normal||e.computeVertexNormals(),e.attributes.uv||e.setAttribute(`uv`,new g(new Float32Array(e.attributes.position.count*2),2));let r=n instanceof c?n:N(n,D);e.applyMatrix4(r);let a=e.attributes.position,o=e.attributes.normal,s=e.attributes.uv,l=a.count,u=new Float32Array(l*3),d=new Float32Array(l*4),f=new Float32Array(l*2),p=t.color instanceof C?t.color:Array.isArray(t.color)?M.setRGB(t.color[0],t.color[1],t.color[2]):M.setHex(t.color),m=t.rough??.6,h=t.metal??0,_=+!!t.atlas,v=t.emit??0,y=t.emitStrength??1,b=1/(t.uvScale??1),x=t.grimeBand;for(let e=0;e<l;e++){let n=p.r,r=p.g,c=p.b;if(x){let t=a.getY(e),o=i.clamp((t-x[0])/(x[1]-x[0]),0,1),s=1-x[2]*(1-o);n*=s,r*=s,c*=s}if(u[e*3]=n,u[e*3+1]=r,u[e*3+2]=c,d[e*4]=m,d[e*4+1]=h,d[e*4+2]=_,d[e*4+3]=+!!t.textured,f[e*2]=v,f[e*2+1]=y,!t.keepUv){let t=Math.abs(o.getX(e)),n=Math.abs(o.getY(e)),r=Math.abs(o.getZ(e)),i=a.getX(e),c=a.getY(e),l=a.getZ(e);t>=n&&t>=r?s.setXY(e,l*b,c*b):n>=r?s.setXY(e,i*b,l*b):s.setXY(e,i*b,c*b)}}return e.setAttribute(`color`,new g(u,3)),e.setAttribute(`aMat`,new g(d,4)),e.setAttribute(`aEmit`,new g(f,2)),this.parts.push(e),this.triangles+=e.index.count/3,this}box(e,t,n,r,i){return this.add(new y(e,t,n),r,i)}cyl(e,t,n,r,i,a,o=!1){let s=new _(e,t,n,r,1,o);return s.translate(0,n/2,0),this.add(s,i,a)}cylC(e,t,n,r,i,a,o=!1){return this.add(new _(e,t,n,r,1,o),i,a)}sphere(e,t,n,r){return this.add(new x(e,t,Math.max(4,Math.round(t*.6))),n,r)}tube(e,t,n,r,i){let a=e[0],o=e[1],c=e[2],l=t[0],u=t[1],d=t[2],f=l-a,p=u-o,m=d-c,h=Math.hypot(f,p,m);if(h<1e-4)return this;let g=new _(n,n,h,r,1,!1),v=A.set(f,p,m).normalize();return O.setFromUnitVectors(j.set(0,1,0),v),D.compose(new s((a+l)/2,(o+u)/2,(c+d)/2),O,new s(1,1,1)),this.add(g,i,D.clone())}quad(e,t,n,r,i){let o=new a(e,t);if(i){let e=o.attributes.uv;for(let t=0;t<e.count;t++)e.setXY(t,i[0]+e.getX(t)*i[2],i[1]+e.getY(t)*i[3])}return this.add(o,{keepUv:!0,...n},r)}lathe(e,t,r,i){let a=e.map(([e,t])=>new n(e,t));return this.add(new S(a,t),r,i)}octPole(e,t,n,r,i){return this.cyl(t,e,n,8,r,i)}prism(t,r,i,a){let o=new e(t.map(([e,t])=>new n(e,-t))),s=new u(o,{depth:r,bevelEnabled:!1,steps:1});return s.rotateX(-Math.PI/2),this.add(s,i,a)}merge(e,t){let n=t instanceof c?t:N(t,D);for(let t of e.parts){let e=t.clone();e.applyMatrix4(n),this.parts.push(e),this.triangles+=e.index.count/3}return this}isEmpty(){return this.parts.length===0}build(){if(this.parts.length===0){let e=new m;return e.setAttribute(`position`,new g(new Float32Array,3)),e}let e=this.parts.length===1?this.parts[0]:T(this.parts,!1);if(!e)throw Error(`[props] mergeGeometries failed`);for(let t of this.parts)t!==e&&t.dispose();return this.parts=[],e.computeBoundingSphere(),e.computeBoundingBox(),e}};function F(e){let t=e.attributes.position.count,n=new Uint32Array(t);for(let e=0;e<t;e++)n[e]=e;return e.setIndex(new g(n,1)),e}function I(e,t=0,n=0){let r=Math.imul(e*73856093^t*19349663^n*83492791,2654435761)>>>0;return r^=r>>>13,r=Math.imul(r,1540483477)>>>0,r^=r>>>15,(r>>>0)/4294967296}function L(e){let t=e>>>0||1;return()=>(t^=t<<13,t>>>=0,t^=t>>>17,t^=t<<5,t>>>=0,(t>>>0)/4294967296)}function R(e,t){let n=typeof document>`u`?new OffscreenCanvas(e,t):document.createElement(`canvas`);return n.width=e,n.height=t,{c:n,g:n.getContext(`2d`)}}function z(e,n={}){let r=new w(e);return r.colorSpace=n.srgb===!1?``:d,r.wrapS=r.wrapT=n.repeat===!1?t:o,r.anisotropy=n.aniso??8,r.generateMipmaps=n.mip!==!1,r.minFilter=n.mip===!1?h:p,r.magFilter=h,r.needsUpdate=!0,r}function B(){let{c:e,g:t}=R(512,512),n=L(503);t.clearRect(0,0,512,512),t.save(),t.beginPath(),t.rect(0,0,512,256),t.clip();let r=256/20;t.strokeStyle=`#454a37`,t.lineWidth=1.8,t.lineJoin=`bevel`,t.lineCap=`butt`,t.beginPath();for(let e=-1;e<=20;e++)for(let n=-1;n<=64;n++){let i=n*8,a=e*r;t.moveTo(i,a+r/2),t.lineTo(i+4,a),t.lineTo(i+8,a+r/2),t.lineTo(i+4,a+r),t.closePath()}t.stroke(),t.globalCompositeOperation=`source-atop`,t.strokeStyle=`#282d22`,t.lineWidth=.46,t.beginPath();for(let e=-1;e<=20;e++)for(let n=-1;n<=64;n++){let i=n*8,a=e*r+.6;t.moveTo(i,a+r/2),t.lineTo(i+4,a),t.moveTo(i+4,a+r),t.lineTo(i+8,a+r/2)}t.stroke();for(let e=0;e<20;e++){let r=n()*512,i=n()*256,a=20+n()*55,o=t.createRadialGradient(r,i,0,r,i,a);o.addColorStop(0,e%3?`rgba(28,32,23,0.58)`:`rgba(102,105,79,0.42)`),o.addColorStop(1,`rgba(35,42,29,0)`),t.fillStyle=o,t.fillRect(r-a,i-a,a*2,a*2)}for(let[e,r,i]of[[63,35,15],[194,166,23],[383,237,25],[452,71,13]])for(let a=0;a<65;a++){let o=n()*Math.PI*2,s=Math.sqrt(n())*i;t.fillStyle=a%3?`rgba(92,55,30,0.80)`:`rgba(139,91,48,0.55)`,t.fillRect(e+Math.cos(o)*s,r+Math.sin(o)*s,1+n()*4,1+n()*5)}let i=t.createLinearGradient(0,185,0,256);i.addColorStop(0,`rgba(13,18,13,0)`),i.addColorStop(1,`rgba(13,18,13,0.58)`),t.fillStyle=i,t.fillRect(0,185,512,71),t.restore(),t.save(),t.beginPath(),t.rect(172,256,340,256),t.clip(),t.fillStyle=`#444838`,t.fillRect(172,256,340,256);for(let e=0;e<16;e++){let r=172+n()*340,i=256+n()*256,a=15+n()*75,o=t.createRadialGradient(r,i,0,r,i,a);o.addColorStop(0,e%3?`rgba(27,32,23,0.54)`:`rgba(100,104,79,0.42)`),o.addColorStop(1,`rgba(35,42,29,0)`),t.fillStyle=o,t.fillRect(r-a,i-a,a*2,a*2)}for(let e=0;e<96;e++){let r=e%2?174+n()*11:499+n()*11,i=256+n()*256,a=2+n()*10,o=2+n()*13;t.fillStyle=e%5?`#60472e`:`#77705c`,t.beginPath(),t.moveTo(r,i),t.lineTo(r+a*.6,i+1),t.lineTo(r+a,i+o*.45),t.lineTo(r+a*.45,i+o),t.lineTo(r-1,i+o*.72),t.closePath(),t.fill()}for(let[e,r]of[[.03,.18],[.97,.7],[.12,.89],[.84,.11]]){let i=t.createRadialGradient(172+e*340,256+r*256,0,172+e*340,256+r*256,23);i.addColorStop(0,`rgba(79,53,30,0.68)`),i.addColorStop(1,`rgba(51,40,25,0)`),t.fillStyle=i,t.fillRect(172+e*340-23,256+r*256-23,46,46);for(let i=0;i<40;i++)t.fillStyle=i%3?`rgba(87,54,30,0.80)`:`rgba(123,85,45,0.64)`,t.fillRect(172+e*340+(n()-.5)*28,256+r*256+(n()-.5)*33,1+n()*7,1+n()*9)}let a=L(1503);for(let[e,n,r,i]of[[.72,.23,95,22],[.8,.57,104,18],[.7,.85,78,26]]){let o=172+e*340,s=256+n*256;t.save(),t.beginPath();for(let e=0;e<16;e++){let n=e/16*Math.PI*2,c=.72+a()*.28,l=o+Math.cos(n)*r*.5*c,u=s+Math.sin(n)*i*.5*c;e===0?t.moveTo(l,u):t.lineTo(l,u)}t.closePath(),t.fillStyle=`#765335`,t.fill(),t.strokeStyle=`#302e23`,t.lineWidth=2,t.stroke(),t.clip();for(let e=0;e<48;e++)t.fillStyle=e%3?`rgba(63,47,29,0.58)`:`rgba(157,117,69,0.65)`,t.fillRect(o+(a()-.5)*r,s+(a()-.5)*i,2+a()*8,1+a()*4);t.restore()}t.restore(),t.save(),t.beginPath(),t.rect(0,256,172,256),t.clip(),t.fillStyle=`#c9c6b3`,t.fillRect(0,256,172,256);for(let[e,n,r]of[[31,308,54],[143,397,48],[83,461,61]]){let i=t.createRadialGradient(e,n,2,e,n,r);i.addColorStop(0,`rgba(92,78,50,0.35)`),i.addColorStop(1,`rgba(92,78,50,0)`),t.fillStyle=i,t.fillRect(e-r,n-r,r*2,r*2)}t.strokeStyle=`#575a4a`,t.lineWidth=1.5,t.strokeRect(5,261,162,246),t.textAlign=`center`,t.textBaseline=`middle`;let o=`"Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif`;t.fillStyle=`#27372c`,t.font=`bold 19px ${o}`,t.fillText(`KEEP NYC`,86,282,145),t.font=`bold 25px ${o}`,t.fillText(`CLEAN`,86,307,145),t.fillStyle=`#23251f`,t.font=`bold 16px ${o}`,t.fillText(`NO HOUSEHOLD`,86,348,151),t.font=`bold 21px ${o}`,t.fillText(`TRASH`,86,371,151),t.font=`bold 17px ${o}`,t.fillText(`NO BUSINESS`,86,410,151),t.font=`bold 21px ${o}`,t.fillText(`TRASH`,86,433,151),t.fillStyle=`#853d2c`,t.font=`bold 23px ${o}`,t.fillText(`FINES APPLY`,86,483,151),t.strokeStyle=`#7c7b6b`,t.lineWidth=.7;for(let e of[327,454])t.beginPath(),t.moveTo(12,e),t.lineTo(160,e),t.stroke();for(let e=0;e<300;e++){let e=n()*172,r=256+n()*256,i=Math.min(e,172-e,r-256,512-r);t.fillStyle=i<11?`rgba(71,54,32,0.65)`:`rgba(76,74,58,0.15)`,t.fillRect(e,r,.6+n()*3,.8+n()*(i<11?8:3))}for(let e of[13,159])for(let n of[270,498])t.fillStyle=`#5b4931`,t.beginPath(),t.arc(e,n,2.7,0,Math.PI*2),t.fill(),t.fillStyle=`#939080`,t.fillRect(e-1,n-1,2,1),t.fillStyle=`rgba(100,68,37,0.32)`,t.fillRect(e-1,n+3,2,9);t.strokeStyle=`rgba(85,70,45,0.24)`,t.lineWidth=7,t.beginPath(),t.moveTo(69,269),t.lineTo(73,360),t.lineTo(68,423),t.lineTo(80,507),t.stroke();for(let e=0;e<38;e++){let r=340+n()*167,i=(r<423?73-(r-360)*5/63:68+(r-423)*12/84)+(n()-.5)*6,a=1+n()*5,o=2+n()*9;t.fillStyle=e%4?`#b8b299`:`#73654a`,t.beginPath(),t.moveTo(i,r),t.lineTo(i+a,r-1),t.lineTo(i+a*.7,r+o),t.lineTo(i-1,r+o*.65),t.closePath(),t.fill()}return t.strokeStyle=`rgba(218,212,190,0.7)`,t.lineWidth=1,t.beginPath(),t.moveTo(67,267),t.lineTo(71,360),t.lineTo(66,423),t.lineTo(78,507),t.stroke(),t.restore(),z(e,{srgb:!0,repeat:!1})}function V(e=256){let{c:t,g:n}=R(e,e),r=n.createRadialGradient(e/2,e/2,0,e/2,e/2,e/2);return r.addColorStop(0,`rgba(255,255,255,1)`),r.addColorStop(.25,`rgba(255,255,255,0.55)`),r.addColorStop(.6,`rgba(255,255,255,0.14)`),r.addColorStop(1,`rgba(255,255,255,0)`),n.fillStyle=r,n.fillRect(0,0,e,e),z(t,{srgb:!1,repeat:!1})}function H(e=128){let{c:t,g:n}=R(e,e),r=L(11),i=n.createRadialGradient(e/2,e/2,0,e/2,e/2,e/2);i.addColorStop(0,`rgba(255,255,255,0.9)`),i.addColorStop(.4,`rgba(255,255,255,0.45)`),i.addColorStop(1,`rgba(255,255,255,0)`),n.fillStyle=i,n.fillRect(0,0,e,e),n.globalCompositeOperation=`destination-out`;for(let t=0;t<14;t++){let t=r()*e,i=r()*e,a=8+r()*22,o=n.createRadialGradient(t,i,0,t,i,a);o.addColorStop(0,`rgba(0,0,0,0.35)`),o.addColorStop(1,`rgba(0,0,0,0)`),n.fillStyle=o,n.fillRect(t-a,i-a,a*2,a*2)}return z(t,{srgb:!1,repeat:!1})}var U=45,W=Math.sin(29*Math.PI/180),G=-Math.cos(29*Math.PI/180),K=11.2,q=(()=>{const hash01=I;
/** Junction-based signals. Opposing approaches share a phase; distinct axes
 * receive separate greens. Ordinary four-way junctions retain the 90 s cycle.
 * Complex junctions include an exclusive pedestrian interval. All timing uses
 * server time and geometry, independent of tile/pole insertion order. */

const CYCLE = 90;
const GREEN = 40;
const YELLOW = 3;
const ALL_RED = 2;
const HALF = GREEN + YELLOW + ALL_RED; // 45
const AXIS_DOT = Math.cos(Math.PI / 12); // 15 degrees, pairwise (no chained groups)
const PED_WALK = 7;
const PED_CLEAR = 20;
const WALK = 20;

                                     // red, yellow, green





























const UPTOWN_X = Math.sin((29 * Math.PI) / 180);
const UPTOWN_Z = -Math.cos((29 * Math.PI) / 180);
const WAVE_SPEED = 11.2; // m/s

class SignalNetwork {
  clusters            = [];
  poles               = [];
          grid = new Map                   ();
          poleGrid = new Map                                   ();
          poleOrder = new WeakMap                    ();
          poleSeq = 0;
          seq = 1;
          junctions = new Map                 ();
          approaches = new Map                                                ();

  /** One mast per incoming node/direction, shared across overlapping tiles. */
  claimApproach(a                , owner        )          {
    if (!a.incoming) return false;
    const key = `${Math.round(a.x * 10)}:${Math.round(a.z * 10)}:${a.layer ?? 0}`;
    const entries = this.approaches.get(key) ?? [];
    if (entries.some(b => a.fx * b.fx + a.fz * b.fz > 0.999)) return false;
    entries.push({ ...a, owner });
    this.approaches.set(key, entries);
    return true;
  }

  /** Placement generators keep this network by identity while tiles interleave. */
  resetPoles()       {
    this.clusters = [];
    this.poles = [];
    this.grid.clear();
    this.junctions.clear();
    this.poleGrid.clear();
    this.poleOrder = new WeakMap();
    this.poleSeq = 0;
    this.seq = 1;
  }

          gridKey(x        , z        )         {
    return `${Math.floor(x / 32)}_${Math.floor(z / 32)}`;
  }

          findCluster(x        , z        )                 {
    const gx = Math.floor(x / 32), gz = Math.floor(z / 32);
    let best                 = null;
    let bestD = 20 * 20;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = this.grid.get(`${gx + i}_${gz + j}`);
        if (!list) continue;
        for (const c of list) {
          if (c.junction) continue;
          const d = (c.cx - x) ** 2 + (c.cz - z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    return best;
  }

  addPole(x        , z        , yaw        , tileKey        , approach                        )             {
    // yaw convention: local -z faces (sin(-yaw)?)... geo.ts: yaw = -heading; forward = (sin(heading), -cos(heading))
    const heading = -yaw;
    const fx = approach?.fx ?? Math.sin(heading), fz = approach?.fz ?? -Math.cos(heading);
    const junction = approach ? `${Math.round(approach.x * 10)}:${Math.round(approach.z * 10)}:${approach.layer ?? 0}` : undefined;
    let c = junction ? this.junctions.get(junction) : this.findCluster(x, z);
    if (!c) {
      c = { id: this.seq++, cx: approach?.x ?? x, cz: approach?.z ?? z, poles: [], offset: 0, ax: fx, az: fz, junction, phaseCount: 2, cycle: CYCLE, allRed: ALL_RED };
      if (junction) this.junctions.set(junction, c);
      const k = this.gridKey(x, z);
      const list = this.grid.get(k);
      if (list) list.push(c);
      else this.grid.set(k, [c]);
      c.offset = this.offsetFor(c);
    }
    const pole             = { x, z, fx, fz, cluster: c, phase: 0, tileKey, approach: approach ?? undefined };
    c.poles.push(pole);
    this.poles.push(pole);
    const stop = this.stopFor(pole);
    const gx = Math.floor(stop.x / 32), gz = Math.floor(stop.z / 32);
    let column = this.poleGrid.get(gx);
    if (!column) { column = new Map(); this.poleGrid.set(gx, column); }
    let bucket = column.get(gz);
    if (!bucket) { bucket = []; column.set(gz, bucket); }
    bucket.push(pole);
    this.poleOrder.set(pole, this.poleSeq++);
    this.plan(c);
    if (!this.clusters.includes(c)) this.clusters.push(c);
    return pole;
  }

          plan(c         )       {
    // Full road arms keep phases stable even if only one corner is loaded or
    // selected for mobile rendering. Sort axes so reversing tile order is harmless.
    const arms                                 = c.poles.flatMap(p => p.approach?.arms.filter(a => a.incoming) ?? [p]);
    const angle = (a                            ) => ((Math.atan2(a.fz, a.fx) % Math.PI) + Math.PI) % Math.PI;
    arms.sort((a, b) => angle(a) - angle(b));
    const groups                = [];
    for (const arm of arms) {
      let group = groups.find(g => g.every(a => Math.abs(a.fx * arm.fx + a.fz * arm.fz) >= AXIS_DOT));
      if (!group) groups.push(group = []);
      group.push(arm);
    }
    // Put the avenue axis first, retaining the existing green-wave convention.
    groups.sort((a, b) => Math.abs(b[0].fx * UPTOWN_X + b[0].fz * UPTOWN_Z)
      - Math.abs(a[0].fx * UPTOWN_X + a[0].fz * UPTOWN_Z) || angle(a[0]) - angle(b[0]));
    c.phaseCount = Math.max(2, groups.length);
    for (const p of c.poles) {
      p.phase = groups.findIndex(g => g.every(a => Math.abs(a.fx * p.fx + a.fz * p.fz) >= AXIS_DOT));
      // Authored head yaw can differ a few degrees from the road tangent.
      if (p.phase < 0) p.phase = groups.reduce((best, g, i) => Math.abs(g[0].fx * p.fx + g[0].fz * p.fz)
        > Math.abs(groups[best][0].fx * p.fx + groups[best][0].fz * p.fz) ? i : best, 0);
    }
    c.ax = groups[0]?.[0].fx ?? c.ax; c.az = groups[0]?.[0].fz ?? c.az;
    let span = 0;
    for (const p of c.poles) if (p.approach) {
      for (const a of p.approach.arms) for (const b of p.approach.arms) {
        const cross = Math.abs(a.fx * b.fz - a.fz * b.fx);
        if (cross > 0.25) span = Math.max(span, b.width / cross + 4);
      }
    }
    c.allRed = Math.max(ALL_RED, Math.min(6, Math.ceil(span / 10) - 1));
    c.cycle = CYCLE + (c.phaseCount > 2 ? PED_WALK + PED_CLEAR : 0);
    c.offset = this.offsetFor(c);
  }

          stopFor(p            )                           {
    const a = p.approach;
    if (a) return { x: a.x + p.fx * a.setback, z: a.z + p.fz * a.setback };
    const c = p.cluster;
    const d = Math.max(4, (c.cx - p.x) * p.fx + (c.cz - p.z) * p.fz) + 1;
    return { x: c.cx + p.fx * d, z: c.cz + p.fz * d };
  }

          offsetFor(c         )         {
    // is the phase-A axis the avenue axis? then the wave applies to the projection along uptown
    const along = c.cx * UPTOWN_X + c.cz * UPTOWN_Z;
    const wave = (along / WAVE_SPEED) % c.cycle;
    const jitter = (hash01(Math.round(c.cx), Math.round(c.cz)) - 0.5) * 6;
    // avenues (phase A parallel to uptown) get the wave; cross streets get the wave plus half a cycle
    const avenueLike = Math.abs(c.ax * UPTOWN_X + c.az * UPTOWN_Z) > 0.7;
    return ((avenueLike ? wave : wave + HALF) + jitter + c.cycle * 10000) % c.cycle;
  }

  removeTile(tileKey        )       {
    for (const [key, entries] of this.approaches) {
      const keep = entries.filter(a => a.owner !== tileKey);
      if (keep.length) this.approaches.set(key, keep);
      else this.approaches.delete(key);
    }
    const keep               = [];
    for (const p of this.poles) {
      if (p.tileKey === tileKey) {
        const i = p.cluster.poles.indexOf(p);
        if (i >= 0) p.cluster.poles.splice(i, 1);
        const stop = this.stopFor(p);
        const gx = Math.floor(stop.x / 32), gz = Math.floor(stop.z / 32);
        const column = this.poleGrid.get(gx) , bucket = column.get(gz) ;
        bucket.splice(bucket.indexOf(p), 1);
        if (!bucket.length) column.delete(gz);
        if (!column.size) this.poleGrid.delete(gx);
      } else keep.push(p);
    }
    this.poles = keep;
    for (const [key, c] of this.junctions) if (!c.poles.length) this.junctions.delete(key);
    for (const c of this.clusters) if (c.poles.length) this.plan(c);
    // drop empty clusters
    this.clusters = this.clusters.filter((c) => c.poles.length > 0);
    for (const [k, list] of this.grid) {
      const filtered = list.filter((c) => c.poles.length > 0);
      if (filtered.length) this.grid.set(k, filtered);
      else this.grid.delete(k);
    }
  }

  static phaseTime(c         , serverTime        )         {
    return (((serverTime + c.offset) % c.cycle) + c.cycle) % c.cycle;
  }

  static vehicleState(phase        , t        , c          )              {
    const slot = CYCLE / (c?.phaseCount ?? 2);
    const green = slot - YELLOW - (c?.allRed ?? ALL_RED);
    const local = t - phase * slot;
    if (local < 0 || local >= slot) return 0;
    if (local < green) return 2;
    if (local < green + YELLOW) return 1;
    return 0;
  }

  /** A perpendicular head is not necessarily the next vehicle phase. Complex
   * junctions use an exclusive WALK while every vehicle approach is red. */
  static pedestrianFrame(pole            , perpendicular         , t        )         {
    const c = pole.cluster;
    if (c.phaseCount > 2) {
      if (t < CYCLE) return 1;
      if (t < CYCLE + PED_WALK) return 0;
      return 32 - Math.max(1, Math.min(29, Math.ceil(c.cycle - t)));
    }
    return SignalNetwork.pedFrame(perpendicular ? 1 - pole.phase : pole.phase, t, c);
  }

  static pedFrame(phase        , t        , c          )         {
    const green = CYCLE / (c?.phaseCount ?? 2) - YELLOW - (c?.allRed ?? ALL_RED);
    const local = t - phase * (CYCLE / (c?.phaseCount ?? 2));
    if (local < 0 || local >= green) return 1;
    if (local < Math.min(WALK, green - 20)) return 0;
    return 32 - Math.max(1, Math.min(29, Math.ceil(green - local)));
  }

  /** signal for a vehicle at (x,z) heading (dx,dz): nearest approach stop line within 45 m ahead */
  signalFor(x        , z        , dx        , dz        , serverTime        , layer = 0)                                                                                           {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(dx)
      || !Number.isFinite(dz) || !Number.isFinite(serverTime)) return null;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return null;
    dx /= len;
    dz /= len;
    let best                    = null;
    let bestAhead = Infinity;
    let bestOrder = Infinity;
    const x0 = Math.floor((x - 64) / 32), x1 = Math.floor((x + 64) / 32);
    const z0 = Math.floor((z - 64) / 32), z1 = Math.floor((z + 64) / 32);
    for (let gx = x0; gx <= x1; gx++) {
      const column = this.poleGrid.get(gx);
      if (!column) continue;
      for (let gz = z0; gz <= z1; gz++) {
        const bucket = column.get(gz);
        if (!bucket) continue;
        for (const p of bucket) {
          if ((p.approach?.layer ?? 0) !== layer) continue;
          const stop = this.stopFor(p);
          const ox = stop.x - x, oz = stop.z - z;
          // the pole faces the vehicle: its facing is opposite to the travel direction
          if (p.fx * dx + p.fz * dz > -AXIS_DOT) continue;
          const ahead = ox * dx + oz * dz; // distance along travel
          // Keep the current signal while clearing its junction. The driver
          // ignores a stop line behind it instead of treating the exit as a
          // fresh unsignaled junction and stopping again inside the crossing.
          if (ahead < -(p.approach?.setback ?? 2) || ahead > 45) continue;
          const lateral = Math.abs(ox * dz - oz * dx);
          if (lateral > (p.approach ? p.approach.width / 2 + 1 : 14)) continue;
          // Grid traversal must retain the original insertion-order tie break.
          const order = this.poleOrder.get(p) ;
          if (ahead < bestAhead || (ahead === bestAhead && order < bestOrder)) {
            bestAhead = ahead;
            bestOrder = order;
            best = p;
          }
        }
      }
    }
    if (!best) return null;
    const c = best.cluster;
    const t = SignalNetwork.phaseTime(c, serverTime);
    const s = SignalNetwork.vehicleState(best.phase, t, c);
    const { x: stopX, z: stopZ } = this.stopFor(best);
    const dist = (stopX - x) * dx + (stopZ - z) * dz;
    return { state: s === 2 ? 'green' : s === 1 ? 'yellow' : 'red', stopX, stopZ, dist };
  }
}

return SignalNetwork;})(),J={color:6252132,rough:.62,metal:.55,grimeBand:[0,2.4,.4]},Y={color:4212292,rough:.65,metal:.5},X={color:4936272,rough:.55,metal:.6},Z={color:14209720,rough:.35,metal:0,emit:E.lamp,emitStrength:1.6},Q=9.1;function $(e,t=!1){let r=new P;r.box(.4,.05,.4,Y,{y:.025}),r.box(.32,.62,.32,{...J,grimeBand:[0,.6,.5]},{y:.36}),r.box(.36,.03,.36,Y,{y:.68}),e===`near`&&r.box(.2,.42,.01,Y,{y:.36,z:.16});let a=new _(.045,.075,8.4,8).toNonIndexed();a.computeVertexNormals(),r.add(a,J,{y:9.799999999999999/2});let o=10.1,c=new v(new s(0,Q,0),new s(0,o,0),new s(0,o,-1.2),new s(0,o,-2.4)),l=e===`near`?32:16,u=new b(c,l,1,8,!1),d=u.getAttribute(`position`);for(let e=0;e<=l;e++){let t=c.getPointAt(e/l),n=i.lerp(.045,.032,e/l);for(let r=0;r<=8;r++){let i=e*9+r;d.setXYZ(i,t.x+(d.getX(i)-t.x)*n,t.y+(d.getY(i)-t.y)*n,t.z+(d.getZ(i)-t.z)*n)}}if(u.computeVertexNormals(),r.add(u,J),t)r.box(.12,.08,.18,X,{y:o,z:-2.36}),r.box(.4,.1,.74,X,{y:10.09,z:-2.69}),r.quad(.33,.52,{...Z,color:15199213},{y:10.039,z:-2.75,rx:Math.PI/2});else{let t=new S([[0,0],[.065,0],[.1,.13],[.19,.3],[.23,.46],[.22,.6],[.13,.7],[0,.74]].map(([e,t])=>new n(e,t)),e===`near`?16:10);t.scale(1,1,.48),t.rotateX(-Math.PI/2),r.add(t,X,{y:o,z:-2.32});let i=new x(1,e===`near`?16:10,8,0,Math.PI*2,Math.PI/2,Math.PI/2);i.scale(.21,.15,.24),r.add(i,Z,{y:10.055,z:-2.78})}if(e===`near`){r.cyl(.03,.03,.04,6,{color:3356216,rough:.7,metal:.3},{y:10.2,z:-2.7199999999999998}),r.quad(.09,.07,{color:15262416,rough:.8,metal:0},{x:0,y:1.65,z:.073,keepUv:!1}),r.quad(.06,.06,{color:13191996,rough:.8,metal:0},{x:.038,y:1.45,z:.062,ry:.55}),r.quad(.07,.04,{color:2845872,rough:.8,metal:0},{x:-.047,y:1.3,z:.056,ry:-.7});for(let e=0;e<4;e++){let t=e/4*Math.PI*2+Math.PI/4;r.cyl(.014,.014,.05,6,Y,{x:Math.cos(t)*.16,y:.05,z:Math.sin(t)*.16})}}return r.build()}var ee=new s(0,10,-2.78);export{V as a,P as c,B as i,I as l,$ as n,H as o,q as r,E as s,ee as t,L as u};
//# sourceMappingURL=lamp-DWcKsT0C.js.map