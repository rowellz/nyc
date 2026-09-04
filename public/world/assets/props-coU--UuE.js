import{f as e,p as t}from"./index-DQv-X5z6.js";import{B as n,C as r,Et as i,Gt as a,Hn as o,Kt as s,Or as c,Ot as l,P as u,Pt as d,Qn as f,Tt as p,Y as m,Yn as h,Z as g,_t as _,an as v,ar as y,dr as b,g as x,gt as S,h as C,qt as w,r as T,rt as E,tt as D,w as O,y as k}from"./textureRelease-2U-gT89r.js";import{t as A}from"./loading-DS_gLujL.js";import{r as j}from"./geo-Db9f_zPw.js";import{c as ee,d as M,i as N,l as P,p as te,r as ne}from"./styles-CD9VAM0e.js";import{c as re,i as ie,o as ae}from"./polygon-BtfRVykj.js";import{n as oe,r as se,t as ce}from"./transfer-CN3_6JL-.js";import{a as le,t as F}from"./builder-Ct8y1lc-.js";import{t as ue}from"./instanceUpdates-Cv2y6DTC.js";import{n as de,t as fe}from"./geom-BgyHPiiG.js";import{s as I}from"./main-D_3aygO4.js";import{a as pe,i as me,l as L,o as R,r as he,s as z,t as B}from"./lamp-DWcKsT0C.js";var V=4096,H=4096,U=248/382,W=256/382,G={headHeight:.5,routeTop:.53,routeBottom:.97,routeInset:.08,routeGap:.018,routeMaxHeight:.22},K=Math.floor(V/384),q=256,J=1024,Y=`"Highway Gothic", "Roadgeek 2005 Series D", "Arial Narrow", "Helvetica Neue", Helvetica, Arial, sans-serif`,X=`"Helvetica Neue", Helvetica, Arial, sans-serif`;function ge(){let e=new Uint8Array(1048576),t=96317,n=()=>(t=Math.imul(t,1664525)+1013904223>>>0,t/4294967296);for(let t=0;t<e.length;t+=4)e[t]=67,e[t+1]=91,e[t+2]=43;for(let t=0;t<4;t++){let r=t%2*256,a=Math.floor(t/2)*256,o=(t,n,o,s)=>{if(t<4||t>=252||n<4||n>=252)return;let c=((a+n)*512+r+t)*4,l=Math.round(255*i.clamp(s,0,1));l<e[c+3]||(e[c]=o[0],e[c+1]=o[1],e[c+2]=o[2],e[c+3]=l)},s=(e,t,n,r,a)=>{let s=n-e,c=r-t,l=s*s+c*c;for(let u=Math.floor(Math.min(t,r)-a-1);u<=Math.ceil(Math.max(t,r)+a+1);u++)for(let r=Math.floor(Math.min(e,n)-a-1);r<=Math.ceil(Math.max(e,n)+a+1);r++){let n=i.clamp(((r-e)*s+(u-t)*c)/l,0,1);o(r,u,[90,91,48],a+.5-Math.hypot(r-e-n*s,u-t-n*c))}},c=(e,r,i,a,s)=>{let c=Math.sin(s),l=Math.cos(s),u=Math.ceil(Math.hypot(i,a)),d=[[69,98,46],[83,111,53],[58,86,41],[91,115,59]][Math.floor(n()*4)],f=t===3;for(let t=Math.floor(r-u);t<=Math.ceil(r+u);t++)for(let s=Math.floor(e-u);s<=Math.ceil(e+u);s++){let u=(s-e)*l-(t-r)*c,p=(s-e)*c+(t-r)*l,m=p/i;if(Math.abs(m)>=1)continue;let h=a*(1-m*m)**(f?.68:.52)*(1-.1*m)*(f?.976+.024*Math.cos(m*48):1),g=Math.min(h-Math.abs(u)+.5,i-Math.abs(p));if(g<=0)continue;let _=u<0?.92:1.06,v=Math.max(0,1-Math.abs(u)/(i*.043))*.12,y=f?Math.max(0,1-Math.abs(Math.sin((p-Math.abs(u)*.72)*11/i))*7)*.065:0,b=_+v+y+m*.04+(n()-.5)*.055;o(s,t,d.map(e=>Math.round(e*b)),g)}};if(t>=2){s(128,12,128,52,2.1),c(128,133,106,t===3?99:92,0);continue}let l=(t-.5)*7.2;s(128,22,128+l,218,1.5);for(let e=0;e<5;e++)for(let t of[-1,1]){let r=50+e*34+(t>0?8:0),i=128+l*r/218,a=31+n()*8,o=t*(.87+n()*.35),u=i+t*a,d=r+8+n()*8;s(i,r-9,u,d,.9),c(u,d,28+n()*6,16+n()*4,o)}c(128+l,218,23,12.5,l*.035)}let r=new u(e,512,512,v);return r.name=`planter-leaf-sprays`,r.colorSpace=h,r.magFilter=S,r.minFilter=_,r.generateMipmaps=!0,r.anisotropy=4,r.needsUpdate=!0,r}function _e(){let e=document.createElement(`canvas`);e.width=e.height=512;let t=e.getContext(`2d`),n=`#273d5a`,i=(e,n)=>{t.fillStyle=n,t.beginPath(),e.forEach(([e,n],r)=>r?t.lineTo(e,n):t.moveTo(e,n)),t.closePath(),t.fill()};t.fillStyle=`#dddcd0`,t.beginPath(),t.roundRect(9,9,238,238,9),t.fill(),t.fillStyle=n,t.fillRect(22,22,212,153),t.fillStyle=`#e3e3d8`,t.beginPath(),t.moveTo(37,38),t.lineTo(184,83),t.bezierCurveTo(207,90,220,117,214,144),t.lineTo(37,154),t.lineTo(153,125),t.bezierCurveTo(176,120,197,126,209,137),t.bezierCurveTo(202,117,183,108,162,106),t.lineTo(89,94),t.closePath(),t.fill(),i([[88,60],[178,94],[154,94],[115,81]],n),i([[178,99],[193,103],[181,105]],n),t.fillStyle=n,t.textAlign=`center`,t.font=`500 22px ${X}`,t.fillText(`UNITED STATES`,128,201,215),t.fillText(`POSTAL SERVICE`,128,229,215),t.fillStyle=`#936e62`,t.fillRect(22,207,210,2),t.fillStyle=`#edf1f2`,t.fillRect(264,8,240,120),t.strokeStyle=`#657383`,t.lineWidth=2,t.strokeRect(269,13,230,110),t.fillStyle=n,t.font=`bold 18px ${X}`,t.fillText(`PULL HANDLE`,384,35,222),t.font=`bold 15px ${X}`,t.fillText(`MAIL COLLECTION`,384,57,222),t.fillRect(279,64,210,1),t.fillStyle=`#527392`;for(let e=0;e<7;e++)for(let n=0;n<2;n++){let r=279+n*108,i=73+e*6.5,a=89+e%3*4-n*3;t.fillRect(r,i,a,1.8),t.fillStyle=`#edf1f2`;for(let n=1;n<5;n++)t.fillRect(r+n*17+e%4,i,2,1.8);t.fillStyle=`#527392`}t.fillStyle=`#d4d6cc`,t.font=`bold 59px ${X}`,t.fillText(`USPS`,384,208,232);for(let e of[314,365,414,465])t.clearRect(e,160,2,59);t.fillStyle=`#d2d0bd`,t.fillRect(269,249,102,70),t.fillStyle=`#55718a`,t.fillRect(274,254,92,11),t.fillStyle=`#707779`;for(let e=0;e<5;e++)t.fillRect(278,274+e*7,79-e%3*12,2);t.fillStyle=`#c9c6ad`,t.fillRect(389,249,94,69),t.fillStyle=`#555b59`;for(let e=0;e<25;e++)t.fillRect(396+e*3,264,e%4==0?2:1,28);t.fillRect(400,301,67,2),i([[267,350],[492,349],[500,357],[502,425],[484,432],[277,431],[270,419],[265,411]],`#d0d3cc`),t.fillStyle=`#8b9499`;for(let e=0;e<4;e++)t.fillRect(286+e*2,363+e*15,29+e%2*20,1.5),t.fillRect(403,365+e*15,44-e*7,1.5);let a=6419,o=()=>(a=Math.imul(a,1664525)+1013904223>>>0,a/4294967296);for(let[e,n,r,i]of[[9,9,238,238],[264,8,240,120],[269,249,102,70],[389,249,94,69],[264,348,240,88]]){t.save(),t.beginPath(),t.rect(e,n,r,i),t.clip();for(let a=0;a<18;a++){let s=e+o()*r,c=a%2?n+o()*4:n+i-o()*4;t.clearRect(s,c,1+o()*8,1+o()*5)}t.fillStyle=`rgba(211, 209, 189, 0.16)`;for(let a=0;a<35;a++)t.fillRect(e+o()*r,n+o()*i,1+o()*4,1);t.restore()}t.save(),t.beginPath(),t.rect(264,8,240,120),t.clip(),t.globalCompositeOperation=`destination-out`;for(let e=0;e<25;e++){let t=264+o()*240,n=e%2?8:128,r=3+o()*12,a=2+o()*7;i([[t-r,n],[t-r*.7,n-a*.6],[t-r*.2,n-a],[t+r*.6,n-a*.5],[t+r,n+a*.4],[t-r*.3,n+a]],`#000`)}t.restore();let s=new k(e);return s.name=`mailbox-labels-only`,s.colorSpace=h,s.wrapS=s.wrapT=r,s.anisotropy=8,s.minFilter=_,s.magFilter=S,s}var ve=class{builds;canUpload;canvas;g;texture;uploadJob;disposed=!1;slots=new Map;free=[];fixedCount=0;dirty=!1;lastUpload=-1/0;uploads=0;constructor(e,t=()=>!0,n=1){this.builds=e,this.canUpload=t,this.canvas=document.createElement(`canvas`),this.canvas.width=V*n,this.canvas.height=H*n,this.g=this.canvas.getContext(`2d`,{willReadFrequently:!1}),this.g.scale(n,n),this.g.fillStyle=`#3a3a3a`,this.g.fillRect(0,0,V,H);for(let e=599;e>=0;e--)this.free.push(e);this.texture=new k(this.canvas),T(this.texture,()=>this.canvas),this.texture.colorSpace=h,this.texture.wrapS=this.texture.wrapT=r,this.texture.anisotropy=8,this.texture.generateMipmaps=!0,this.texture.minFilter=_,this.texture.magFilter=S,this.texture.flipY=!0,e||(this.texture.needsUpdate=!0),this.drawFixed(),this.dirty=!0,e&&(this.uploadJob=e.job(`props sign atlas`))}rectOf(e){let t=e%K,n=Math.floor(e/K),r=t*384,i=n*64,a=(r+1)/V,o=382/V,s=1-(i+1)/H,c=62/H;return[a,s-c,o,c]}slotXY(e){return{x:e%K*384,y:Math.floor(e/K)*64}}static sub(e,t,n,r,i){return[e[0]+e[2]*t,e[1]+e[3]*(1-n-i),e[2]*r,e[3]*i]}acquire(e,t){let n=this.slots.get(e);if(n)return n.refs++,n.rect;if(this.free.length===0){for(let[e,t]of this.slots)if(t.refs<=0&&t.index>=this.fixedCount){this.slots.delete(e),this.free.push(t.index);break}if(this.free.length===0)return console.warn(`[props] sign atlas full; reusing the blank slot`),this.fixed(`blank-green`)}let r=this.free.pop(),{x:i,y:a}=this.slotXY(r);this.g.save(),this.g.beginPath(),this.g.rect(i,a,384,64),this.g.clip(),this.g.fillStyle=`#3a3a3a`,this.g.fillRect(i,a,384,64);try{t(this.g,i,a,384,64)}catch(t){console.warn(`[props] sign draw failed`,e,t)}return this.g.restore(),n={index:r,key:e,refs:1,rect:this.rectOf(r)},this.slots.set(e,n),this.dirty=!0,this.builds&&!this.uploadJob?.pending&&(this.uploadJob=this.builds.job(`props sign atlas`)),n.rect}release(e){let t=this.slots.get(e);!t||t.index<this.fixedCount||t.refs--}fixed(e){let t=this.slots.get(`fixed:${e}`);return t?t.rect:(console.warn(`[props] unknown fixed sign`,e),this.slots.get(`fixed:blank-green`).rect)}update(e){if(!this.dirty||this.disposed||!this.canUpload()||!this.builds&&e-this.lastUpload<.7&&this.uploads>0)return;if(this.dirty=!1,this.lastUpload=e,!this.builds){this.uploads++,this.texture.needsUpdate=!0;return}let t=this.uploadJob?.pending?this.uploadJob:this.builds.job(`props sign atlas`);this.uploadJob=void 0;let n=this;t.run((function*(){yield{texture:n.texture,prepare:()=>{n.texture.needsUpdate=!0,n.uploads++}}})())}dispose(){this.disposed=!0,this.uploadJob?.cancel(),this.texture.dispose()}get stats(){return{slots:this.slots.size,free:this.free.length,uploads:this.uploads}}tallCount=0;addTall(e,t,n){if(this.tallCount>=24){console.warn(`[props] tall atlas strip full`,e);return}let r=this.tallCount++*170,i=Math.min(168,Math.floor(254*t)),a=Math.min(254,Math.floor(i/t));i=Math.floor(a*t),this.g.save(),this.g.beginPath(),this.g.rect(r+1,3841,i,a),this.g.clip(),n(this.g,r+1,3841,i,a),this.g.restore();let o=[(r+1.5)/V,1-(3841.5+a-1)/H,(i-1)/V,(a-1)/H];this.slots.set(`fixed:${e}`,{index:-1,key:`fixed:${e}`,refs:1e9,rect:o})}drawFixed(){let e=(e,t)=>{let n=this.free.pop(),{x:r,y:i}=this.slotXY(n);this.g.save(),this.g.beginPath(),this.g.rect(r,i,384,64),this.g.clip(),t(this.g,r,i,384,64),this.g.restore(),this.slots.set(`fixed:${e}`,{index:n,key:`fixed:${e}`,refs:1e9,rect:this.rectOf(n)}),this.fixedCount++};this.addTall(`no-standing`,12/18,Se),this.addTall(`no-parking`,12/18,Ce),this.addTall(`alt-side`,12/18,we),this.addTall(`stop`,1,Te),this.addTall(`muni`,.26/.78,Ee),this.addTall(`linknyc-screen`,.69/1.22,Oe),this.addTall(`bus-shelter-ad`,1.1/1.7,ke),this.addTall(`citibike-panel`,.42/1.2,Fe),this.addTall(`mta-bus-sign`,.5,(e,t,n,r,i)=>Ie(e,t,n,r,i,[])),e(`blank-green`,(e,t,n,r,i)=>{e.fillStyle=`#0f6b3c`,e.fillRect(t,n,r,i)}),e(`solid-grey`,(e,t,n,r,i)=>{e.fillStyle=`#8a8d90`,e.fillRect(t,n,r,i)}),e(`solid-black`,(e,t,n,r,i)=>{e.fillStyle=`#141414`,e.fillRect(t,n,r,i)}),e(`solid-white`,(e,t,n,r,i)=>{e.fillStyle=`#f2f2f0`,e.fillRect(t,n,r,i)}),e(`one-way-left`,(e,t,n,r,i)=>xe(e,t+1,n+1,3*(i-2),i-2,-1)),e(`one-way-right`,(e,t,n,r,i)=>xe(e,t+1,n+1,3*(i-2),i-2,1)),e(`food-cart-menu`,(e,t,n,r,i)=>De(e,t,n,r,i)),e(`subway-base`,(e,t,n,r,i)=>je(e,t,n,r,i,``)),e(`newsstand-front`,()=>{}),this.g.save(),this.g.beginPath(),this.g.rect(K*384,0,q,J),this.g.clip(),Me(this.g,K*384,0,q,J),this.g.restore(),this.slots.get(`fixed:newsstand-front`).rect=[K*384/V,1-J/H,q/V,J/H]}streetBlade(e){return this.acquire(`blade:${e}`,(t,n,r,i,a)=>be(t,n,r,i,a,e))}subwaySign(e){return this.acquire(`subway:${e}`,(t,n,r,i,a)=>je(t,n,r,i,a,e))}busSign(e){let t=e.slice(0,4).join(` `);return this.acquire(`bus:${t}`,(t,n,r,i,a)=>ye(t,n+1,r+1,i-2,a-2,(t,n,r,i,a)=>Ie(t,n,r,i,a,e),.5))}};function ye(e,t,n,r,i,a,o=.5){e.save(),e.translate(t,n+i),e.rotate(-Math.PI/2),a(e,0,0,i,Math.min(r,i/o)),e.restore()}function be(e,t,n,r,i,a){e.fillStyle=`#0f6b3c`,e.fillRect(t,n,r,i);let o=e.createLinearGradient(t,n,t,n+i);o.addColorStop(0,`rgba(255,255,255,0.10)`),o.addColorStop(.5,`rgba(255,255,255,0)`),o.addColorStop(1,`rgba(0,0,0,0.12)`),e.fillStyle=o,e.fillRect(t,n,r,i),e.strokeStyle=`#f4f4ee`,e.lineWidth=Math.max(2,i*.045),e.strokeRect(t+i*.09,n+i*.09,r-i*.18,i-i*.18),e.fillStyle=`#f7f7f2`,e.textAlign=`center`,e.textBaseline=`middle`;let s=i*.66;e.font=`bold ${Math.round(s)}px ${Y}`;let c=r-i*.5,l=e.measureText(a).width;l>c&&(s*=c/l,e.font=`bold ${Math.round(s)}px ${Y}`,l=e.measureText(a).width),e.fillText(a,t+r/2,n+i*.53)}function xe(e,t,n,r,i,a){e.fillStyle=`#111`,e.fillRect(t,n,r,i),e.fillStyle=`#f4f4f0`,e.strokeStyle=`#f4f4f0`,e.lineWidth=2,e.strokeRect(t+3,n+3,r-6,i-6);let o=n+i/2,s=t+r*.1,c=t+r*.9,l=r*.2;e.beginPath(),a>0?(e.moveTo(s,o-i*.27),e.lineTo(c-l,o-i*.27),e.lineTo(c-l,o-i*.46),e.lineTo(c,o),e.lineTo(c-l,o+i*.46),e.lineTo(c-l,o+i*.27),e.lineTo(s,o+i*.27)):(e.moveTo(c,o-i*.27),e.lineTo(s+l,o-i*.27),e.lineTo(s+l,o-i*.46),e.lineTo(s,o),e.lineTo(s+l,o+i*.46),e.lineTo(s+l,o+i*.27),e.lineTo(c,o+i*.27)),e.closePath(),e.fill(),e.fillStyle=`#111`;let u=`ONE WAY`,d=i*.09,f=s+(a<0?l:0)+d,p=c-(a>0?l:0)-d,m=Math.floor(i*.42);for(e.font=`bold ${m}px ${Y}`;e.measureText(u).width>p-f&&m>1;)e.font=`bold ${--m}px ${Y}`;e.textAlign=`center`,e.textBaseline=`middle`,e.fillText(u,(f+p)/2,o+1,p-f)}function Se(e,t,n,r,i){e.fillStyle=`#f4f4f0`,e.fillRect(t,n,r,i),e.strokeStyle=`#c8102e`,e.lineWidth=r*.03,e.strokeRect(t+r*.05,n+r*.05,r*.9,i-r*.1),e.fillStyle=`#c8102e`,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.22)}px ${X}`,e.fillText(`NO`,t+r/2,n+i*.2),e.fillText(`STANDING`,t+r/2,n+i*.4),e.font=`bold ${Math.round(r*.17)}px ${X}`,e.fillText(`ANYTIME`,t+r/2,n+i*.62),e.beginPath(),e.arc(t+r/2,n+i*.82,r*.12,0,Math.PI*2),e.stroke(),e.beginPath(),e.moveTo(t+r/2-r*.085,n+i*.82+r*.085),e.lineTo(t+r/2+r*.085,n+i*.82-r*.085),e.stroke()}function Ce(e,t,n,r,i){e.fillStyle=`#f4f4f0`,e.fillRect(t,n,r,i),e.strokeStyle=`#c8102e`,e.lineWidth=r*.03,e.strokeRect(t+r*.05,n+r*.05,r*.9,i-r*.1),e.fillStyle=`#c8102e`,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.2)}px ${X}`,e.fillText(`NO`,t+r/2,n+i*.17),e.fillText(`PARKING`,t+r/2,n+i*.34),e.fillStyle=`#111`,e.font=`bold ${Math.round(r*.12)}px ${X}`,e.fillText(`8AM - 6PM`,t+r/2,n+i*.55),e.fillText(`EXCEPT SUNDAY`,t+r/2,n+i*.68),e.font=`${Math.round(r*.1)}px ${X}`,e.fillText(`COMMERCIAL VEHICLES`,t+r/2,n+i*.84),e.fillText(`ONLY`,t+r/2,n+i*.92)}function we(e,t,n,r,i){e.fillStyle=`#f4f4f0`,e.fillRect(t,n,r,i),e.strokeStyle=`#c8102e`,e.lineWidth=r*.03,e.strokeRect(t+r*.05,n+r*.05,r*.9,i-r*.1),e.fillStyle=`#c8102e`,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.2)}px ${X}`,e.fillText(`NO`,t+r/2,n+i*.16),e.fillText(`PARKING`,t+r/2,n+i*.32),e.strokeStyle=`#111`,e.lineWidth=r*.05,e.beginPath(),e.moveTo(t+r*.3,n+i*.62),e.lineTo(t+r*.62,n+i*.45),e.stroke(),e.fillStyle=`#111`,e.fillRect(t+r*.2,n+i*.6,r*.2,i*.08),e.font=`bold ${Math.round(r*.12)}px ${X}`,e.fillText(`11:30AM - 1PM`,t+r/2,n+i*.78),e.fillText(`TUES & FRI`,t+r/2,n+i*.9)}function Te(e,t,n,r,i){let a=t+r/2,o=n+i/2,s=Math.min(r,i)*.5;e.fillStyle=`#b3121b`,e.beginPath();for(let t=0;t<8;t++){let n=Math.PI/8+t*Math.PI/4;e.lineTo(a+Math.cos(n)*s,o+Math.sin(n)*s)}e.closePath(),e.fill(),e.strokeStyle=`#f4f4f0`,e.lineWidth=s*.06,e.beginPath();for(let t=0;t<8;t++){let n=Math.PI/8+t*Math.PI/4;e.lineTo(a+Math.cos(n)*s*.9,o+Math.sin(n)*s*.9)}e.closePath(),e.stroke(),e.fillStyle=`#f4f4f0`,e.font=`bold ${Math.round(s*.72)}px ${Y}`,e.textAlign=`center`,e.textBaseline=`middle`,e.fillText(`STOP`,a,o+s*.04)}function Ee(e,t,n,r,i){e.fillStyle=`#5b6066`,e.fillRect(t,n,r,i),e.fillStyle=`#2b2f33`,e.fillRect(t+r*.1,n+i*.08,r*.8,i*.3),e.fillStyle=`#7fd0e6`,e.fillRect(t+r*.16,n+i*.12,r*.68,i*.2),e.fillStyle=`#0d0d0d`,e.font=`bold ${Math.round(r*.11)}px ${X}`,e.textAlign=`center`,e.textBaseline=`middle`,e.fillText(`PAY HERE`,t+r/2,n+i*.22),e.fillStyle=`#e6e6e6`,e.font=`bold ${Math.round(r*.14)}px ${X}`,e.fillText(`MUNI`,t+r/2,n+i*.5),e.fillText(`METER`,t+r/2,n+i*.62),e.fillStyle=`#1a1a1a`,e.fillRect(t+r*.3,n+i*.74,r*.4,i*.05),e.fillStyle=`#3a8f3a`,e.fillRect(t+r*.62,n+i*.83,r*.14,i*.06)}function De(e,t,n,r,i){e.save(),e.translate(t+1,n+1),e.scale((r-2)/384,(i-2)/64),e.fillStyle=`#902717`,e.fillRect(0,0,384,64),e.fillStyle=`#090e0d`,e.fillRect(0,0,384,20);let a={C:[14,17,16,16,16,17,14],R:[30,17,17,30,20,18,17],E:[31,16,16,30,16,16,31],S:[15,16,16,14,1,1,30],N:[17,25,25,21,19,19,17],T:[31,4,4,4,4,4,4],H:[17,17,17,31,17,17,17],A:[14,17,17,31,17,17,17],L:[16,16,16,16,16,16,31]};for(let t=0;t<14;t++){let n=a[`CRESCENT HALAL`[t]];if(n)for(let r=0;r<7;r++)for(let i=0;i<5;i++){let a=!!(n[r]&1<<4-i);e.fillStyle=t>8?a?`#61cc49`:`#112317`:a?`#f05230`:`#29140e`,e.beginPath(),e.ellipse(3.1750000000000114+(t*6+i)*4.55,3+r*2,1.22,.8,0,0,Math.PI*2),e.fill()}}e.textAlign=`center`,e.textBaseline=`middle`;let o=e=>{let t=Math.sin(e*127.1+31.7)*43758.5453;return t-Math.floor(t)},s=(t,n,r,i,a,o=0)=>{e.fillStyle=a,e.beginPath(),e.ellipse(t,n,r,i,o,0,Math.PI*2),e.fill()},c=[`CORNER CHICKEN  $9`,`CITY GYRO  $8`,`GARDEN FALAFEL  $8`];e.save(),e.translate(0,20),e.scale(1,30/112);for(let t=0;t<3;t++){e.save(),e.translate(t*128,0),e.beginPath(),e.rect(1,0,126,112),e.clip();let n=e.createLinearGradient(0,0,125,112);n.addColorStop(0,t===1?`#24482c`:`#782618`),n.addColorStop(.62,t===2?`#315128`:`#a83b20`),n.addColorStop(1,`#16281c`),e.fillStyle=n,e.fillRect(0,0,128,112);let r=(t,n,r,i,a,o,s=0)=>{e.save(),e.translate(t,n),e.rotate(s),e.scale(r,i);let c=e.createRadialGradient(-.32,-.4,.02,0,0,1);c.addColorStop(0,a),c.addColorStop(.68,a),c.addColorStop(1,o),e.fillStyle=c,e.beginPath(),e.arc(0,0,1,0,Math.PI*2),e.fill(),e.restore()};if(t!==1){s(67,61,64,48,`#19211a`,-.08),r(64,56,63,47,`#ddd8c3`,`#777c70`,-.08),r(64,55,58,42,`#e6cc88`,`#8e6c36`,-.08);for(let e=0;e<460;e++){let n=e+t*1e3,r=o(n)*Math.PI*2,i=Math.sqrt(o(n+731)),a=62+Math.cos(r)*i*53,c=55+Math.sin(r)*i*37;s(a,c+.7,1.8,.78,`#977332`,-.45+o(n+14)),s(a,c,1.8,.63,[`#e9c575`,`#e5ba63`,`#f5d891`,`#c49745`][e%4],-.45+o(n+14))}}else r(64,57,43,54,`#d8b37b`,`#77532f`,.62),r(64,51,33,43,`#6b452a`,`#30291b`,.62);for(let e=0;e<40;e++){let n=e+t*71+1200;r(t===1?51+o(n)*32:85+o(n)*33,17+o(n+71)*61,4+o(n+43)*5,3+o(n+24)*3,[`#a1b95b`,`#709838`,`#86a446`][e%3],`#315329`,o(n+21)*3)}for(let e=0;e<5;e++){let n=t===1?44+e*7:88+o(e+78)*27,i=25+e*12;r(n,i,8,6,`#d9542e`,`#86281b`,-.4),s(n-1,i-1,4,2.5,`#e27b45`,-.4),r(n+3,i+7,6.5,4.4,`#c4cc81`,`#59804b`,.6),s(n+3,i+7,4,2.8,`#d8d29d`,.6)}if(t===2)for(let[e,[t,n,i]]of[[28,40,14],[53,33,13],[68,57,14],[39,67,16],[67,82,12]].entries()){s(t+2,n+3,i+1,i*.82,`#493a1c`),r(t,n,i,i*.86,`#ab853d`,`#59421d`);for(let r=0;r<60;r++){let a=e*80+r+3200,c=o(a)*Math.PI*2,l=Math.sqrt(o(a+36));s(t+Math.cos(c)*l*(i-1),n+Math.sin(c)*l*(i*.78),.4+o(a+29),.65,[`#d0a951`,`#7d5b27`,`#4a4326`,`#b38c3c`][r%4])}}else{for(let e=0;e<(t===1?29:49);e++){let n=t*700+e+2200,i=25+o(n)*(t===1?59:50),a=25+o(n+131)*57,c=t===1?-.7:o(n+47)*3,l=t===1?8+o(n+58)*5:3.3+o(n+58)*4,u=t===1?2.8:3.4+o(n+59)*2;s(i+1,a+2,l+1,u+.5,`#513922`,c),r(i,a,l,u,t===1?`#997347`:`#cf954c`,`#794722`,c),s(i-1.4,a+1,l*.7,.55,`#5d3b23`,c)}if(t===1){r(49,82,38,15,`#e3c68e`,`#927042`,.57);for(let e=0;e<30;e++)s(24+o(e+4111)*47,70+o(e+4193)*22,.5+o(e+4159)*1.7,.65,`#a17b47`,.57)}}e.lineCap=`round`;for(let[t,n,r]of[[`#695738`,3.1,1.5],[`#e6ddba`,2.1,0],[`#bd4e27`,1,5]])e.strokeStyle=t,e.lineWidth=n,e.beginPath(),e.moveTo(30,34+r),e.bezierCurveTo(82,45+r,15,53+r,61,58+r),e.bezierCurveTo(93,67+r,30,70+r,68,80+r),e.stroke();let i=e.createRadialGradient(55,41,22,64,54,79);i.addColorStop(0,`rgba(25,18,8,0)`),i.addColorStop(1,`rgba(25,18,8,0.32)`),e.fillStyle=i,e.fillRect(0,0,128,98);for(let n=0;n<650;n++)e.fillStyle=n%2?`rgba(250,231,187,0.10)`:`rgba(36,25,15,0.09)`,e.fillRect(o(n+t*139+4700)*128,o(n+t*571+5100)*96,.8,1.1);e.fillStyle=`#661e15`,e.fillRect(0,97,128,15),e.fillStyle=`#edcc8e`,e.font=`bold 9px ${X}`,e.fillText(c[t],64,105,120),e.fillStyle=`rgba(227,207,166,0.22)`,e.fillRect(1,4,.8,54),e.fillRect(7,110,51,.6),e.restore()}e.restore(),e.save(),e.beginPath(),e.rect(0,51,384,13),e.clip();let l=e.createLinearGradient(0,51,384,64);l.addColorStop(0,`#23472b`),l.addColorStop(.18,`#8f2b1b`),l.addColorStop(.5,`#b87a3d`),l.addColorStop(.82,`#8f2b1b`),l.addColorStop(1,`#23472b`),e.fillStyle=l,e.fillRect(0,51,384,13),e.font=`bold 17px ${Y}`,e.lineWidth=1.6,e.strokeStyle=`#571b12`,e.save(),e.translate(192,58),e.scale(2.05,1),e.strokeText(`HALAL FOOD`,0,0,130),e.fillStyle=`#f2dba1`,e.fillText(`HALAL FOOD`,0,0,130),e.restore();for(let e of[35,349])s(e,57.5,5.8,4.6,`#dbb772`),s(e+2,56.8,4.6,4,`#354b29`);e.restore(),e.restore()}function Oe(e,t,n,r,i){let a=e.createLinearGradient(t,n,t+r,n+i);a.addColorStop(0,`#1c3f8f`),a.addColorStop(.5,`#1c9bd1`),a.addColorStop(1,`#0d2a5c`),e.fillStyle=a,e.fillRect(t,n,r,i),e.fillStyle=`#ffffff`,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.2)}px ${X}`,e.fillText(`Link`,t+r/2,n+i*.2),e.font=`${Math.round(r*.1)}px ${X}`,e.fillText(`Free Wi-Fi`,t+r/2,n+i*.33),e.font=`bold ${Math.round(r*.28)}px ${X}`,e.fillText(`72°`,t+r/2,n+i*.55),e.font=`${Math.round(r*.09)}px ${X}`,e.fillText(`Midtown`,t+r/2,n+i*.7),e.fillText(`Tap for maps`,t+r/2,n+i*.88)}function ke(e,t,n,r,i){e.fillStyle=`#eeeae8`,e.fillRect(t,n,r,i),e.fillStyle=`#be557f`,e.fillRect(t,n,r,i*.7),e.fillStyle=`#f1ebee`,e.fillRect(t+r*.09,n+i*.09,r*.2,i*.012),e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.185)}px ${X}`,e.fillText(`NEW YORK`,t+r/2,n+i*.27,r*.86),e.fillText(`IS FOR`,t+r/2,n+i*.39,r*.86),e.fillText(`WALKING`,t+r/2,n+i*.51,r*.86),e.fillStyle=`#72304e`,e.font=`${Math.round(r*.065)}px ${X}`,e.fillText(`nyc.gov/dot`,t+r/2,n+i*.85),e.strokeStyle=`rgba(65,47,58,0.22)`,e.lineWidth=Math.max(1,r*.012),e.strokeRect(t+r*.01,n+i*.01,r*.98,i*.98)}var Ae={A:`#0039a6`,C:`#0039a6`,E:`#0039a6`,B:`#ff6319`,D:`#ff6319`,F:`#ff6319`,M:`#ff6319`,N:`#fccc0a`,Q:`#fccc0a`,R:`#fccc0a`,W:`#fccc0a`,1:`#ee352e`,2:`#ee352e`,3:`#ee352e`,4:`#00933c`,5:`#00933c`,6:`#00933c`,7:`#b933ad`,L:`#a7a9ac`,G:`#6cbe45`,J:`#996633`,Z:`#996633`,S:`#808183`,T:`#00add0`};function je(e,t,n,r,i,a){e.fillStyle=`#101414`,e.fillRect(t,n,r,i);let o=i-2,s=(r-2)*U,c=t+1,l=n+1,u=o*.14;e.fillStyle=`#e2e4df`,e.fillRect(c+u,l+2,s-u*2,1.5),e.textAlign=`left`,e.textBaseline=`middle`;let[d,f=`Subway`,p=`Station`]=a.split(`|`),m=[...new Set(d.toUpperCase().split(/\s+/).filter(e=>Ae[e]))].slice(0,10),h=m.length>3,g=o*.075,_=o*(h?.125:.135),v=m.length*_*2+Math.max(0,m.length-1)*g,y=s-u*2-(h||!m.length?0:v+g),b=Math.round(o*(h?.27:.31));for(e.font=`bold ${b}px ${X}`;b>1&&(e.measureText(f).width>y||e.measureText(p).width>s-u*2);)e.font=`bold ${--b}px ${X}`;e.fillText(f,c+u,l+o*(h?.26:.25),y),e.fillText(p,c+u,l+o*.55,s-u*2);let x=l+o*(h?.81:.25),S=h?c+u:c+s-u-v;for(let t of m)e.fillStyle=Ae[t],e.beginPath(),e.arc(S+_,x,_,0,Math.PI*2),e.fill(),e.fillStyle=`NQRW`.includes(t)?`#151515`:`#eeeeea`,e.font=`bold ${Math.round(_*1.5)}px ${X}`,e.textAlign=`center`,e.fillText(t,S+_,x+.5),S+=_*2+g;h||(e.fillStyle=`#e2e4df`,e.textAlign=`left`,e.font=`bold ${Math.round(o*.15)}px ${X}`,e.fillText(`SUBWAY`,c+u,l+o*.87),e.font=`${Math.round(o*.11)}px ${X}`,e.textAlign=`right`,e.fillText(`New York City Transit`,c+s-u,l+o*.87,s*.58));let C=c+(r-2)*W,w=(r-2)*.32984293193717273;e.fillStyle=`#0039a6`,e.fillRect(C,l,w,o*.28),e.fillStyle=`#e2e4df`,e.textAlign=`left`,e.font=`bold ${Math.round(o*.2)}px ${X}`,e.fillText(`MTA`,C+5,l+o*.15,w-10),e.font=`bold ${Math.round(o*.16)}px ${X}`,e.fillText(`New York City`,C+5,l+o*.46,w-10),e.fillText(`Transit`,C+5,l+o*.65,w-10),e.font=`${Math.round(o*.12)}px ${X}`,e.fillText(`Subway Station`,C+5,l+o*.86,w-10)}function Me(e,t,n,r,i){e.save(),e.translate(t,n),e.scale(r/q,i/J),e.fillStyle=`#334536`,e.fillRect(0,0,q,J);let a=[`CITYFOLIO`,`NINTH & CO.`,`METROFORM`,`TABLE / 42`,`BOROUGH INK`,`WEEKENDISH`,`EAST / ELSEWHERE`,`NORTHBLOCK`,`CURBSIDE EDIT`,`AFTERHOURS / NYC`,`FRAME / 21`,`GREENBOROUGH`,`CROSS / TOWN`,`SIDEWALKER`,`KINETIC / NYC`,`THE DAILY BLOCK`],o=[`#d97185`,`#eee2d8`,`#345363`,`#da9d46`,`#f0e8de`,`#c1626b`,`#f1d0d3`,`#d6bea5`,`#ad474d`,`#ede3d2`,`#e84b60`,`#e3b49e`,`#e4daca`,`#bb5762`,`#ece6dc`,`#b54d3c`],s=[`#bf8a6d`,`#e5bba0`,`#93634a`,`#d5a47e`,`#ab775b`,`#ebc5ad`],c=`#eee8d7`,l=517,u=()=>(l=Math.imul(l,1664525)+1013904223>>>0,l/4294967296),d=(t,n,r,i,a=!1)=>{e.save(),e.translate(t,n),e.rotate((i%3-1)*.075),e.scale(r,r);let o=s[i%s.length],c=[`#3c2621`,`#b89b6b`,`#262321`,`#9b6b48`,`#d0b68a`,`#54352a`][i%6],l=i%3!=2,u=e.createLinearGradient(-15,0,17,13);u.addColorStop(0,c),u.addColorStop(.65,c),u.addColorStop(1,`#392a25`),e.fillStyle=u,e.beginPath(),e.ellipse(-1,l?6:-4,14,l?27:16,-.06,0,Math.PI*2),e.fill();let d=e.createLinearGradient(-22,24,25,59);d.addColorStop(0,[`#d0b99e`,`#702e3f`,`#e5d7ca`,`#2c3035`,`#9b3e36`,`#47443e`][i%6]),d.addColorStop(1,i%2?`#3c3334`:`#766557`),e.fillStyle=d,e.beginPath(),e.moveTo(-6,17),e.bezierCurveTo(-13,23,-23,22,-27,36),e.lineTo(-31,76),e.lineTo(29,76),e.lineTo(24,35),e.bezierCurveTo(19,24,11,24,5,18),e.closePath(),e.fill();let f=e.createLinearGradient(-5,10,6,25);f.addColorStop(0,`#8f604a`),f.addColorStop(1,o),e.fillStyle=f,e.beginPath(),e.moveTo(-5,8),e.lineTo(-6,22),e.quadraticCurveTo(1,30,7,22),e.lineTo(5,9),e.fill();let p=e.createLinearGradient(-11,-8,12,7);p.addColorStop(0,`#8b5e48`),p.addColorStop(.27,o),p.addColorStop(.68,o),p.addColorStop(1,`#aa7659`),e.fillStyle=p,e.beginPath(),e.moveTo(-9,-9),e.bezierCurveTo(-6,-16,7,-15,10,-8),a?(e.bezierCurveTo(10,-4,10,-1,14,2),e.lineTo(10,4),e.bezierCurveTo(12,10,7,15,3,16)):e.bezierCurveTo(13,1,8,14,2,16),e.bezierCurveTo(-3,17,-9,10,-10,3),e.bezierCurveTo(-12,-3,-11,-6,-9,-9),e.fill(),e.fillStyle=u,e.beginPath(),e.moveTo(-12,7),e.bezierCurveTo(-18,-15,-3,-22,8,-15),e.bezierCurveTo(14,-11,14,-5,11,0),e.lineTo(7,-10),e.bezierCurveTo(3,-14,-1,-3,-8,-5),e.lineTo(-9,10),e.closePath(),e.fill(),l&&(e.beginPath(),e.moveTo(-10,0),e.bezierCurveTo(-8,15,-7,26,-15,37),e.lineTo(-18,29),e.lineTo(-14,-3),e.fill()),e.strokeStyle=`#654337`,e.lineWidth=.65,e.beginPath(),e.moveTo(3,-2),e.quadraticCurveTo(6,-3,8,-1),a||(e.moveTo(-7,-2),e.quadraticCurveTo(-5,-3,-3,-2)),e.stroke(),e.strokeStyle=`#9a6a54`,e.lineWidth=.7,e.beginPath(),e.moveTo(1,0),e.lineTo(0,5),e.lineTo(3,6),e.stroke(),e.strokeStyle=i%2?`#9b4f50`:`#8d5a4d`,e.lineWidth=1,e.beginPath(),e.moveTo(a?5:-2,10),e.quadraticCurveTo(3,11,a?9:6,9),e.stroke(),e.strokeStyle=`rgba(249,223,197,0.28)`,e.lineWidth=.8,e.beginPath(),e.moveTo(-7,2),e.quadraticCurveTo(-6,6,-4,7),e.stroke(),e.strokeStyle=`rgba(238,221,200,0.48)`,e.lineWidth=.65,e.beginPath(),e.moveTo(-9,23),e.lineTo(-2,39),e.lineTo(9,23),e.stroke(),e.restore()};for(let t=0;t<16;t++){e.save(),e.translate(t%4*64+2,Math.floor(t/4)*96+2),e.beginPath(),e.rect(0,0,60,92),e.clip();let n=e.createLinearGradient(0,0,60,92);n.addColorStop(0,o[t]),n.addColorStop(1,t%3==0?`#a8786c`:`#ded0bf`),e.fillStyle=n,e.fillRect(0,0,60,92);let r=t===2||t===12?2:t===3?3:t===9?4:t%2;if(r===0||r===1)t===8||t===13?(d(18,45,.82,t+2),d(43,49,.93,t+5,t===13)):t===4||t===11?d(t===4?40:21,33,.74,t+1):t===6||t===14?d(t===6?23:34,43,1.18,t+3,!0):t===0||t===10||t===15?d(t===10?25:40,t===15?48:44,t===0?1.52:1.35,t+1):d(t%2?36:24,43+t%3,1,t+2);else if(r===2){for(let t=0;t<7;t++){let n=7+u()*7,r=25+u()*35,i=t*9-4;e.fillStyle=[`#847d6d`,`#414a4b`,`#a7a28c`][t%3],e.fillRect(i,76-r,n,r),e.fillStyle=`#cfb787`;for(let t=0;t<3;t++)for(let n=0;n<8;n++)u()>.33&&e.fillRect(i+2+t*3,79-r+n*5,1,2)}e.fillStyle=`#62635b`,e.fillRect(0,76,60,16),e.strokeStyle=`#aca791`,e.lineWidth=1,e.beginPath(),e.moveTo(0,89),e.lineTo(37,76),e.lineTo(60,87),e.stroke()}else if(r===3){e.fillStyle=`#6b563f`,e.fillRect(0,24,60,68),e.fillStyle=`#e4d9bb`,e.beginPath(),e.ellipse(32,58,26,23,-.35,0,Math.PI*2),e.fill(),e.fillStyle=`#bfa171`,e.beginPath(),e.ellipse(32,58,20,17,-.35,0,Math.PI*2),e.fill();for(let t=0;t<55;t++){let n=u()*Math.PI*2,r=Math.sqrt(u());e.fillStyle=[`#748045`,`#a14b31`,`#d2ac63`,`#d5c9a2`][t%4],e.beginPath(),e.ellipse(32+Math.cos(n)*r*18,58+Math.sin(n)*r*15,2+u()*3,1.4+u()*2,n,0,Math.PI*2),e.fill()}}else{for(let t=0;t<4;t++){e.fillStyle=[`#899b96`,`#607b70`,`#465f50`,`#29453e`][t],e.beginPath(),e.moveTo(0,91);for(let n=0;n<7;n++)e.lineTo(n*10,35+t*10+u()*15);e.lineTo(60,92),e.closePath(),e.fill()}e.fillStyle=`#79928e`,e.beginPath(),e.moveTo(31,64),e.lineTo(43,64),e.lineTo(56,92),e.lineTo(16,92),e.closePath(),e.fill()}for(let t=0;t<200;t++)e.fillStyle=t%2?`rgba(240,230,209,0.07)`:`rgba(18,23,23,0.08)`,e.fillRect(u()*60,18+u()*74,.7,.7);let i=[1,4,6,7,9,11,12,14].includes(t),s=[1,4,6,11,14].includes(t)?`#b52f4c`:`#25292a`;(t===8||t===13)&&(e.fillStyle=`#f2e4d9`,e.fillRect(0,0,60,18)),e.fillStyle=i||t===8||t===13?s:c,e.textAlign=`center`,e.textBaseline=`top`,e.font=`${t%3==0?`italic `:`bold `}${t%4==0?10:8}px ${t%3==0?`Georgia, serif`:X}`,e.fillText(a[t],30,3,56),e.font=`2.5px ${X}`,e.fillText(`NEW YORK  /  ISSUE ${24+t}  /  $6.00`,30,15,54),e.textAlign=t%2?`right`:`left`;let l=t%2?57:3;e.fillStyle=i?`#403534`:c;let f=t===4||t===0||t===15?3:57;e.textAlign=f===3?`left`:`right`,e.font=`bold ${t%3==0?9:7}px ${X}`,e.fillText([`35`,`NOW`,`STYLE`,`12`][t%4],f,30+t%3*3,22),e.font=`bold 3.3px ${X}`;for(let t=0;t<3;t++)e.fillText([`FRESH IDEAS`,`CITY PEOPLE`,`NEW SEASON`][t],f,42+t*4,22);(t===1||t===10||t===13)&&(e.fillStyle=t===1?`#b72f4d`:`#ecdfce`,e.fillRect(1,71,58,11),e.fillStyle=t===1?c:`#9c3043`),e.textAlign=t%2?`right`:`left`,e.font=`bold 4px ${X}`,e.fillText([`THE CITY`,`NEW IDEAS`,`WEEKEND`,`AT HOME`][t%4],l,68,28),e.font=`bold ${t%2?8:6}px ${X}`,e.fillText([`24`,`FRESH`,`LOCAL`,`ESCAPE`][t%4],l,74,30),e.font=`2.4px ${X}`,e.fillText(`PEOPLE  PLACES  STORIES`,l,86,34),e.fillStyle=`#dfdcd1`,e.fillRect(t%2?3:48,84,9,6),e.fillStyle=`#393b35`;for(let n=0;n<7;n++)e.fillRect((t%2?4:49)+n,85,n%3==0?.6:.3,3);e.fillStyle=`rgba(30,28,24,0.22)`,e.fillRect(0,0,1.2,92),e.restore()}let f=[`#ae3029`,`#d6ab2d`,`#367291`,`#548444`,`#92557d`,`#d38535`,`#923c2c`,`#c8c0a3`];for(let t=0;t<8;t++){e.save(),e.translate(t%4*64+2,400+Math.floor(t/4)*80+2);let n=e.createLinearGradient(0,0,60,0);n.addColorStop(0,`#716951`),n.addColorStop(.13,f[t]),n.addColorStop(.65,f[t]),n.addColorStop(1,`#514638`),e.fillStyle=n,e.fillRect(0,0,60,76),e.fillStyle=`#d1c4a1`,e.fillRect(0,0,60,4),e.fillRect(0,72,60,4),e.fillStyle=`rgba(253,238,197,0.17)`,e.fillRect(5,5,2,65),e.fillRect(53,5,1,64),e.textBaseline=`middle`,e.textAlign=`center`,e.fillStyle=`#f8ebc4`,e.font=`italic bold 13px ${X}`,e.fillText([`CRUNCH`,`CORN`,`MINT`,`SOURS`,`CHEWS`,`NUTS`,`COCOA`,`OAT`][t],30,23,53),e.font=`bold 5px ${X}`,e.fillText([`SEA SALT`,`GOLDEN`,`COOL`,`FRUIT`,`BERRY`,`ROASTED`,`DARK`,`HONEY`][t],30,34,50);for(let n=0;n<9;n++)e.fillStyle=t===3||t===4?[`#d96443`,`#aaba58`,`#d3a66d`][n%3]:[`#debd75`,`#c59954`,`#ebcd8a`][n%3],e.beginPath(),e.ellipse(13+u()*35,45+u()*19,4+u()*4,3+u()*3,u(),0,Math.PI*2),e.fill();e.fillStyle=`rgba(35,25,21,0.25)`;for(let t=0;t<20;t++)e.fillRect(t*3,0,.6,4),e.fillRect(t*3,72,.6,4);e.restore()}for(let t=0;t<2;t++){e.save(),e.translate(2+t*128,578),e.fillStyle=t?`#dcd8ca`:`#d8d2bf`,e.fillRect(0,0,124,92),e.textAlign=`center`,e.textBaseline=`top`,e.fillStyle=`#353a34`,e.font=`bold 11px Georgia, serif`,e.fillText(t?`Borough Dispatch`:`The Daily Block`,62,3,116),e.fillRect(4,17,116,1),e.font=`bold 6px ${X}`,e.fillText(t?`NEIGHBOURHOOD NOTES`:`A NEW CHAPTER FOR THE CITY`,62,21,116);let n=t?5:43;e.fillStyle=`#788582`,e.fillRect(n,34,37,27),e.fillStyle=`#515e5b`;for(let t=0;t<7;t++)e.fillRect(n+t*5,40+t%3*5,4,21-t%3*5);e.fillStyle=`#77766a`;for(let n=0;n<5;n++)for(let r=0;r<24;r++)(t?n<2:n===2||n===3)&&r<13||e.fillRect(5+n*23,34+r*2.15,18+u()*3,.55);e.fillStyle=`#beb9a8`,e.fillRect(0,88,124,2),e.restore()}e.save(),e.translate(2,734),e.fillStyle=`#d2ccba`,e.fillRect(0,0,252,28);for(let t=0;t<9;t++)e.strokeStyle=t%3==0?`#9e9685`:`#bbb3a0`,e.lineWidth=t%3==0?.9:.6,e.beginPath(),e.moveTo(0,2+t*3),e.bezierCurveTo(65,1+t*3,173,3+t*3,252,2+t*3),e.stroke();e.fillStyle=`rgba(118,70,59,0.35)`,e.fillRect(0,2,252,1.1),e.restore();for(let t=0;t<2;t++)e.save(),e.translate(130+t*64,674),e.fillStyle=t?`#dce6da`:`#225946`,e.fillRect(0,0,60,28),e.fillStyle=t?`#457f96`:`#c8d8b2`,e.fillRect(0,1,60,4),e.fillRect(0,23,60,4),e.textAlign=`center`,e.textBaseline=`middle`,e.fillStyle=t?`#244f68`:`#f2eed2`,e.font=`bold 10px ${X}`,e.fillText(t?`WATER`:`ICED TEA`,30,12,55),e.font=`4px ${X}`,e.fillText(t?`SPRING  /  STILL`:`LEMON  /  BREWED`,30,20,52),e.restore();for(let t=0;t<8;t++){e.save(),e.translate(t%2*128+2,882+Math.floor(t/2)*32);let n=e.createLinearGradient(0,0,0,28);n.addColorStop(0,`#e4d8ae`),n.addColorStop(.18,f[t]),n.addColorStop(.62,f[t]),n.addColorStop(1,`#655746`),e.fillStyle=n,e.fillRect(0,0,124,28),e.fillStyle=`#c7bba2`,e.fillRect(0,0,5,28),e.fillRect(119,0,5,28),e.fillStyle=`#f7ebcf`,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`italic bold 15px ${X}`,e.fillText([`CHOC / CRISP`,`CITRUS`,`COOL MINT`,`FRUIT CHEWS`,`BERRY MIX`,`NUT CRUNCH`,`DARK / COCOA`,`HONEY OAT`][t],62,11,108),e.font=`bold 5px ${X}`,e.fillText(`POCKET SIZE  •  FRESH FLAVOUR`,62,22,102),e.fillStyle=`rgba(45,36,28,0.35)`;for(let t=0;t<7;t++)e.fillRect(0,t*4,5,1),e.fillRect(119,t*4,5,1);e.restore()}e.fillStyle=`#365d42`,e.fillRect(0,704,256,24),e.textAlign=`center`,e.textBaseline=`middle`,e.fillStyle=`#eee6cb`,e.font=`bold 12px ${X}`,e.fillText(`NEWS  •  MAGAZINES  •  SNACKS`,128,716,242),e.fillStyle=`#e6c84a`,e.fillRect(0,768,256,96),e.fillStyle=`#243f34`,e.fillRect(3,771,250,13),e.fillStyle=`#f0e9ce`,e.font=`bold 8px ${X}`,e.fillText(`PLAY HERE`,128,778),e.fillStyle=`#243f34`,e.font=`bold 35px ${X}`,e.fillText(`LOTTERY`,128,810,235),e.font=`bold 11px ${X}`,e.fillText(`DAILY GAMES  •  SCRATCH CARDS`,128,847,229),e.fillRect(12,833,232,1),e.restore()}function Ne(e,t,n,r,i){e.save(),e.translate(t+r*.5,n+i*.57),e.font=`bold ${i*.69}px ${X}`;let a=e.measureText(`citi`).width;e.font=`${i*.69}px ${X}`;let o=a+e.measureText(`bike`).width+i*.04;e.scale(Math.min(1,r*.91/o),1),e.textAlign=`left`,e.textBaseline=`middle`,e.fillStyle=`#f0f2ed`,e.font=`bold ${i*.69}px ${X}`,e.fillText(`citi`,-o/2,0),e.font=`${i*.69}px ${X}`,e.fillText(`bike`,-o/2+a+i*.04,0),e.strokeStyle=`#cf4549`,e.lineWidth=Math.max(1,i*.045),e.beginPath(),e.moveTo(-o/2+a*.26,-i*.35),e.quadraticCurveTo(-o/2+a*.58,-i*.65,-o/2+a*.9,-i*.35),e.stroke(),e.restore()}function Pe(){let e=document.createElement(`canvas`);e.width=512,e.height=256;let t=e.getContext(`2d`);t.fillStyle=`#1f3f77`,t.fillRect(0,0,512,128),Ne(t,18,16,476,98),t.save(),t.translate(0,128),t.scale(4,.25),t.translate(64,256),t.rotate(Math.PI/2),Ne(t,-230,-66,460,132),t.restore();let n=new k(e);return n.name=`citibike-only-markings`,n.colorSpace=h,n.anisotropy=4,n.wrapS=n.wrapT=r,n}function Fe(e,t,n,r,i){e.fillStyle=`#d0d2cd`,e.fillRect(t,n,r,i),e.fillStyle=`#1f3f77`,e.fillRect(t,n,r,i*.14),Ne(e,t+r*.1,n+i*.018,r*.8,i*.095),e.fillStyle=`#242d32`,e.fillRect(t+r*.1,n+i*.18,r*.8,i*.245),e.fillStyle=`#9caeaf`,e.fillRect(t+r*.16,n+i*.2,r*.68,i*.19),e.fillStyle=`#30424a`,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.09)}px ${X}`,e.fillText(`Get a bike`,t+r/2,n+i*.25,r*.62),e.fillStyle=`#d1dbd5`,e.fillRect(t+r*.23,n+i*.3,r*.54,i*.055),e.fillStyle=`#2a3438`,e.font=`${Math.round(r*.075)}px ${X}`,e.fillText(`START`,t+r/2,n+i*.327);for(let a=0;a<3;a++)for(let o=0;o<3;o++)e.fillStyle=`#5e6666`,e.fillRect(t+r*(.14+o*.125),n+i*(.455+a*.031),r*.095,i*.022);e.fillStyle=`#27373f`,e.font=`${Math.round(r*.075)}px ${X}`,e.fillText(`Ride. Return. Repeat.`,t+r/2,n+i*.605,r*.9),e.fillStyle=`#7c8582`,e.fillRect(t+r*.05,n+i*.655,r*.9,1);let a=t+r*.04,o=n+i*.69,s=r*.92,c=i*.29;e.save(),e.beginPath(),e.rect(a,o,s,c),e.clip(),e.fillStyle=`#dbded5`,e.fillRect(a,o,s,c),e.fillStyle=`#96b9c5`,e.fillRect(a+s*.77,o,s*.25,c),e.fillStyle=`#a8b394`,e.fillRect(a+s*.14,o+c*.08,s*.18,c*.33),e.strokeStyle=`#f3f1e6`,e.lineWidth=Math.max(1.3,s*.035);for(let t=0;t<8;t++)e.beginPath(),e.moveTo(a-s*.15,o+c*t/7),e.lineTo(a+s*.8,o+c*(t/7-.12)),e.stroke();for(let t=0;t<5;t++)e.beginPath(),e.moveTo(a+s*t/6,o),e.lineTo(a+s*(t/6+.16),o+c),e.stroke();e.fillStyle=`#1f3f77`;for(let[t,n]of[[.2,.51],[.49,.29],[.55,.76],[.68,.47]])e.beginPath(),e.arc(a+s*t,o+c*n,Math.max(1.5,s*.025),0,Math.PI*2),e.fill();e.restore()}function Ie(e,t,n,r,i,a){let o=G,s=`#0039a6`,c=`#f1f2ec`;e.clearRect(t,n,r,i);let l=n+i*o.headHeight/2,u=r/2;e.save(),e.beginPath(),e.arc(t+r/2,l,u,0,Math.PI*2),e.clip(),e.fillStyle=s,e.fillRect(t,n,r,i*o.headHeight),e.fillStyle=`#c62e3a`,e.fillRect(t,n+i*.393,r,i*.107),e.fillStyle=c,e.textAlign=`center`,e.textBaseline=`middle`,e.font=`bold ${Math.round(r*.12)}px ${X}`,e.fillText(`MTA`,t+r/2,n+i*.1);let d=t+r*.25,f=n+i*.17,p=r*.5,m=i*.16;e.beginPath(),e.roundRect(d,f,p,m,r*.035),e.fill(),e.fillRect(d+p*.1,f+m,p*.17,i*.022),e.fillRect(d+p*.73,f+m,p*.17,i*.022),e.fillStyle=s,e.fillRect(d+p*.09,f+m*.13,p*.82,m*.43);for(let t of[.14,.76])e.fillRect(d+p*t,f+m*.75,p*.1,m*.1);e.fillStyle=c,e.font=`bold ${Math.round(r*.085)}px ${X}`,e.fillText(`BUS STOP`,t+r/2,n+i*.429,r*.66),e.strokeStyle=`#d8dedc`,e.lineWidth=r*.018,e.beginPath(),e.arc(t+r/2,l,u-e.lineWidth/2,0,Math.PI*2),e.stroke(),e.restore();let h=a.length?a.slice(0,4):[`M42`],g=i*o.routeGap,_=Math.min(i*o.routeMaxHeight,(i*(o.routeBottom-o.routeTop)-g*(h.length-1))/h.length),v=t+r*o.routeInset,y=r*(1-2*o.routeInset);e.textAlign=`center`,e.textBaseline=`middle`;for(let a=0;a<h.length;a++){let l=n+i*o.routeTop+a*(_+g);e.fillStyle=/^(?:X|BxM|BM|QM|SIM)\d/i.test(h[a])?`#007c59`:s,e.fillRect(v-.5,l,y+1,_),e.fillStyle=c;let u=Math.min(r*.36,_*.69);for(e.font=`bold ${u}px ${X}`;u>1&&e.measureText(h[a]).width>y*.88;)u-=.5,e.font=`bold ${u}px ${X}`;e.fillText(h[a],t+r/2,l+_*.51)}}var Z={uLamp:{value:0},uLampWarm:{value:new O(1,.62,.28)},uLampWhite:{value:new O(1,.88,.72)},uWet:{value:0},uPedFrames:{value:32}},Le=`
attribute vec4 aMat;
attribute vec2 aEmit;
#ifdef USE_INSTANCING
attribute vec4 aData;
#else
const vec4 aData = vec4(0.0, 0.0, 0.0, 1.0);
#endif
varying vec4 vPropMat;
varying vec2 vPropEmit;
varying vec4 vPropData;
varying vec2 vPropUv;
#ifdef PROP_BIKE_RACK
varying vec3 vBikeRackLocal;
#endif
#ifdef PROP_SUBWAY_GLOBE
varying vec2 vSubwayGlobe;
#endif
#ifdef PROP_ATLAS
varying vec3 vSubwayLocal;
#endif
uniform float uPedFrames;
`,Re=`
vPropMat = aMat;
vPropEmit = aEmit;
vPropData = aData;
vPropUv = uv;
#ifdef PROP_BIKE_RACK
vBikeRackLocal = position;
#endif
#ifdef PROP_SUBWAY_GLOBE
  // Exact existing buildGlobeLamp lens signature, not all nightGlow parts (sheds/shelters).
  // Only the daylight diffuse surface changes. Never rewrite its color/emission attributes.
  vSubwayGlobe = vec2(0.0, position.y);
  #ifdef USE_COLOR
    if (abs(aEmit.x - 2.0) < 0.001 && abs(aEmit.y - 1.6) < 0.001 &&
        abs(aMat.x - 0.35) < 0.001 && aMat.y < 0.001 && aMat.z < 0.5 &&
        distance(color, vec3(${new O(3119690).toArray().map(e=>e.toFixed(8)).join(`, `)})) < 0.00001)
      vSubwayGlobe.x = 1.0;
  #endif
#endif
#ifdef PROP_ATLAS
vSubwayLocal = position;
#endif
#ifdef USE_MAP
  #ifdef PROP_ATLAS
    if (aMat.z > 0.5) vMapUv = aData.xy + vMapUv * aData.zw;
  #endif
  if (aEmit.x > 6.5 && aEmit.x < 7.5) {
    // pedestrian face: frames laid out horizontally in the map
    vMapUv = vec2((vMapUv.x + floor(aData.z + 0.5)) / uPedFrames, vMapUv.y);
  }
#endif
`,ze=`
varying vec4 vPropMat;
varying vec2 vPropEmit;
varying vec4 vPropData;
varying vec2 vPropUv;
uniform float uLamp;
uniform vec3 uLampWarm;
uniform vec3 uLampWhite;
uniform float uWet;
#ifdef PROP_BIKE_RACK
varying vec3 vBikeRackLocal;
float bikeRackHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float bikeRackWear(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(bikeRackHash(vec3(cell, 7.0)), bikeRackHash(vec3(cell + vec2(1.0, 0.0), 7.0)), f.x),
             mix(bikeRackHash(vec3(cell + vec2(0.0, 1.0), 7.0)), bikeRackHash(vec3(cell + vec2(1.0), 7.0)), f.x), f.y);
}
#endif
#ifdef PROP_SUBWAY_GLOBE
varying vec2 vSubwayGlobe;
#endif
#ifdef PROP_ATLAS
varying vec3 vSubwayLocal;
float subwayHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float subwayWear(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(subwayHash(i), subwayHash(i + vec2(1.0, 0.0)), f.x),
             mix(subwayHash(i + vec2(0.0, 1.0)), subwayHash(i + vec2(1.0)), f.x), f.y);
}
#endif
#ifdef PROP_BASKET
uniform sampler2D uBasketMap;
#endif
#ifdef PROP_CITI_MARK
uniform sampler2D uCitiMark;
#endif
`,Be=`
uniform float uTrashEvening;
bool trashVisible(vec4 mat, vec4 data) {
  float count = mix(data.y, data.x, step(0.5, uTrashEvening));
  if (count < 0.5) return false;
  // Recycling replaces one black slot in some 4..8-bag piles, keeping the
  // requested TOTAL at 3..8 and at least three black bags in every evening pile.
  bool recycling = uTrashEvening > 0.5 && data.x > 3.5 && data.z < 0.65;
  if (mat.w < 7.5) return mat.w < count - (recycling ? 1.0 : 0.0) - 0.5;
  if (mat.w < 8.5) return recycling; // recycling film AND its contents
  return true; // flattened cardboard stays with any remaining bags
}
`,Ve=`
if (aMat.z < -13.5 && aMat.z > -17.5 && !trashVisible(aMat, aData)) {
  transformed = vec3(0.0); // no daytime fragments/depth for a hidden bag
}
`,He=`
bool propTrash = vPropMat.z < -13.5 && vPropMat.z > -17.5;
float trashRelief = 0.0;
float trashRoughness = vPropMat.x;
float trashFold = 0.0;
if (propTrash) {
  if (!trashVisible(vPropMat, vPropData)) discard;
  vec2 p = vPropUv;
  float seed = vPropData.z * 6.2831853 + vPropMat.w * 1.71;
  if (vPropMat.z > -15.5) {
    // Thin irregular tension folds climb toward the pinched neck, crossing
    // broad compressed creases in the belly. Geometry supplies the major folds.
    float a = p.x * 6.2831853;
    float gather = a * 17.0 + 1.7 * sin(p.y * 8.0 + a * 3.0 + seed);
    float crossFold = p.y * 56.0 + 5.0 * sin(a * 3.0 + seed) + 2.0 * sin(a * 7.0 - p.y * 8.0);
    float aa = 1.0 - smoothstep(1.0, 3.0, max(fwidth(gather), fwidth(crossFold)));
    float ridge = pow(0.5 + 0.5 * sin(gather), 10.0);
    float crease = pow(0.5 + 0.5 * sin(crossFold), 12.0) * (1.0 - smoothstep(0.65, 0.96, p.y));
    trashFold = max(ridge * 0.7, crease) * aa;
    trashRelief = (ridge * 0.0022 + crease * 0.0016) * aa;
    trashRoughness = clamp(vPropMat.x + 0.10 * trashFold + 0.035 * sin(a * 5.0 + p.y * 13.0 + seed), 0.20, 0.44);
    diffuseColor.rgb *= (0.91 + 0.09 * sin(seed + p.y * 9.0 + a * 2.0)) * (1.0 - 0.20 * trashFold);
  } else if (vPropMat.z > -16.5) {
    float crease = exp(-abs(p.x - 0.49 - 0.025 * sin(p.y * 8.0)) * 140.0);
    float flutePhase = p.x * 460.0;
    float flutes = sin(flutePhase) * (1.0 - smoothstep(1.0, 3.0, fwidth(flutePhase)));
    float edge = 1.0 - smoothstep(0.01, 0.04, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
    diffuseColor.rgb *= 0.93 + 0.045 * sin(p.x * 91.0 + sin(p.y * 24.0)) - 0.24 * crease + edge * flutes * 0.16;
    // Broken tape remnant, brown kraft faces and corrugated torn edge, no logo.
    float tape = (1.0 - smoothstep(0.045, 0.052, abs(p.x - 0.72))) * step(0.18, p.y) * step(p.y, 0.81);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.21, 0.14, 0.072), tape * 0.48);
    trashRoughness = mix(0.97, 0.58, tape);
    trashRelief = -0.0007 * crease + 0.00025 * flutes;
  }
}
`,Ue=`
if (propTrash) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det)
    * (dFdx(trashRelief) * rx + dFdy(trashRelief) * ry));
  if (vPropMat.z < -14.5 && vPropMat.z > -15.5) {
    // Ordered screen-door transmission keeps true interior geometry visible in
    // the opaque instanced draw (no per-pile transparency sorting or new material).
    // Film is clearer face-on, milkier at overlapping creases and grazing edges.
    float grazing = pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 3.0);
    float coverage = clamp(0.22 + 0.53 * grazing + 0.25 * trashFold, 0.22, 0.83);
    vec2 cell = mod(floor(gl_FragCoord.xy), 4.0);
    vec2 low = mod(cell, 2.0), high = floor(cell / 2.0);
    float threshold = (4.0 * (2.0 * low.x + 3.0 * low.y - 4.0 * low.x * low.y)
      + 2.0 * high.x + 3.0 * high.y - 4.0 * high.x * high.y + 0.5) / 16.0;
    if (coverage < threshold) discard;
  }
}
`,We=`
if (vPropMat.z < -3.5 && vPropMat.z > -4.5) sampledDiffuseColor = vec4(1.0);
#ifdef PROP_CITI_MARK
  if (vPropMat.z < -4.5 && vPropMat.z > -5.5) {
    sampledDiffuseColor = texture2D(uCitiMark, vPropUv);
    // Only Citi decal triangles: expose the real grey casting around the white/red print.
    if (sampledDiffuseColor.a < 0.4) discard;
    sampledDiffuseColor.a = 1.0;
  }
#endif
`,Ge=`
#ifdef PROP_CITI_MARK
  if (vPropMat.z < -3.5 && vPropMat.z > -4.5 && vPropMat.w > 0.5 && vPropMat.w < 1.5) {
    vec2 citiP = vPropUv;
    float citiMottle = 0.5 + 0.28 * sin(citiP.x * 18.0 + 1.6 * sin(citiP.y * 7.0))
      * sin(citiP.y * 10.0 + citiP.x * 5.0);
    float citiToe = 1.0 - smoothstep(0.06, 0.34, citiP.y);
    float citiStreakPhase = citiP.x * 78.0 + 0.7 * sin(citiP.y * 6.0);
    float citiStreak = smoothstep(0.63, 0.96, 0.5 + 0.5 * sin(citiStreakPhase))
      * (1.0 - smoothstep(0.14, 0.70, citiP.y))
      * (1.0 - smoothstep(0.7, 2.2, fwidth(citiStreakPhase)));
    // Quiet, irregular grey discoloration and two rubbed marks at shoe height, not rusty stripes.
    float citiRubA = 1.0 - smoothstep(0.35, 1.0, length((citiP - vec2(-0.19, 0.12)) / vec2(0.095, 0.019)));
    float citiRubB = 1.0 - smoothstep(0.25, 1.0, length((citiP - vec2(0.06, 0.075)) / vec2(0.065, 0.013)));
    float citiRub = max(citiRubA, citiRubB) * (0.65 + 0.35 * sin(citiP.x * 91.0));
    diffuseColor.rgb *= 0.99 - 0.03 * citiMottle - 0.25 * citiToe * (0.7 + 0.3 * citiMottle) - 0.055 * citiStreak;
    diffuseColor.rgb += vec3(0.025, 0.024, 0.021) * citiRub;
  }
#endif
`,Ke=`
#ifdef PROP_BIKE_RACK
bool propBikeRack = vPropMat.z < -7.5 && vPropMat.z > -8.5;
float bikeRackRoughness = vPropMat.x;
float bikeRackMetalness = vPropMat.y;
float bikeRackOcclusion = 1.0;
if (propBikeRack) {
  float role = vPropMat.w;
  if (role > 3.5) {
    // Follow the existing sixteen-sided plate with a continuous 3 mm contact seam.
    // Subpixel coverage changes its shade, never turns it into a dotted halo.
    // The dark plate underside below carries most of the grounding at distance.
    vec2 footP = (vPropUv - 0.5) * 0.19;
    float angle = atan(footP.y, footP.x);
    float edge = length(footP) * cos(mod(angle, 0.3926990817) - 0.1963495408) - 0.0637510432;
    float width = 0.003;
    float coverage = min(1.0, width / max(fwidth(edge), 0.0001));
    if (edge < -0.003 || edge > width) discard;
    diffuseColor.rgb *= mix(1.35, 0.72, coverage * (1.0 - smoothstep(0.0, width, edge)));
    bikeRackOcclusion = 0.62;
  } else if (role > 2.5) {
    vec2 spokeP = (vPropUv - 0.5) * 0.624;
    float radius = length(spokeP);
    if (radius > 0.308 || radius < 0.018) discard;
    float angle = atan(spokeP.y, spokeP.x);
    // Two sets of 16 straight, tangentially laced spokes, attached to a 40 mm hub.
    // Distance to the nearest chord, not a radial wedge that thickens toward the rim.
    float pitch = 0.3926990817;
    float offset = 0.017;
    float skew = asin(min(0.999, offset / radius));
    float a = floor((angle - skew) / pitch + 0.5) * pitch;
    float b = floor((angle + skew - pitch * 0.5) / pitch + 0.5) * pitch + pitch * 0.5;
    float wire = min(abs(sin(angle - a) * radius - offset), abs(sin(angle - b) * radius + offset));
    float aa = max(fwidth(wire), 0.00015);
    float coverage = 1.0 - smoothstep(0.00085 - aa * 0.5, 0.00085 + aa * 0.5, wire);
    if (coverage < 0.48) discard;
    diffuseColor.rgb *= 0.78 + 0.22 * coverage;
  } else {
    vec3 p = vBikeRackLocal;
    float lowDirt = 1.0 - smoothstep(0.025, 0.22, p.y);
    if (role < 0.5) {
      // Smooth local-metre oxidation, shared by hoop and feet. Neutral zinc and
      // broad roughness variation separate it from the bicycle's green enamel.
      // Keep the fine spangle weaker still on the feet: no pale hardware specks.
      vec3 cells = p * 145.0;
      float resolved = 1.0 - smoothstep(0.55, 1.6, length(fwidth(cells)));
      float spangle = (bikeRackHash(floor(cells)) - 0.5) * resolved;
      float oxidation = bikeRackWear(vec2(p.x * 9.0 + p.z * 11.0, p.y * 7.0 + p.z * 5.0));
      float smudge = bikeRackWear(vec2(p.x * 43.0 + p.z * 61.0, p.y * 37.0 - p.z * 29.0) + vec2(3.7, 8.4));
      // Irregular dirt height and strength, not a level painted-on splash stripe.
      float grime = (1.0 - smoothstep(0.018, 0.16 + oxidation * 0.10, p.y))
        * (0.68 + smudge * 0.32);
      float plate = 1.0 - smoothstep(0.012, 0.030, p.y);
      float rub = (1.0 - smoothstep(0.05, 0.16, abs(p.y - 0.57)))
        * smoothstep(0.22, 0.285, abs(p.x)) * (0.5 + 0.5 * sin(p.y * 73.0 + p.z * 20.0));
      diffuseColor.rgb *= 0.99 + (oxidation - 0.5) * 0.10 + (smudge - 0.5) * 0.025
        + spangle * 0.018 * (1.0 - plate) - grime * 0.28 - plate * 0.065;
      diffuseColor.rgb += vec3(0.012) * rub;
      // Matching mounts are unresolved in the reference. Keep existing fasteners,
      // but omit bolt-centred rust/occlusion spots that overstate their detail.
      // Rough zinc still catches a broad sky/sun highlight; oxidized feet and
      // welds stay dull. Modulate the BRDF, not painted-on white highlight bands.
      bikeRackRoughness = clamp(vPropMat.x + 0.015 + (oxidation - 0.5) * 0.18
        + (smudge - 0.5) * 0.04 + grime * 0.17 + plate * 0.10 - rub * 0.065, 0.34, 0.78);
      bikeRackMetalness = clamp(vPropMat.y - grime * 0.14 - oxidation * 0.025 + rub * 0.045, 0.62, 0.88);
      float footRadius = length(vec2(abs(p.x) - 0.30, p.z));
      float weldContact = (1.0 - smoothstep(0.030, 0.045, footRadius)) * (1.0 - smoothstep(0.018, 0.033, p.y));
      float soleContact = 1.0 - smoothstep(0.002, 0.014, p.y);
      // Tight continuous dirt/occlusion at the plate's rim and weld, not bolt dots.
      // Including the top perimeter makes the 12 mm plate read as seated steel.
      float rimContact = smoothstep(0.052, 0.064, footRadius)
        * (1.0 - smoothstep(0.012, 0.018, p.y));
      bikeRackOcclusion = 1.0 - max(0.46 * weldContact, max(0.66 * soleContact, 0.40 * rimContact));
      diffuseColor.rgb *= 1.0 - max(0.42 * soleContact, 0.25 * rimContact);
    } else if (role < 1.5) {
      // Sparse frame chips concentrated around the lock and lower chainstay.
      float resolved = 1.0 - smoothstep(0.7, 1.8, length(fwidth(p * 160.0)));
      float contact = max(1.0 - smoothstep(0.035, 0.11, abs(p.y - 0.57)), lowDirt);
      float chip = smoothstep(0.91, 0.99, bikeRackHash(floor(p * 160.0))) * contact * resolved;
      diffuseColor.rgb *= 1.0 - lowDirt * 0.16;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.25, 0.23), chip * 0.7);
      bikeRackRoughness += chip * 0.14;
      bikeRackMetalness = chip * 0.45;
    } else {
      diffuseColor.rgb *= 1.0 - lowDirt * 0.12;
    }
  }
}
#endif
`,qe=`
#ifdef PROP_BASKET
  if (vPropMat.z > 1.5 && vPropMat.z < 4.5) {
    vec2 basketUv = clamp(vMapUv, vec2(0.004), vec2(0.996));
    if (vPropMat.z < 2.5) {
      basketUv = vec2(basketUv.x, 0.5 + basketUv.y * 0.5);
    } else if (vPropMat.z < 3.5) {
      basketUv = vec2((172.0 + basketUv.x * 340.0) / 512.0, basketUv.y * 0.5);
    } else {
      basketUv = vec2(basketUv.x * 172.0 / 512.0, basketUv.y * 0.5);
    }
    sampledDiffuseColor = texture2D(uBasketMap, basketUv);
    // Cutouts belong only to the wire; frame and notice must never become perforated at a mip seam.
    if (vPropMat.z > 2.5) sampledDiffuseColor.a = 1.0;
  } else
#endif
  if (vPropMat.w < 0.5) sampledDiffuseColor = vec4(1.0);
diffuseColor *= sampledDiffuseColor;
`,Je=`
bool propBenchSlat = vPropMat.z < -0.5 && vPropMat.z > -1.5;
float benchWear = 0.0;
float benchHead = 0.0;
float benchRelief = 0.0;
if (propBenchSlat) {
  float board = floor(mod(vPropUv.y + 0.00001, 20.0) * 0.5);
  float across = clamp(mod(vPropUv.y + 0.00001, 2.0), 0.0, 1.0);
  float exposed = 1.0 - step(19.5, vPropUv.y);
  float phase = board * 2.399;
  // Broad growth bands survive the close view; fine grain fades before it aliases.
  // Longitudinal bends differ by board, avoiding identical straight painted stripes.
  float growthPhase = 6.283185 * (across * 3.4 + 0.19 * sin(vPropUv.x * 3.0 + phase)
    + 0.055 * sin(vPropUv.x * 8.0 + phase));
  float growth = sin(growthPhase) * (1.0 - smoothstep(0.8, 3.0, fwidth(growthPhase)));
  float grainPhase = growthPhase * 4.6 + 0.45 * sin(vPropUv.x * 2.0 + phase);
  float grainFade = 1.0 - smoothstep(0.8, 3.0, fwidth(grainPhase));
  float grain = sin(grainPhase) * grainFade;
  float pores = smoothstep(0.64, 0.96, sin(grainPhase + 0.65 * sin(vPropUv.x * 17.0 + phase))) * grainFade;
  float edge = 1.0 - smoothstep(0.015, 0.085, min(across, 1.0 - across));
  // Uneven strips of worn varnish follow the fibres, with long intact darker areas.
  // Keep the original board colours; the lighter grey-brown is exposed wood, not lighting.
  float rubbed = smoothstep(0.30, 0.83, 0.5 + 0.28 * sin(vPropUv.x * 4.0 + phase)
    * sin(across * 3.0 + phase) + 0.22 * sin(across * 11.0 + phase + 0.3 * growth));
  float endWeather = smoothstep(0.69, 0.90, abs(vPropUv.x));
  benchWear = 0.30 * edge * (0.45 + 0.55 * rubbed) + (0.46 * rubbed + 0.12 * endWeather) * exposed;
  diffuseColor.rgb *= 0.99 + 0.070 * growth + 0.035 * grain - 0.11 * pores;
  // Desaturated bare fibres through uneven varnish, not green chair paint from the fallback sheet.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.235, 0.207, 0.165), benchWear);
  diffuseColor.rgb *= 1.0 - 0.10 * endWeather;
  benchRelief = (0.00005 * grain + 0.000035 * growth) * exposed;

  // Two nominal 14 mm domed bolt heads per slat over the x=+/-0.8 m cast webs.
  // These restrained dimensions are authored requirements, not measurements from the sheet.
  // Only the exposed broad face has hardware; no duplicate dots on end grain/undersides.
  float width = board < 4.5 ? 0.092 : 0.086;
  vec2 bolt = vec2(abs(vPropUv.x) - 0.8, (across - 0.5) * width);
  float radius = length(bolt);
  float aa = max(fwidth(radius), 0.0003);
  float resolved = 1.0 - smoothstep(0.004, 0.015, aa);
  // Restrained trapped dirt/tannin around the fastener, fading below pixel scale.
  float boltStain = (1.0 - smoothstep(0.008, 0.020, radius)) * exposed * resolved;
  diffuseColor.rgb *= 1.0 - 0.20 * boltStain;
  float rim = (1.0 - smoothstep(0.00825 - aa, 0.00825 + aa, radius)) * exposed * resolved;
  benchHead = (1.0 - smoothstep(0.007 - aa, 0.007 + aa, radius)) * exposed * resolved;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.030, 0.024), rim * 0.75);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.087, 0.075), benchHead);
  benchRelief += 0.0009 * max(0.0, 1.0 - radius * radius / 0.000049) * benchHead;
}
`,Ye=`
if (propBenchSlat) {
  // Shallow domed heads perturb the lit normal, rather than painting a fixed light direction.
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float determinant = dot(dx, rx);
  vec3 gradient = sign(determinant) * (dFdx(benchRelief) * rx + dFdy(benchRelief) * ry);
  normal = normalize(max(abs(determinant), 1e-10) * normal - gradient);
}
`,Xe=`
#ifdef PROP_ATLAS
  // -7 is authored only by buildNewsstand for unprinted steel, paper edges and canvas.
  // Do not make the shared mapped material selective for any other prop.
  if (vPropMat.z > -7.5 && vPropMat.z < -6.5) sampledDiffuseColor = vec4(1.0);
  if (vPropMat.w > 1.5 && vPropMat.w < 2.5 && vPropMat.z < 0.5) {
    sampledDiffuseColor = vec4(1.0);
    float grain = subwayWear(vMapUv * 18.0);
    // Enamel stays uniform here. Multiplying all painted faces by chip noise before vertex
    // colour made the tall castings look camouflage-painted, rather than locally abraded.
    if (vPropMat.x > 0.85) {
      // Worn coping, with a narrow dark contact band where it seats into the paving.
      diffuseColor.rgb *= (0.88 + 0.16 * grain) * mix(0.67, 1.0, smoothstep(0.15, 0.18, vSubwayLocal.y));
    }
  }
#endif
`,Ze=`
bool newsstandSteel = vPropMat.z > -7.5 && vPropMat.z < -6.5 && vPropMat.y > 0.7;
float newsstandBrush = 0.0;
float newsstandRelief = 0.0;
if (newsstandSteel) {
  float nsPhase = vPropUv.y * 2400.0 + 0.35 * sin(vPropUv.x * 3.0);
  float nsResolved = 1.0 - smoothstep(0.8, 2.8, fwidth(nsPhase));
  newsstandBrush = sin(nsPhase) * nsResolved;
  // Subtle directional microfinish; actual scene lighting supplies the highlights.
  diffuseColor.rgb *= 0.997 + 0.003 * newsstandBrush;
  newsstandRelief = newsstandBrush * 0.000002;
}
`,Qe=`
if (newsstandSteel) roughnessFactor = clamp(roughnessFactor + 0.018 * newsstandBrush, 0.03, 1.0);
`,$e=`
if (newsstandSteel) {
  vec3 nsDx = dFdx(-vViewPosition), nsDy = dFdy(-vViewPosition);
  vec3 nsRx = cross(nsDy, normal), nsRy = cross(normal, nsDx);
  float nsDet = dot(nsDx, nsRx);
  if (abs(nsDet) > 1e-12) {
    normal = normalize(abs(nsDet) * normal - sign(nsDet)
      * (dFdx(newsstandRelief) * nsRx + dFdy(newsstandRelief) * nsRy));
  }
}
`,et=`
varying vec3 vShelterLocal;
`,tt=`
vShelterLocal = position;
`,nt=`
varying vec3 vShelterLocal;
float shelterHash(vec2 p) { return fract(sin(dot(p, vec2(41.73, 289.13))) * 43758.5453); }
float shelterNoise(vec2 p) {
  vec2 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(shelterHash(cell), shelterHash(cell + vec2(1, 0)), f.x),
    mix(shelterHash(cell + vec2(0, 1)), shelterHash(cell + vec2(1)), f.x), f.y);
}
`,rt=`
bool shelterMetal = vPropMat.z > -10.5 && vPropMat.z < -9.5 && vPropMat.y > 0.3;
bool shelterPane = vPropMat.z > -11.5 && vPropMat.z < -10.5;
float shelterDirt = 0.0;
float shelterBrush = 0.0;
float shelterFinish = 0.0;
float shelterSeatGroove = 0.0;
float shelterEtch = 0.0;
float shelterSmudge = 0.0;
if (shelterMetal) {
  vec3 p = vShelterLocal;
  vec2 finishUv = vPropUv * vec2(18.0, 7.0);
  float finishFootprint = max(fwidth(finishUv.x), fwidth(finishUv.y));
  float finishNoise = mix(0.5, shelterNoise(finishUv), 1.0 - smoothstep(0.3, 0.9, finishFootprint));
  // Broad handling/polish variation still reads when the fine brushing is subpixel.
  // Only the shelter's -10 steel opts in: no generic metal tint or painted highlights.
  shelterFinish = shelterNoise(vPropUv * vec2(2.6, 0.9)) - 0.5;
  float foot = 1.0 - smoothstep(0.19, 0.59, p.y);
  shelterDirt = foot * (0.60 + 0.40 * finishNoise);
  // Actual brushing changes roughness; its submillimetre frequency fades before aliasing.
  float phase = vPropUv.y * 1900.0 + 0.5 * sin(vPropUv.x * 11.0);
  shelterBrush = sin(phase) * (1.0 - smoothstep(0.75, 2.5, fwidth(phase)));
  diffuseColor.rgb *= 0.994 + 0.012 * finishNoise + 0.020 * shelterFinish - 0.24 * shelterDirt;
  // Short broken scuffs at the shoe/paving and sleeve edges, not noise over every member.
  float shoeEdge = min(abs(p.y - 0.173), abs(p.y - 0.2575));
  float abrasion = (1.0 - smoothstep(0.002, 0.014, shoeEdge))
    * smoothstep(0.43, 0.73, shelterNoise(vPropUv * vec2(120.0, 31.0)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.325, 0.35), abrasion * 0.48);
  if (vPropMat.w > 0.5 && vPropMat.w < 1.5) {
    // Four shallow 5 mm drainage grooves on the continuous seat top. Integrate each
    // groove over the pixel footprint so unresolved lines become coverage, not speckles.
    // This subtype is emitted only by buildBusShelter, never another metal bench.
    float grooveDist = abs(mod(p.z - 0.190, 0.086) - 0.043);
    float footprint = max(fwidth(p.z), 0.0005);
    float coverage = max(0.0, min(0.0025, grooveDist + footprint * 0.5)
      - max(-0.0025, grooveDist - footprint * 0.5)) / footprint;
    coverage = mix(coverage, 0.005 / 0.086, smoothstep(0.043, 0.086, footprint));
    shelterSeatGroove = coverage * smoothstep(0.594, 0.604, p.y);
    diffuseColor.rgb *= 1.0 - 0.18 * shelterSeatGroove;
  }
}
if (shelterPane) {
  vec2 uv = clamp(vPropUv, 0.0, 1.0);
  float cover = step(0.5, vPropMat.w);
  float edgeDist = min(min(uv.x, 1.0 - uv.x) * mix(1.352, 1.1, cover),
    min(uv.y, 1.0 - uv.y) * mix(2.13, 1.7, cover));
  float dust = (1.0 - smoothstep(0.004, 0.036, edgeDist))
    * (0.55 + 0.45 * shelterNoise(uv * vec2(53.0, 29.0)));
  float splash = (1.0 - smoothstep(0.38, 0.75, vShelterLocal.y)) * (1.0 - cover)
    * (0.28 + 0.72 * shelterNoise(uv * vec2(21.0, 7.0)));
  float streakPhase = uv.x * 161.0 + 0.6 * sin(uv.y * 13.0);
  float streak = smoothstep(0.84, 0.98, 0.5 + 0.5 * sin(streakPhase))
    * (1.0 - smoothstep(0.07, 0.54, uv.y))
    * (1.0 - smoothstep(0.8, 2.8, fwidth(streakPhase))) * (1.0 - cover);
  shelterDirt = clamp(dust * 0.72 + splash * 0.47 + streak * 0.10, 0.0, 1.0);
  // Sparse broad wipe residue is mostly a roughness change; the view through remains clear.
  vec2 wipe = (uv - vec2(0.29, 0.46)) / vec2(0.22, 0.14);
  shelterSmudge = (1.0 - smoothstep(0.50, 1.0, length(wipe)))
    * (0.4 + 0.6 * shelterNoise(uv * 27.0));
  // Small anti-collision dots, not a frosted band. No etching over the advertising print.
  vec2 dotP = vec2((fract(uv.x * 16.0) - 0.5) * 0.0845, vShelterLocal.y - 1.22);
  float dotDist = length(dotP), aa = max(fwidth(dotDist), 0.0006);
  shelterEtch = (1.0 - smoothstep(0.0045 - aa, 0.0045 + aa, dotDist))
    * (1.0 - smoothstep(0.006, 0.018, aa)) * (1.0 - cover);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.185, 0.16), shelterDirt * 0.65);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.58, 0.61, 0.58), shelterEtch);
}
`,it=`
if (shelterMetal) roughnessFactor = clamp(roughnessFactor + shelterFinish * 0.035 + shelterDirt * 0.16
  + shelterBrush * 0.012 + shelterSeatGroove * 0.04, 0.08, 0.94);
if (shelterPane) roughnessFactor = clamp(0.085 + shelterDirt * 0.28 + shelterSmudge * 0.10 + shelterEtch * 0.25, 0.06, 0.65);
`,at=`
if (shelterPane) {
  // View-dependent grazing reflection from the scene's real environment, not painted cards.
  float fresnel = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 5.0);
  float cover = step(0.5, vPropMat.w);
  diffuseColor.a = clamp(mix(0.075, 0.035, cover) + 0.59 * fresnel
    + shelterDirt * 0.17 + shelterSmudge * 0.025 + shelterEtch * 0.48, 0.035, 0.78);
}
`,ot=`
if (shelterPane) {
  // Alpha blends the transmitted view; do not attenuate the physical F0 reflection twice.
  // The standard material supplies the lit/specular environment, including changing weather.
  outgoingLight += totalSpecular * (1.0 / max(diffuseColor.a, 0.10) - 1.0);
}
`,st=`
#ifdef PROP_SUBWAY_GLOBE
  if (vSubwayGlobe.x > 0.5) {
    float lowerGlass = 1.0 - smoothstep(1.974, 1.986, vSubwayGlobe.y);
    vec3 opal = vec3(0.60, 0.62, 0.57) * mix(0.84, 1.0, smoothstep(1.81, 1.87, vSubwayGlobe.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, opal, lowerGlass * (1.0 - clamp(uLamp, 0.0, 1.0)));
  }
#endif
#ifdef PROP_ATLAS
  if (vPropMat.w > 1.5 && vPropMat.w < 2.5 && vPropMat.z < 0.5) {
    vec3 subPos = vSubwayLocal;
    float wornFleck = smoothstep(0.52, 0.76, subwayWear(vMapUv * 57.0));
    if (vPropMat.y < 0.1 && vPropMat.x < 0.7) {
      // Sparse millimetre/centimetre chips at cast feet, lower rail arrises and square-post
      // corners. Unhandled upper faces stay near-black green (42 St–PABT reference).
      float highTouch = 1.0 - smoothstep(0.004, 0.018, abs(subPos.y - 1.114));
      float baseTouch = 1.0 - smoothstep(0.010, 0.035, abs(subPos.y - 0.27));
      float lowerEdge = min(abs(subPos.y - 0.25), abs(subPos.y - 0.39));
      float lowerTouch = 1.0 - smoothstep(0.003, 0.018, lowerEdge);
      vec2 castOffset = abs(vec2(subPos.x + 3.0, abs(subPos.z) - 1.37));
      float castCorner = 1.0 - smoothstep(0.002, 0.008, abs(castOffset.x - castOffset.y));
      castCorner *= (1.0 - step(0.16, max(castOffset.x, castOffset.y))) *
        (1.0 - smoothstep(0.60, 1.70, subPos.y));
      vec2 chipUv = vMapUv * 78.0;
      float paintFleck = smoothstep(0.66, 0.86, subwayWear(chipUv));
      vec2 chipFootprint = fwidth(chipUv);
      paintFleck *= 1.0 - smoothstep(0.8, 2.0, max(chipFootprint.x, chipFootprint.y));
      float contactWear = max(max(baseTouch, lowerTouch), max(highTouch * 0.30, castCorner * 0.45));
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.11, 0.12, 0.105), paintFleck * contactWear * 0.72);
    } else if (vPropMat.x > 0.85 && vPropMat.x < 0.95) {
      float slabEdge = min(abs(abs(subPos.z) - 1.45), abs(abs(subPos.x) - 3.20));
      float padEdge = min(abs(abs(subPos.x + 3.0) - 0.16), abs(abs(abs(subPos.z) - 1.37) - 0.155));
      if (subPos.x < -2.83 && abs(subPos.z) > 1.20) slabEdge = min(slabEdge, padEdge);
      if (subPos.x < -2.695 && abs(subPos.z) < 1.205) {
        slabEdge = min(abs(subPos.x + 3.0), abs(subPos.x + 2.70));
        // Lengthwise boot scuffs break up the broad threshold without painting another stripe.
        diffuseColor.rgb *= 0.76 + 0.28 * subwayWear(vec2(subPos.x * 12.0, subPos.z * 65.0));
      }
      float chippedArris = (1.0 - smoothstep(0.004, 0.033, slabEdge)) * wornFleck;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.31, 0.28), chippedArris * 0.7);
    } else if (vPropMat.x > 0.70 && vPropMat.x < 0.75) {
      // Yellow end paint wears through to the grey tread; it is never emissive.
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.23, 0.23, 0.21), wornFleck * 0.48);
    }
  }
#endif
`,ct=`
#ifdef PROP_ATLAS
float foodCartRoughness = vPropMat.x;
float foodCartMetalness = vPropMat.y;
float foodCartRelief = 0.0;
bool foodCartStainless = vPropMat.z > -4.25 && vPropMat.z < -3.75 && vPropMat.y > 0.85;
if (foodCartStainless) {
  vec3 cartPos = vSubwayLocal;
  float cartPatch = subwayWear(vPropUv * vec2(17.0, 7.0));
  float cartWipe = subwayWear(vPropUv * vec2(4.1, 2.7) + vec2(9.3, 2.1));
  float cartBrushScale = 850.0;
  float cartBrushFade = 1.0 - smoothstep(0.4, 1.2, fwidth(vPropUv.y * cartBrushScale));
  float cartBrush = (subwayWear(vPropUv * vec2(3.0, cartBrushScale)) - 0.5) * cartBrushFade;
  // Broader brushing groups modulate roughness, not painted silver stripes.
  // Both frequencies fade with pixel footprint; the millimetre grain cannot shimmer.
  float cartSatinFade = 1.0 - smoothstep(0.55, 1.8, fwidth(vPropUv.y * 92.0));
  float cartSatin = (subwayWear(vPropUv * vec2(2.3, 92.0)) - 0.5) * cartSatinFade;
  float cartFront = 1.0 - smoothstep(-0.74, -0.68, cartPos.z);
  float cartSplash = (1.0 - smoothstep(0.48, 0.82, cartPos.y)) * (0.35 + 0.65 * cartPatch);
  float cartSill = (1.0 - smoothstep(0.015, 0.08,
    min(abs(cartPos.y - 1.119), abs(cartPos.y - 0.853)))) * cartFront;
  float cartGrease = cartSill * smoothstep(0.35, 0.78, cartPatch) * 0.17;
  float cartHood = (1.0 - smoothstep(0.025, 0.19, abs(cartPos.y - 1.653)))
    * (1.0 - smoothstep(0.65, 0.80, abs(cartPos.x - 0.30)))
    * smoothstep(-0.39, -0.29, cartPos.z) * (1.0 - smoothstep(0.62, 0.69, cartPos.z));
  // Broad wipe marks change the reflected highlight more than the base colour.
  // Fold wear belongs to the cart's known cabinet edges and counter, not every metal prop.
  float cartSmudge = smoothstep(0.48, 0.82, cartWipe)
    * smoothstep(0.45, 0.70, cartPos.y) * (1.0 - smoothstep(1.72, 2.20, cartPos.y));
  float cartFold = min(abs(abs(cartPos.x) - 1.285), abs(cartPos.y - 1.1175));
  cartFold = min(cartFold, abs(cartPos.y - 0.2535));
  cartFold = min(cartFold, abs(cartPos.y - 0.853));
  float cartDoorX = abs(mod(cartPos.x + 1.22, 2.44 / 3.0) - 2.44 / 6.0);
  float cartDoorFold = min(abs(cartDoorX - 0.393), abs(abs(cartPos.y - 0.5475) - 0.275));
  float cartDoorArea = cartFront * step(0.26, cartPos.y) * (1.0 - step(0.83, cartPos.y));
  cartFold = min(cartFold, mix(1.0, cartDoorFold, cartDoorArea));
  float cartEdgeWear = (1.0 - smoothstep(0.002, 0.017, cartFold))
    * smoothstep(0.30, 0.69, cartPatch) * step(0.8, vPropMat.y);
  float cartDrip = smoothstep(0.58, 0.82, subwayWear(vPropUv * vec2(39.0, 1.7)))
    * (1.0 - smoothstep(0.02, 0.27, 1.10 - cartPos.y)) * step(cartPos.y, 1.10);
  // Dirty folded joins stay on the cabinet rails / equipment backsplash, not the ink.
  float cartJoin = (1.0 - smoothstep(0.002, 0.019, cartDoorFold)) * cartDoorArea;
  float cartRearJoint = min(abs(cartPos.x - 1.09), abs(cartPos.x + 0.93));
  cartRearJoint = min(cartRearJoint, abs(cartPos.y - 1.195));
  float cartRearDirt = (1.0 - smoothstep(0.006, 0.055, cartRearJoint))
    * step(0.38, cartPos.z) * step(1.135, cartPos.y) * (1.0 - smoothstep(1.73, 1.80, cartPos.y));
  float cartDirt = clamp(cartSplash * 0.19 + cartGrease + cartHood * cartPatch * 0.29
    + cartSmudge * 0.075 + cartDrip * 0.06 + (cartJoin * 0.38 + cartRearDirt * 0.29)
    * (0.45 + 0.55 * cartPatch), 0.0, 0.44);
  // Sparse rubbed scuffs interrupt the satin finish; their width is derivative-filtered.
  float cartScuffPhase = vPropUv.y * 181.0 + 0.8 * sin(vPropUv.x * 31.0);
  float cartScuffAA = max(fwidth(cartScuffPhase), 0.04);
  float cartScuff = (1.0 - smoothstep(0.04, 0.04 + cartScuffAA, abs(sin(cartScuffPhase))))
    * smoothstep(0.65, 0.86, cartPatch) * (1.0 - smoothstep(0.4, 1.2, cartScuffAA));
  diffuseColor.rgb *= 0.93 + cartWipe * 0.12 + cartBrush * 0.025;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.066, 0.041), cartDirt);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.57, 0.60, 0.59), cartEdgeWear * 0.24);
  foodCartRoughness = clamp(vPropMat.x + (cartWipe - 0.5) * 0.30 + cartSmudge * 0.18
    + cartSatin * 0.16 + cartBrush * 0.06 + cartDirt * 0.6 + cartScuff * 0.18
    - cartEdgeWear * 0.10, 0.19, 0.88);
  foodCartMetalness = vPropMat.y * (1.0 - cartDirt * 0.7);
  // Millimetre sheet waviness turns the actual environment highlight gently;
  // no painted reflection bands or brightened ink. Fine brushing fades at distance.
  foodCartRelief = 0.0012 * sin(vPropUv.x * 11.4 + 0.6 * sin(vPropUv.y * 4.1))
    * sin(vPropUv.y * 7.7) + 0.000004 * cartBrush;
}
// Only the cart's rotisserie has this roughness/metal signature under uvMode -4.
// Browned sliced layers use local position, so nothing repeats on bottles or cloth.
if (vPropMat.z > -4.25 && vPropMat.z < -3.75 && vPropMat.y < 0.01
    && abs(vPropMat.x - 0.76) < 0.001) {
  vec3 cartMeatPos = vSubwayLocal;
  float cartCrust = subwayWear(cartMeatPos.xy * vec2(39.0, 27.0));
  float cartSlicePhase = cartMeatPos.y * 930.0 + 2.0 * subwayWear(cartMeatPos.xz * 23.0);
  float cartSliceFade = 1.0 - smoothstep(0.9, 3.0, fwidth(cartSlicePhase));
  float cartSlice = (0.5 + 0.5 * sin(cartSlicePhase)) * cartSliceFade;
  diffuseColor.rgb *= 0.72 + cartCrust * 0.65 + cartSlice * 0.18;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.062, 0.031, 0.012),
    smoothstep(0.61, 0.86, cartCrust) * 0.60);
  foodCartRoughness = 0.60 + cartCrust * 0.21;
}
#endif
`,lt=`
#ifdef PROP_ATLAS
if (foodCartStainless) {
  vec3 cartDx = dFdx(-vViewPosition), cartDy = dFdy(-vViewPosition);
  vec3 cartRx = cross(cartDy, normal), cartRy = cross(normal, cartDx);
  float cartDet = dot(cartDx, cartRx);
  if (abs(cartDet) > 1e-12) {
    normal = normalize(abs(cartDet) * normal - sign(cartDet)
      * (dFdx(foodCartRelief) * cartRx + dFdy(foodCartRelief) * cartRy));
  }
}
#endif
`,ut=`
{
  float ch = vPropEmit.x;
  float st = vPropEmit.y;
  vec3 e = vec3(0.0);
  #ifdef USE_COLOR
    vec3 vc = vColor.rgb;
  #else
    vec3 vc = vec3(1.0);
  #endif
  if (ch > 0.5 && ch < 1.5) {
    e = mix(uLampWarm, uLampWhite, clamp(vPropData.x, 0.0, 1.0)) * st * uLamp;
  } else if (ch < 2.5 && ch > 1.5) {
    e = vc * st * uLamp;
  } else if (ch > 2.5 && ch < 5.5) {
    float lens = ch - 3.0;
    float lit = abs(vPropData.y - lens) < 0.5 ? 1.0 : 0.0;
    vec3 lc = lens < 0.5 ? vec3(1.0, 0.08, 0.03) : (lens < 1.5 ? vec3(1.0, 0.55, 0.05) : vec3(0.05, 1.0, 0.35));
    // Keep only the cap bright, near the bloom threshold rather than several stops above it.
    e = lc * st * lit;
    diffuseColor.rgb = mix(diffuseColor.rgb, lc * 0.35, lit * 0.8);
  } else if (ch > 5.5 && ch < 6.5) {
    e = vc * st;
  } else if (ch > 6.5 && ch < 7.5) {
    #ifdef USE_MAP
      e = sampledDiffuseColor.rgb * st;
    #endif
  } else if (ch > 7.5 && ch < 8.5) {
    #ifdef USE_MAP
      e = sampledDiffuseColor.rgb * st * uLamp;
      // Only shelter print (+5): a restrained diffuser with a slightly dimmer sealed edge.
      // Keep the shared lamp gate, so daytime emission is exactly zero; ink stays dark.
      if (vPropMat.z > 4.5 && vPropMat.z < 5.5) {
        float inset = min(min(vPropUv.x, 1.0 - vPropUv.x), min(vPropUv.y, 1.0 - vPropUv.y));
        e *= 0.84 + 0.16 * smoothstep(0.0, 0.12, inset);
      }
    #endif
  } else if (ch > 8.5 && ch < 9.5) {
    #ifdef USE_MAP
      e = sampledDiffuseColor.rgb * st;
    #endif
  }
  totalEmissiveRadiance += e;
}
`,dt=`
varying vec3 vHydrantLocal;
varying float vHydrantSeed;
`,ft=`
vHydrantLocal = position;
vHydrantSeed = 0.0;
#ifdef USE_INSTANCING
  if (aMat.z < -1.5 && aMat.z > -3.5) {
    vec2 cell = floor(instanceMatrix[3].xz * 16.0);
    vHydrantSeed = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
  }
#endif
`,pt=`
varying vec3 vHydrantLocal;
varying float vHydrantSeed;
float hydrantHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float hydrantNoise(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hydrantHash(cell), hydrantHash(cell + vec3(1,0,0)), f.x),
                 mix(hydrantHash(cell + vec3(0,1,0)), hydrantHash(cell + vec3(1,1,0)), f.x), f.y),
             mix(mix(hydrantHash(cell + vec3(0,0,1)), hydrantHash(cell + vec3(1,0,1)), f.x),
                 mix(hydrantHash(cell + vec3(0,1,1)), hydrantHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
`,mt=`
float hydrantRoughness = vPropMat.x;
float hydrantMetalness = vPropMat.y;
float hydrantRelief = 0.0;
if (vPropMat.z < -1.5 && vPropMat.z > -3.5) {
  vec3 p = vHydrantLocal;
  vec3 sampleP = p + vec3(vHydrantSeed * 7.0, 0.0, vHydrantSeed * 11.0);
  float patches = hydrantNoise(sampleP * 48.0);
  float flakes = hydrantNoise(sampleP * 240.0);
  float casting = hydrantNoise(sampleP * 930.0);
  float flow = hydrantNoise(sampleP * vec3(32.0, 6.0, 32.0));
  float role = vPropMat.w;
  if (role < 2.5) {
    float oldPaint = step(2.5, -vPropMat.z);
    float radius = length(p.xz);
    float flangeRim = max(1.0 - smoothstep(0.002, 0.008, abs(p.y - 0.249)),
      1.0 - smoothstep(0.0015, 0.006, abs(p.y - 0.223)))
      * smoothstep(0.097, 0.11, radius);
    float bonnetRim = (1.0 - smoothstep(0.001, 0.004, abs(p.y - 0.691)))
      * smoothstep(0.074, 0.081, radius);
    float rim = max(flangeRim, bonnetRim);
    float sideRim = (1.0 - smoothstep(0.004, 0.008, abs(abs(p.x) - 0.126)))
      * smoothstep(0.031, 0.036, length(p.yz - vec2(0.572, 0.0)));
    float frontRim = (1.0 - smoothstep(0.004, 0.008, abs(p.z + 0.13)))
      * smoothstep(0.042, 0.048, length(p.xy - vec2(0.0, 0.562)));
    rim = max(rim, max(sideRim, frontRim));
    // Gate chips to actual casting edges. Noise only breaks up that wear; it must
    // not pepper the long intact barrel with free-floating rust islands.
    float wearEdge = max(rim, step(1.5, role) * 0.25);
    float chip = wearEdge * smoothstep(0.62, 0.78, patches * 0.7 + flakes * 0.3 + oldPaint * 0.025);
    float rust = chip * smoothstep(0.46, 0.68, patches);
    vec3 oxide = mix(vec3(0.04, 0.026, 0.016), vec3(0.075, 0.036, 0.02), flakes);
    vec3 exposed = mix(vec3(0.055, 0.055, 0.052), oxide, smoothstep(0.46, 0.68, patches));
    diffuseColor.rgb *= 0.96 + 0.08 * patches;
    diffuseColor.rgb = mix(diffuseColor.rgb, exposed, chip);
    // Satin black enamel stays dielectric; the silver bonnet has a tighter,
    // brighter metal reflection without smoothing away its local tarnish.
    float minRoughness = role < 0.5 ? 0.3 : 0.24;
    hydrantRoughness = clamp(vPropMat.x + (flow - 0.5) * 0.16 + (patches - 0.5) * 0.12 + (flakes - 0.5) * 0.04, minRoughness, 0.86);
    hydrantRoughness = mix(hydrantRoughness, 0.91, rust);
    hydrantMetalness = mix(vPropMat.y, 0.65, chip) * (1.0 - rust * 0.97);

    // A few irregular, millimetre-wide washed/oxidised runs, not broad ribs.
    // Jitter width, origin and fade independently; no streak is added to relief.
    // Local y keeps gravity vertical even when the hydrant instance is rotated.
    float angle = atan(p.z, p.x);
    float lane = (angle + 3.14159265) * 4.61549335; // 29 lanes; seam stays periodic.
    float laneId = mod(floor(lane), 29.0);
    float run = hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 9.0));
    float runCenter = 0.2 + 0.6 * hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 3.0));
    float runShape = hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 17.0));
    float runTop = 0.666 - 0.012 * runShape;
    float runEnd = runTop - 0.07 - 0.18 * hydrantHash(vec3(laneId, vHydrantSeed * 29.0, 23.0));
    float taper = smoothstep(runEnd, runTop, p.y);
    float runWidth = (0.065 + 0.065 * runShape) * (0.3 + 0.7 * taper);
    float stripe = (1.0 - smoothstep(runWidth, runWidth + 0.045, abs(fract(lane) - runCenter)))
      * smoothstep(0.8, 0.92, run);
    float drip = stripe * smoothstep(runEnd, runEnd + 0.045, p.y)
      * (1.0 - smoothstep(runTop - 0.012, runTop, p.y))
      * (1.0 - smoothstep(0.078, 0.086, radius)) * (0.6 + 0.4 * flow);
    // Dirt follows the exposed foot, not the buried physics-ground origin.
    float exposedHeight = max(0.0, p.y - 0.15);
    float dirt = (1.0 - smoothstep(0.01, 0.11, exposedHeight)) * (0.6 + 0.4 * patches);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.03, 0.028, 0.024), drip * 0.25);
    diffuseColor.rgb = mix(diffuseColor.rgb, oxide * 0.5, drip * 0.1);
    diffuseColor.rgb = mix(diffuseColor.rgb * (1.0 - dirt * 0.25), vec3(0.026, 0.021, 0.015), dirt * 0.27);
    hydrantRoughness = mix(hydrantRoughness, 0.94, max(dirt, drip * 0.4));
    hydrantMetalness *= 1.0 - max(dirt, drip * 0.65);
    hydrantRelief = (casting - 0.5) * 0.00008 + (flakes - 0.5) * 0.00013 - chip * 0.00032;
    if (role > 0.5 && role < 1.5) hydrantRelief *= 0.65;

    if (role > 0.5 && role < 1.5) {
      // Neutral silver tarnish: darker grey oxidation, never a green cast.
      // Keep broad clean areas; only broken portions of the rim are rubbed dull.
      float tarnish = smoothstep(0.39, 0.75, patches * 0.55 + flow * 0.45);
      float dullRim = bonnetRim * smoothstep(0.42, 0.7, patches);
      diffuseColor.rgb *= 1.0 - 0.3 * tarnish;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.17, 0.17, 0.166), dullRim * 0.45);
      hydrantRoughness = clamp(hydrantRoughness + tarnish * 0.19 + dullRim * 0.12, 0.3, 0.85);
      hydrantMetalness *= 1.0 - tarnish * 0.28;
    }

    if (role < 0.5) {
      // Abrasion is tied to the actual exposed foot/pavement junction and both
      // flange edges. Broken grey-brown flecks, not a continuous rust ring.
      float footContact = (1.0 - smoothstep(0.004, 0.026, abs(p.y - 0.158)))
        * (1.0 - smoothstep(0.064, 0.068, radius));
      float abrasion = max(flangeRim, footContact * 0.5)
        * smoothstep(0.53, 0.72, patches * 0.55 + flakes * 0.45);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.058, 0.053, 0.045), abrasion * 0.42);
      hydrantRoughness = mix(hydrantRoughness, 0.82, abrasion);
      // Two faint worn marker strokes on the back, intentionally no invented text.
      float tagArea = (1.0 - smoothstep(0.024, 0.03, abs(p.x + 0.018)))
        * smoothstep(0.063, 0.074, p.z);
      float stroke = 1.0 - smoothstep(0.0007, 0.002, abs(p.y - 0.338 - 0.012 * sin((p.x + 0.028) * 125.0)));
      float slash = 1.0 - smoothstep(0.0007, 0.0018, abs(p.y - 0.338 + (p.x + 0.018) * 0.38));
      float tag = max(stroke, slash) * tagArea * smoothstep(0.3, 0.65, flakes) * 0.32;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.31, 0.29, 0.24), tag);
      hydrantRoughness = mix(hydrantRoughness, 0.85, tag);
    }
  } else {
    diffuseColor.rgb *= 0.88 + 0.16 * flakes;
  }
}
`,ht=`
if (vPropMat.z < -1.5 && vPropMat.z > -3.5 && vPropMat.w < 2.5) {
  // Sub-millimetre casting relief and paint steps, in view-space surface derivatives.
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12) {
    normal = normalize(abs(det) * normal - sign(det)
      * (dFdx(hydrantRelief) * rx + dFdy(hydrantRelief) * ry));
  }
}
`,gt=`
varying vec4 vBollardLocalSeed;
`,_t=`
vBollardLocalSeed = vec4(position, 0.0);
#ifdef USE_INSTANCING
  if (aMat.z > -9.5 && aMat.z < -8.5) {
    vBollardLocalSeed.w = fract(dot(floor(instanceMatrix[3].xz * 16.0), vec2(0.1031, 0.11369)));
  }
#endif
`,vt=`
if (aMat.z > -9.5 && aMat.z < -8.5 && aMat.w > 2.5) {
  // Collapse unused eyes AND links into the shaft, including non-instanced previews.
  // Existing bollards do not cast shadows; that catalogue policy remains unchanged.
  transformed = vec3(0.0, 0.5, 0.0);
  #ifdef USE_INSTANCING
    vec2 origin = instanceMatrix[3].xz;
    bool firstSpan = distance(origin, vec2(148.52, 84.14)) < 0.025;
    bool secondSpan = distance(origin, vec2(149.59, 82.21)) < 0.025;
    bool lastPost = distance(origin, vec2(150.65, 80.28)) < 0.025;
    bool aligned = distance(instanceMatrix[2].xz, vec2(0.480822615, -0.876817890)) < 0.002
      && abs(instanceMatrix[1].y - 1.0) < 0.002;
    if (aMat.w < 3.5 && aligned) {
      bool occupiedEye = position.z > 0.0 ? (firstSpan || secondSpan) : (secondSpan || lastPost);
      if (occupiedEye) transformed = position;
    } else if (aMat.w > 3.5 && (firstSpan || secondSpan) && aligned) {
      vec2 end = firstSpan ? vec2(149.59, 82.21) : vec2(150.65, 80.28);
      vec2 delta = end - origin;
      vec2 localEnd = vec2(dot(instanceMatrix[0].xz, delta), dot(instanceMatrix[2].xz, delta));
      transformed = position;
      // Account for centimetre rounding in the placed coordinates. Both ends meet
      // actual neighbour eyelets instead of assuming the rounded yaw is exact.
      transformed.xz += (localEnd - vec2(0.0, 2.2)) * clamp((position.z - 0.164) / 1.872, 0.0, 1.0);
      vBollardLocalSeed.xyz = transformed;
    }
  #endif
}
`,yt=`
varying vec4 vBollardLocalSeed;
// Metric abrasion envelope: chips get a pixel-wide boundary, rubbed paint a soft edge.
// Keep the resolved silhouette independent of the fine-noise distance fade.
float bollardScratch(vec2 p, vec2 centre, vec2 size, float lean, float feather) {
  vec2 d = p - centre;
  d.x += d.y * lean;
  float edge = length(d / size);
  float aa = max(feather, fwidth(edge));
  return 1.0 - smoothstep(1.0 - aa, 1.0 + aa, edge);
}
`,bt=`
bool propBollard = vPropMat.z > -9.5 && vPropMat.z < -8.5;
float bollardRoughness = vPropMat.x;
float bollardMetalness = vPropMat.y;
float bollardRelief = 0.0;
if (propBollard) {
  vec3 p = vBollardLocalSeed.xyz;
  vec3 sampleP = p + vec3(vBollardLocalSeed.w * 7.0, 0.0, vBollardLocalSeed.w * 11.0);
  float bollardPatch = hydrantNoise(sampleP * 47.0);
  float cloud = hydrantNoise(sampleP * vec3(13.0, 7.0, 13.0));
  // Independent, centimetre-scale paint sheen, not extra albedo speckle.
  float coat = hydrantNoise(sampleP * vec3(31.0, 16.0, 31.0));
  vec3 chipP = sampleP * 210.0;
  float chipFade = 1.0 - smoothstep(0.7, 1.9, length(fwidth(chipP)));
  float flake = mix(0.5, hydrantNoise(chipP), chipFade);
  float radius = length(p.xz);
  float role = vPropMat.w;
  float shell = 1.0 - step(0.5, role);
  float flange = step(0.5, role) * (1.0 - step(1.5, role));
  // Uneven splash height and paint loss climb the lower shaft, not a clean rust ring.
  float low = 1.0 - smoothstep(0.045, 0.26 + (cloud - 0.5) * 0.12, p.y);
  float dirt = low * (0.40 + 0.60 * cloud);
  // Local edge contact, not uniform speckle over the whole painted cylinder.
  float flangeEdge = (1.0 - smoothstep(0.003, 0.012, min(abs(p.y - 0.007), abs(p.y - 0.033))))
    * smoothstep(0.145, 0.154, radius);
  float toeEdge = (1.0 - smoothstep(0.008, 0.032, abs(p.y - 0.065)))
    * (1.0 - smoothstep(0.113, 0.12, radius));
  float capEdge = (1.0 - smoothstep(0.001, 0.004, abs(p.y - 0.805))) * 0.18;
  float contact = max(flangeEdge, max(toeEdge * 0.85, capEdge));
  if (role > 1.5) contact = role < 2.5 ? 0.72 : 0.20;
  float fracture = bollardPatch * 0.78 + flake * 0.22;
  float fractureAA = max(0.018, fwidth(fracture) * 0.65);
  float brokenPaint = smoothstep(0.54 - fractureAA, 0.54 + fractureAA, fracture);
  float chip = brokenPaint * max(contact, shell * low * 0.52);
  // Ref: pedestrians-1 supports vertical rubbing, dull surrounding paint and dirty
  // feet, not the hydraulic caps/stripes. Frayed patches interrupt each abrasion
  // completely; no minimum-opacity pale streak or repeated diagonal tick marks.
  float markShift = (vBollardLocalSeed.w - 0.5) * 0.016;
  float front = 1.0 - smoothstep(-0.097, -0.071, p.z);
  vec2 marks = p.xy - vec2(markShift, 0.0);
  vec2 frayedMarks = marks + vec2((bollardPatch - 0.5) * 0.009, (flake - 0.5) * 0.012);
  float rub = max(bollardScratch(frayedMarks, vec2(-0.042, 0.350), vec2(0.014, 0.080), 0.025, 0.02),
    bollardScratch(frayedMarks, vec2(0.021, 0.535), vec2(0.010, 0.050), -0.04, 0.02));
  rub = max(rub, bollardScratch(frayedMarks, vec2(-0.018, 0.180), vec2(0.023, 0.046), 0.06, 0.02) * 0.64);
  // 8–20 mm torn islands are sized for the fixed 3 m view, instead of relying
  // on 3 mm streaks that enter the fine-detail distance fade.
  vec3 abrasionP = sampleP * vec3(118.0, 55.0, 100.0);
  float abrasionFade = 1.0 - smoothstep(0.7, 1.9, length(fwidth(abrasionP)));
  float abrasionNoise = hydrantNoise(abrasionP);
  float tear = abrasionNoise * 0.68 + bollardPatch * 0.32;
  float tearAA = max(0.018, fwidth(tear) * 0.65);
  float tornPaint = mix(0.20, smoothstep(0.53 - tearAA, 0.53 + tearAA, tear), abrasionFade);
  float scuffHalo = max(bollardScratch(marks, vec2(-0.041, 0.350), vec2(0.023, 0.094), 0.025, 0.30),
    bollardScratch(marks, vec2(0.021, 0.535), vec2(0.017, 0.064), -0.04, 0.30));
  float scuff = scuffHalo * front * shell * (0.35 + 0.65 * bollardPatch);
  chip = max(chip, rub * front * shell * tornPaint * 0.92);
  // Only scraped flange bevels and the high hex faces expose fresh metal. Leave
  // the washer seating and most of the mounting plate in their dark painted finish.
  float anchorWear = 0.0;
  if (role > 1.5 && role < 2.5)
    anchorWear = smoothstep(0.050, 0.055, p.y) * (0.4 + 0.35 * brokenPaint);
  float cleanEdge = max(flange * flangeEdge * brokenPaint * 0.78, anchorWear);
  chip = max(chip, anchorWear);
  // Oxidation is an independent exposed-iron mix, not multiplied by chip opacity
  // twice. Keep it confined to irregular toe/rim damage and muted fastener bleed.
  float oxideAmount = low * (0.42 + 0.58 * smoothstep(0.35, 0.67, cloud));
  oxideAmount *= 1.0 - 0.92 * smoothstep(0.15, 0.65, cleanEdge);
  float rust = chip * oxideAmount;
  vec3 iron = vec3(0.098, 0.096, 0.089);
  vec3 oxide = vec3(0.105, 0.055, 0.028);
  diffuseColor.rgb *= (0.91 + 0.16 * cloud) * (1.0 + 0.22 * scuff);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(iron, oxide, oxideAmount), chip);
  float footStain = (shell + flange) * (1.0 - smoothstep(0.012, 0.14, p.y))
    * smoothstep(0.48, 0.68, cloud * 0.52 + bollardPatch * 0.48) * (1.0 - cleanEdge);
  diffuseColor.rgb = mix(diffuseColor.rgb, oxide * 0.72, footStain * 0.35);
  float settledDirt = dirt * (1.0 - cleanEdge * 0.75);
  diffuseColor.rgb *= 1.0 - 0.24 * settledDirt;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.038, 0.034, 0.026), settledDirt * 0.30);
  float contactGrime = (1.0 - smoothstep(0.003, 0.016 + 0.015 * bollardPatch, p.y))
    * (0.55 + 0.45 * cloud);
  float socketGrime = shell * (1.0 - smoothstep(0.003, 0.012, abs(p.y - 0.039)));
  diffuseColor.rgb *= 1.0 - 0.46 * max(contactGrime, socketGrime);
  if (flange > 0.5) {
    float boltDistance = length(abs(p.xz) - vec2(0.094752309));
    float halo = (1.0 - smoothstep(0.017, 0.038, boltDistance))
      * (0.18 + 0.82 * brokenPaint) * smoothstep(0.026, 0.036, p.y) * (1.0 - cleanEdge);
    diffuseColor.rgb = mix(diffuseColor.rgb, oxide * 0.82, halo * 0.68);
    float washerCrevice = 1.0 - smoothstep(0.016, 0.019, boltDistance);
    diffuseColor.rgb *= 1.0 - 0.38 * washerCrevice;
  }
  bollardRoughness = clamp(vPropMat.x + (cloud - 0.5) * 0.14 + (coat - 0.5) * 0.20
    + (flake - 0.5) * 0.045 + settledDirt * 0.16 + rust * 0.18 + footStain * 0.08
    - scuff * 0.075 + contactGrime * 0.12 - chip * (1.0 - oxideAmount) * 0.16, 0.48, 0.96);
  // Paint remains dielectric; only the sparse rubbed-through iron changes metalness.
  bollardMetalness = chip * 0.58 * (1.0 - oxideAmount) * (1.0 - settledDirt * 0.7);
  bollardRelief = (flake - 0.5) * 0.000085 * chipFade - chip * 0.00015;
}
`,xt=`
if (propBollard) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12) normal = normalize(abs(det) * normal - sign(det)
    * (dFdx(bollardRelief) * rx + dFdy(bollardRelief) * ry));
}
`,St=`
varying vec4 vMailboxLocalSeed;
`,Ct=`
vMailboxLocalSeed = vec4(position, 0.0);
#ifdef USE_INSTANCING
  if (aMat.z < -5.5 && aMat.z > -6.5) {
    vMailboxLocalSeed.w = fract(sin(dot(floor(instanceMatrix[3].xz * 16.0),
      vec2(19.173, 43.719))) * 43758.5453);
  }
#endif
`,wt=`
varying vec4 vMailboxLocalSeed;
uniform sampler2D uMailboxLabels;
float mailboxHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float mailboxNoise(vec3 p) {
  vec3 cell = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(mailboxHash(cell), mailboxHash(cell + vec3(1,0,0)), f.x),
                 mix(mailboxHash(cell + vec3(0,1,0)), mailboxHash(cell + vec3(1,1,0)), f.x), f.y),
             mix(mix(mailboxHash(cell + vec3(0,0,1)), mailboxHash(cell + vec3(1,0,1)), f.x),
             mix(mailboxHash(cell + vec3(0,1,1)), mailboxHash(cell + vec3(1,1,1)), f.x), f.y), f.z);
}
// Finite metric scratches, antialiased in screen space; no repeating stripe map.
float mailboxScratch(vec2 p, vec2 a, vec2 b, float width) {
  vec2 span = b - a;
  float along = clamp(dot(p - a, span) / dot(span, span), 0.0, 1.0);
  float dist = length(p - a - span * along);
  return 1.0 - smoothstep(width, width + max(fwidth(dist), 0.00035), dist);
}
`,Tt=`
bool propMailbox = vPropMat.z < -5.5 && vPropMat.z > -6.5;
float mailboxRoughness = vPropMat.x;
float mailboxMetalness = vPropMat.y;
if (propMailbox) {
  vec3 mbPos = vMailboxLocalSeed.xyz;
  vec3 mbSample = mbPos + vec3(vMailboxLocalSeed.w * 9.0, 0.0, vMailboxLocalSeed.w * 5.0);
  float mbCloud = mailboxNoise(mbSample * vec3(9.0, 6.0, 9.0));
  float mbPatch = mailboxNoise(mbSample * 31.0);
  float mbFine = mailboxNoise(mbSample * 170.0);
  float mbResolution = 1.0 - smoothstep(0.006, 0.025, length(fwidth(mbPos)));
  float mbRole = vPropMat.w;
  if (mbRole < 0.5 || mbRole > 2.5) {
    // Ref: mailbox-2's faded enamel, directional abrasions and localized rubs.
    // Keep the broad colour drift quiet so wear reads as contact, not clouds.
    float mbMacro = mailboxNoise(mbSample * vec3(4.5, 4.0, 4.5));
    float mbChalk = smoothstep(0.28, 0.76, mbCloud * 0.70 + mbMacro * 0.30);
    float mbFade = smoothstep(0.42, 1.20, mbPos.y) * (0.35 + 0.65 * mbChalk);
    float mbFront = 1.0 - smoothstep(-0.254, -0.246, mbPos.z);
    float mbPanelFade = smoothstep(0.38, 0.46, mbPos.y)
      * (1.0 - smoothstep(0.72, 0.77, mbPos.y)) * mbFront;
    diffuseColor.rgb *= 0.90 + 0.15 * mbCloud;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.082, 0.135, 0.205),
      mbChalk * 0.16 + mbFade * 0.11 + mbPanelFade * 0.05);
    // Faint vertical contact wear, with short interrupted abrasions rather
    // than isolated pale diagonal slashes. All coordinates are mailbox-local.
    float mbSide = smoothstep(0.252, 0.262, abs(mbPos.x));
    float mbAcross = mix(mbPos.x, mbPos.z, mbSide);
    float mbRubNoise = mailboxNoise(mbSample * vec3(75.0, 14.0, 75.0) + vec3(7.1, 11.3, 19.7));
    float mbContactPanel = smoothstep(0.39, 0.46, mbPos.y)
      * (1.0 - smoothstep(0.70, 0.75, mbPos.y)) * max(mbFront, mbSide);
    float mbScuff = mbContactPanel
      * smoothstep(0.55, 0.80, mbRubNoise * 0.70 + mbFine * 0.30);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.090, 0.137, 0.186), mbScuff * 0.14);
    vec2 mbContact = vec2(mbAcross, mbPos.y + mbSide * 0.037 + vMailboxLocalSeed.w * 0.012);
    float mbScratch = max(
      mailboxScratch(mbContact, vec2(-0.172, 0.438), vec2(-0.174, 0.468), 0.00045),
      mailboxScratch(mbContact, vec2(-0.165, 0.521), vec2(-0.166, 0.563), 0.0004));
    mbScratch = max(mbScratch,
      mailboxScratch(mbContact, vec2(-0.071, 0.486), vec2(-0.073, 0.508), 0.00035));
    mbScratch = max(mbScratch,
      mailboxScratch(mbContact, vec2(0.101, 0.598), vec2(0.100, 0.640), 0.00045));
    mbScratch = max(mbScratch,
      mailboxScratch(mbContact, vec2(0.187, 0.455), vec2(0.185, 0.521), 0.0005));
    float mbBreakup = mailboxNoise(mbSample * vec3(35.0, 240.0, 35.0));
    mbScratch *= max(mbFront, mbSide) * mbResolution
      * smoothstep(0.40, 0.60, mbFine * 0.60 + mbBreakup * 0.40);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.095, 0.140, 0.187), mbScratch * 0.33);
    float mbLeg = 1.0 - smoothstep(0.275, 0.395, mbPos.y);
    float mbBottom = 1.0 - smoothstep(0.007, 0.035, abs(mbPos.y - 0.36) + (mbPatch - 0.5) * 0.018);
    float mbCorner = smoothstep(0.242, 0.264, abs(mbPos.x))
      * smoothstep(0.215, 0.25, abs(mbPos.z));
    float mbPanelLip = (1.0 - smoothstep(0.003, 0.013, abs(mbPos.y - 0.754))) * mbFront
      * smoothstep(0.43, 0.65, mbPatch);
    float mbFrameDistance = abs(max(abs(mbPos.x) - 0.207, abs(mbPos.y - 0.838) - 0.062));
    float mbPlacardEdge = (1.0 - smoothstep(0.003, 0.014,
      mbFrameDistance + (mbPatch - 0.5) * 0.012)) * mbFront;
    float mbEdge = max(max(mbBottom, mbPanelLip * 0.65), mbPlacardEdge);
    mbEdge = max(mbEdge, mbCorner * (1.0 - smoothstep(0.42, 0.83, mbPos.y)) * 0.55);
    float mbChip = mbEdge * smoothstep(0.44, 0.64, mbPatch * 0.76 + mbFine * 0.24);
    // The visible mounting tabs are at y=.155, above the .15 m sidewalk.
    // Broken peeling islands span the feet AND lower posts; never recolour
    // an entire plate orange or leave the exposed post uniformly blue-black.
    float mbLegPattern = mailboxNoise(mbSample * vec3(92.0, 24.0, 92.0)
      + vec3(11.3, 3.9, 5.7)) * 0.63 + mbFine * 0.37;
    float mbBaseLoss = 1.0 - smoothstep(0.22, 0.35, mbPos.y + (mbPatch - 0.5) * 0.065);
    float mbLegPeel = max(mbBaseLoss * smoothstep(0.34, 0.59, mbLegPattern),
      mbLeg * smoothstep(0.42, 0.66, mbLegPattern));
    float mbFootPlate = 1.0 - smoothstep(0.169, 0.187, mbPos.y);
    float mbFootPeel = mbFootPlate * smoothstep(0.32, 0.60, mbLegPattern * 0.75 + mbPatch * 0.25);
    mbChip = max(mbChip, max(mbLegPeel, mbFootPeel));
    // Sparse rubbed chips on the rolled crown; the broad rim stays blue enamel.
    float mbRim = smoothstep(0.267, 0.272, abs(mbPos.x)) * smoothstep(0.86, 0.96, mbPos.y);
    float mbRimChip = mbRim * smoothstep(0.64, 0.80, mbPatch * 0.8 + mbFine * 0.2);
    mbChip = max(mbChip, mbRimChip);
    float mbOxide = smoothstep(0.30, 0.57, mbCloud * 0.65 + mbFine * 0.35);
    mbOxide = mix(mbOxide, 0.60 + 0.40 * smoothstep(0.34, 0.69, mbLegPattern), mbLeg);
    mbOxide *= 1.0 - mbRimChip * 0.65;
    vec3 mbRust = mix(vec3(0.051, 0.025, 0.014), vec3(0.165, 0.068, 0.029), mbFine);
    mbRust = mix(mbRust, mix(vec3(0.072, 0.027, 0.013), vec3(0.205, 0.079, 0.029),
      mbPatch * 0.65 + mbFine * 0.35), mbLeg);
    vec3 mbSteel = mix(vec3(0.095, 0.10, 0.102), vec3(0.028, 0.033, 0.035), mbLeg);
    vec3 mbBare = mix(mbSteel, mbRust, mbOxide);
    diffuseColor.rgb = mix(diffuseColor.rgb, mbBare, mbChip);
    float mbDirt = (1.0 - smoothstep(0.16, 0.36, mbPos.y)) * (0.5 + 0.5 * mbCloud);
    diffuseColor.rgb *= 1.0 - mbDirt * 0.21;
    // Intact paint stays dielectric. Only genuinely exposed, unoxidised chips
    // receive metalness; rust, paper, stencil ink and dirt all remain nonmetal.
    mailboxMetalness = 0.58 * mbChip * (1.0 - mbOxide) * (1.0 - mbDirt);
    float mbPaintRoughness = vPropMat.x + (mbCloud - 0.5) * 0.15 + mbChalk * 0.13
      + (mbFine - 0.5) * 0.035 * mbResolution + mbFade * 0.06 - mbScuff * 0.13 + mbScratch * 0.10;
    float mbBareRoughness = mix(mix(0.43, 0.61, mbLeg), 0.92, mbOxide);
    mailboxRoughness = clamp(mix(mbPaintRoughness, mbBareRoughness, mbChip) + mbDirt * 0.10, 0.40, 0.93);
  } else if (mbRole < 1.5) {
    diffuseColor.rgb *= 0.92 + 0.08 * mbCloud;
    mailboxRoughness = 0.83;
    mailboxMetalness = 0.0;
  } else {
    float mbTarnish = smoothstep(0.42, 0.74, mbPatch);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.065, 0.038, 0.021), mbTarnish * 0.55);
    mailboxRoughness = mix(vPropMat.x, 0.88, mbTarnish);
    mailboxMetalness = vPropMat.y * (1.0 - mbTarnish * 0.8);
    float mbAnchor = 1.0 - smoothstep(0.185, 0.220, mbPos.y);
    vec3 mbAnchorRust = mix(vec3(0.100, 0.038, 0.018), vec3(0.245, 0.110, 0.052),
      smoothstep(0.168, 0.182, mbPos.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, mbAnchorRust * (0.88 + 0.12 * mbPatch), mbAnchor);
    mailboxRoughness = mix(mailboxRoughness, 0.89, mbAnchor);
    mailboxMetalness *= 1.0 - mbAnchor;
  }
  if (mbRole > 2.5) {
    vec4 mbLabel = texture2D(uMailboxLabels, vPropUv);
    diffuseColor.rgb = mix(diffuseColor.rgb, mbLabel.rgb * (0.79 + 0.035 * mbCloud), mbLabel.a);
    mailboxRoughness = mix(mailboxRoughness, 0.84, mbLabel.a);
    mailboxMetalness *= 1.0 - mbLabel.a;
  }
}
`,Et=`
varying vec4 vPlanterLocal;
`,Dt=`
vPlanterLocal = vec4(position, 0.0);
#ifdef USE_INSTANCING
  if (abs(aMat.z + 12.0) < 0.25)
    vPlanterLocal.w = fract(sin(dot(floor(instanceMatrix[3].xz * 8.0), vec2(12.9898, 78.233))) * 43758.5453);
#endif
`,Ot=`
varying vec4 vPlanterLocal;
float planterHash(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float planterNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(planterHash(i), planterHash(i + vec2(1, 0)), f.x),
    mix(planterHash(i + vec2(0, 1)), planterHash(i + vec2(1)), f.x), f.y);
}
`,kt=`
bool propPlanter = abs(vPropMat.z + 12.0) < 0.25;
float planterRoughness = vPropMat.x;
float planterRelief = 0.0;
if (propPlanter) {
  vec2 p = vPropUv + vPlanterLocal.w * vec2(4.7, 6.3);
  float role = vPropMat.w;
  float cloud = planterNoise(p * 8.0);
  float grains = planterNoise(p * 185.0);
  vec2 grainDx = fwidth(p * 185.0);
  float detail = 1.0 - smoothstep(0.45, 1.5, max(grainDx.x, grainDx.y));
  if (role < 1.5) {
    // 4–7 mm mineral grains, isolated casting pores and sub-millimetre relief.
    vec2 cells = p * 143.0, cell = floor(cells);
    float pore = step(0.935, planterHash(cell))
      * (1.0 - smoothstep(0.12, 0.29, length(fract(cells) - vec2(0.5)))) * detail;
    float mineral = smoothstep(0.60, 0.84, grains) * detail;
    float quartz = (1.0 - smoothstep(0.16, 0.31, grains)) * detail;
    // Quiet mineral variation in one neutral casting, not a speckled finish.
    diffuseColor.rgb *= 0.955 + 0.075 * cloud;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.215, 0.20), mineral * 0.22);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.48, 0.465, 0.44), quartz * 0.16);
    diffuseColor.rgb *= 1.0 - pore * 0.47;
    float height = vPlanterLocal.y;
    float toe = (1.0 - smoothstep(0.025, 0.21, height)) * (0.7 + 0.3 * cloud);
    float flow = planterNoise(vec2(p.x * 31.0, height * 2.4 + vPlanterLocal.w * 9.0));
    float drip = smoothstep(0.61, 0.84, flow)
      * smoothstep(0.18 + flow * 0.15, 0.65, height) * (1.0 - smoothstep(0.678, 0.70, height));
    diffuseColor.rgb *= 1.0 - 0.22 * toe - 0.06 * drip;
    if (role > 0.5) diffuseColor.rgb *= 0.88 - 0.16 * (1.0 - smoothstep(0.505, 0.685, height));
    planterRoughness = clamp(0.79 + cloud * 0.06 + pore * 0.1 + toe * 0.07, 0.76, 0.97);
    planterRelief = (grains - 0.5) * 0.00085 * detail - pore * 0.0012;
  } else if (role < 2.5) {
    float crumbs = planterNoise(p * 78.0);
    diffuseColor.rgb *= 0.69 + 0.40 * crumbs + 0.16 * grains;
    planterRelief = (crumbs - 0.5) * 0.0025 + (grains - 0.5) * 0.0008 * detail;
    planterRoughness = 0.98;
  } else {
    diffuseColor.rgb *= 0.83 + 0.27 * grains;
    planterRelief = (grains - 0.5) * 0.0007 * detail;
    planterRoughness = 0.96;
  }
}
`,At=`
if (propPlanter) {
  vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
  vec3 rx = cross(dy, normal), ry = cross(normal, dx);
  float det = dot(dx, rx);
  if (abs(det) > 1e-12)
    normal = normalize(abs(det) * normal - sign(det)
      * (dFdx(planterRelief) * rx + dFdy(planterRelief) * ry));
}
`,jt=`
if (abs(vPropMat.z + 13.0) < 0.25) {
  sampledDiffuseColor = vPropMat.w < 0.5 ? texture2D(uPlanterLeaves, vPropUv) : vec4(1.0);
}
`;function Mt(e,t){let n=e.onBeforeCompile;e.onBeforeCompile=(r,i)=>{n&&n!==p.prototype.onBeforeCompile&&n.call(e,r,i),t(r,i)}}var Nt=0;function Pt(e,t={}){let n=new d({color:16777215,vertexColors:!0,roughness:1,metalness:0,map:t.map??null,transparent:!!t.transparent,opacity:t.opacity??1,alphaTest:t.alphaTest??0,side:t.side??0,envMapIntensity:t.envMapIntensity??1,depthWrite:t.depthWrite??!0});n.name=t.name??`props-${Nt++}`;let r=!!t.atlas,i=r||!!t.transparent,a=t.selectiveMap&&(t.alphaTest??0)>0?me():null;a&&n.addEventListener(`dispose`,()=>a.dispose());let o=t.name===`props-metal`,s=t.name===`props-metal`,c=t.name===`props-metal`,l=t.name===`props-metal`,u=t.name===`props-metal`,f=t.name===`props-metal`?Pe():null;f&&n.addEventListener(`dispose`,()=>f.dispose());let p=t.name===`props-metal`?_e():null;p&&n.addEventListener(`dispose`,()=>p.dispose());let m=t.name===`props-metal`,h=!t.selectiveMap&&t.alphaTest===.4&&t.side===2?ge():null;h&&n.addEventListener(`dispose`,()=>h.dispose()),Mt(n,n=>{n.uniforms.uLamp=Z.uLamp,n.uniforms.uLampWarm=Z.uLampWarm,n.uniforms.uLampWhite=Z.uLampWhite,n.uniforms.uWet=Z.uWet,n.uniforms.uPedFrames=Z.uPedFrames,l&&(n.uniforms.uTrashEvening={get value(){let t=e?.time.dayFraction,n=Number.isFinite(t)?(t%1+1)%1*24:12;return+(n>=18||n<6||Z.uLamp.value>.2)}}),r&&(n.defines={...n.defines??{},PROP_ATLAS:1}),s&&(n.defines={...n.defines??{},PROP_BIKE_RACK:1}),u&&(n.defines={...n.defines??{},PROP_SUBWAY_GLOBE:1}),p&&(n.uniforms.uMailboxLabels={value:p}),h&&(n.uniforms.uPlanterLeaves={value:h}),a&&(n.uniforms.uBasketMap={value:a},n.defines={...n.defines??{},PROP_BASKET:1}),f&&(n.uniforms.uCitiMark={value:f},n.defines={...n.defines??{},PROP_CITI_MARK:1}),n.vertexShader=n.vertexShader.replace(`#include <common>`,`#include <common>
`+Le+(o?dt:``)+(p?St:``)+(c?gt:``)+(l?Be:``)+(m?Et:``)+(i?et:``)).replace(`#include <uv_vertex>`,`#include <uv_vertex>
`+Re+(o?ft:``)+(p?Ct:``)+(c?_t:``)+(m?Dt:``)+(i?tt:``)).replace(`#include <begin_vertex>`,`#include <begin_vertex>
`+(c?vt:``)+(l?Ve:``)),n.fragmentShader=n.fragmentShader.replace(`#include <common>`,`#include <common>
`+ze+(o?pt:``)+(p?wt:``)+(c?yt:``)+(l?Be:``)+(m?Ot:``)+(h?`
uniform sampler2D uPlanterLeaves;
`:``)+(i?nt:``)).replace(`#include <color_fragment>`,`#include <color_fragment>
`+Je+(o?mt:``)+st+Ge+Ke+(r?ct+Ze:``)+(p?Tt:``)+(c?bt:``)+(l?He:``)+(m?kt:``)+(i?rt:``)).replace(`#include <roughnessmap_fragment>`,`#include <roughnessmap_fragment>
roughnessFactor = clamp(`+(o?`hydrantRoughness`:r?`foodCartRoughness`:`vPropMat.x`)+` * (1.0 - 0.5 * uWet), 0.03, 1.0);
if (propBenchSlat) roughnessFactor = mix(clamp((vPropMat.x + benchWear * 0.55) * (1.0 - 0.5 * uWet), 0.03, 1.0), 0.44, benchHead);`+(p?`
if (propMailbox) roughnessFactor = clamp(mailboxRoughness * (1.0 - 0.5 * uWet), 0.03, 1.0);`:``)+(s?`
if (propBikeRack) roughnessFactor = clamp(bikeRackRoughness * (1.0 - 0.5 * uWet), 0.03, 1.0);`:``)+(r?Qe:``)+(l?`
if (propTrash) roughnessFactor = clamp(trashRoughness * (1.0 - 0.25 * uWet), 0.16, 1.0);`:``)+(m?`
if (propPlanter) roughnessFactor = clamp(planterRoughness * (1.0 - 0.35 * uWet), 0.03, 1.0);`:``)+(i?it:``)+(c?`
if (propBollard) roughnessFactor = clamp(bollardRoughness * (1.0 - 0.5 * uWet), 0.03, 1.0);`:``)).replace(`#include <metalnessmap_fragment>`,`#include <metalnessmap_fragment>
metalnessFactor = `+(o?`hydrantMetalness`:r?`foodCartMetalness`:`vPropMat.y`)+`;
if (propBenchSlat) metalnessFactor = 0.55 * benchHead;`+(p?`
if (propMailbox) metalnessFactor = mailboxMetalness;`:``)+(s?`
if (propBikeRack) metalnessFactor = bikeRackMetalness;`:``)+(c?`
if (propBollard) metalnessFactor = bollardMetalness;`:``)).replace(`#include <normal_fragment_maps>`,(l?`if (!propTrash) {
#include <normal_fragment_maps>
}
`:`#include <normal_fragment_maps>
`)+Ye+(o?ht:``)+(r?lt+$e:``)+(c?xt:``)+(l?Ue:``)+(m?At:``)+(i?at:``)).replace(`#include <aomap_fragment>`,`#include <aomap_fragment>`+(s?`
if (propBikeRack) { reflectedLight.indirectDiffuse *= bikeRackOcclusion; reflectedLight.indirectSpecular *= mix(1.0, bikeRackOcclusion, 0.7); }`:``)).replace(`#include <emissivemap_fragment>`,`#include <emissivemap_fragment>
`+ut).replace(`vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`,`vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
`+(i?ot:``)),n.fragmentShader=n.fragmentShader.replace(`#include <map_fragment>`,I.map_fragment.replace(`diffuseColor *= sampledDiffuseColor;`,(t.selectiveMap?qe:`diffuseColor *= sampledDiffuseColor;`).replace(`diffuseColor *= sampledDiffuseColor;`,`if (vPropMat.z < -0.5 && vPropMat.z > -1.5) sampledDiffuseColor = vec4(1.0);
`+(o?`if (vPropMat.z < -1.5 && vPropMat.z > -3.5) sampledDiffuseColor = vec4(1.0);
`:``)+(p?`if (vPropMat.z < -5.5 && vPropMat.z > -6.5) sampledDiffuseColor = vec4(1.0);
`:``)+(s?`if (vPropMat.z < -7.5 && vPropMat.z > -8.5) sampledDiffuseColor = vec4(1.0);
`:``)+(c?`if (vPropMat.z > -9.5 && vPropMat.z < -8.5) sampledDiffuseColor = vec4(1.0);
`:``)+(m?`if (abs(vPropMat.z + 12.0) < 0.25) sampledDiffuseColor = vec4(1.0);
`:``)+(h?jt:``)+(l?`if (vPropMat.z < -13.5 && vPropMat.z > -17.5) sampledDiffuseColor = vec4(1.0);
`:``)+(r?Xe:``)+(r?`if (vPropMat.z > -10.5 && vPropMat.z < -9.5) sampledDiffuseColor = vec4(1.0);
`:``)+(r?`if (vPropMat.z > 5.5 && vPropMat.z < 6.5 && sampledDiffuseColor.a < 0.5) discard;
`:``)+We+(r?`if (vPropMat.z > -4.25 && vPropMat.z < -3.75) sampledDiffuseColor = vec4(1.0);
`:``)+`diffuseColor *= sampledDiffuseColor;`)))});let g=n.customProgramCacheKey.bind(n);n.customProgramCacheKey=()=>`props-bench-v3-citi-v3${r?`-atlas-foodcart-v5-newsstand-brushed-v2-selector7-busflag-cutout6`:``}${t.selectiveMap?`-selective`:``}${a?`-basket`:``}${o?`-hydrant-wear`:``}${u?`-subway-opal`:``}${f?`-citi-mark`:``}${p?`-mailbox-v4-selector6`:``}${s?`-bike-rack-v4-selector8`:``}${c?`-bollard-v4-fractured-paint-selector9`:``}${i?`-shelter-v3-satin-seat-selectors10-11-5`:``}${m?`-planter-stone-v4-selector12`:``}${h?`-leaf-sprays-v1-selector13`:``}${l?`-trash-v1-selectors14-17`:``}-${g()}`;let _=e?.modules.get(`atmosphere`);try{_?.setupMaterial?.(n)}catch(e){console.warn(`[props] atmosphere.setupMaterial failed`,e)}return n}function Ft(e){let t=e.modules.get(`atmosphere`);Z.uLamp=t?.uniforms?.uNight??{value:1-e.time.daylight};let n=t?.uniforms?.uWetness;n&&(Z.uWet=n)}var It=class{data;count=0;constructor(e=64){this.data=new Float32Array(e*9)}push(e,t,n,r,i=1,a=0,o=0,s=0,c=0){if((this.count+1)*9>this.data.length){let e=new Float32Array(this.data.length*2);e.set(this.data),this.data=e}let l=this.count*9,u=this.data;return u[l]=e,u[l+1]=t,u[l+2]=n,u[l+3]=r,u[l+4]=i,u[l+5]=a,u[l+6]=o,u[l+7]=s,u[l+8]=c,this.count++}},Lt=new y;function Rt(e,t,n,r,i,a,o=0){let s=r[i+3],c=r[i+4],l=Math.cos(s)*c,u=Math.sin(s)*c,d=n*16;e.set(d,l),e.set(d+1,0),e.set(d+2,-u),e.set(d+3,0),e.set(d+4,0),e.set(d+5,c),e.set(d+6,0),e.set(d+7,0),e.set(d+8,u),e.set(d+9,0),e.set(d+10,l),e.set(d+11,0),e.set(d+12,r[i]),e.set(d+13,r[i+1]),e.set(d+14,r[i+2]),e.set(d+15,1);for(let e=0;e<4;e++)t.set(n*4+e,a[o+e])}var zt=class{name;near;far=null;nearData;farData=null;opts;drawn=0;drawnFar=0;shadowDrawn=0;total=0;scratchData=new Float32Array(4);nearMatrixUpdates;nearDataUpdates;farMatrixUpdates=null;farDataUpdates=null;nonCasters;constructor(e,t,r,i,a,o){this.name=e,this.opts=o,this.nonCasters=o.castShadowDistance!==void 0&&(o.castShadow??!0)?new Float32Array(o.capacity*9):null;let s=(t,r,i)=>{let a=t,s=new D(new Float32Array(o.capacity*4),4);s.setUsage(n),a.setAttribute(`aData`,s);let c=new E(a,r,o.capacity);return c.instanceMatrix.setUsage(n),c.count=0,c.frustumCulled=!1,c.castShadow=o.castShadow??!0,c.receiveShadow=o.receiveShadow??!0,c.name=`props-${e}${i}`,o.customDepthMaterial&&(c.customDepthMaterial=o.customDepthMaterial),o.renderOrder!==void 0&&(c.renderOrder=o.renderOrder),c.visible=!1,{mesh:c,data:s}},c=s(t,i,``);if(this.near=c.mesh,this.nearData=c.data,this.nearMatrixUpdates=new ue(c.mesh.instanceMatrix),this.nearDataUpdates=new ue(c.data),this.nonCasters){let e=0;this.near.onBeforeShadow=()=>{e=this.near.count,this.near.count=Math.min(e,this.shadowDrawn)},this.near.onAfterShadow=()=>{this.near.count=e}}if(r){let e=s(r,a??i,`-far`);this.far=e.mesh,this.farData=e.data,this.farMatrixUpdates=new ue(e.mesh.instanceMatrix),this.farDataUpdates=new ue(e.data),this.far.castShadow=!1}}addTo(e){e.add(this.near),this.far&&e.add(this.far)}gather(e,t,n,r,i){let a=this.opts,o=a.range,s=a.farRange??o,c=Math.max(o,s),l=this.far!==null,u=a.capacity,d=0,f=0,p=0,m=0,h=0,g=(a.castShadowDistance??1/0)**2,_=o*o,v=s*s,y=a.radius,b=this.scratchData,x=c+190;for(let o of e){let e=o.kinds.get(this.name);if(!e||e.count===0)continue;p+=e.count;let s=i?i[o.key]={placed:e.count,near:0,far:0,tileRange:0,distance:0,frustum:0,dynamic:0,capacity:0}:void 0,c=o.cx-t.x,S=o.cz-t.z;if(c*c+S*S>x*x){s&&(s.tileRange=e.count);continue}let C=e.data;for(let i=0;i<e.count;i++){let e=i*9,o=C[e],c=C[e+1],p=C[e+2],x=o-t.x,S=c-t.y,w=p-t.z,T=x*x+S*S+w*w;if(T>v){s&&s.distance++;continue}let E=T<=_;if(!E&&!l){s&&s.distance++;continue}if(!a.noFrustum&&(Lt.center.set(o,c+y*.5,p),Lt.radius=y*C[e+4],!n.intersectsSphere(Lt))){s&&s.frustum++;continue}if(b[0]=C[e+5],b[1]=C[e+6],b[2]=C[e+7],b[3]=C[e+8],a.dynamic&&!a.dynamic(C,e,b,0,r)){s&&s.dynamic++;continue}if((E?d:f)>=u){s&&s.capacity++;continue}if(E&&this.nonCasters&&T>g){let t=h++*9;for(let n=0;n<5;n++)this.nonCasters[t+n]=C[e+n];for(let e=0;e<4;e++)this.nonCasters[t+5+e]=b[e];d++,s&&s.near++;continue}let D=E?m++:f;Rt(E?this.nearMatrixUpdates:this.farMatrixUpdates,E?this.nearDataUpdates:this.farDataUpdates,D,C,e,b),E?(d++,s&&s.near++):(f++,s&&s.far++)}}for(let e=0;e<h;e++){let t=e*9;Rt(this.nearMatrixUpdates,this.nearDataUpdates,m+e,this.nonCasters,t,this.nonCasters,t+5)}this.shadowDrawn=m,this.total=p,this.drawn=d,this.drawnFar=f,this.near.count=d,this.near.visible=d>0,d>0&&(this.nearMatrixUpdates.flush(),this.nearDataUpdates.flush()),this.far&&(this.far.count=f,this.far.visible=f>0,f>0&&(this.farMatrixUpdates.flush(),this.farDataUpdates.flush()))}dispose(){this.near.geometry.dispose(),this.near.dispose(),this.far&&(this.far.geometry.dispose(),this.far.dispose())}},Bt=[Z.uLampWarm.value,Z.uLampWhite.value,new O(.85,.95,1),new O(.5,.9,.6)],Vt=[140,150,55,5],Ht=[34,36,16,6],Ut=.17,Wt=class{ctx;size;lights=[];assigned=[];target=[];current=[];constructor(e,t){this.ctx=e,this.size=t;for(let n=0;n<t;n++){let t=new s(16777215,0,30,2);t.castShadow=!1,t.name=`props-lamp-${n}`,t.position.set(0,-1e3,0),e.scene.add(t),this.lights.push(t),this.assigned.push(null),this.target.push(0),this.current.push(0)}}assign(e,t,n,r=!1){let i=this.size,a=[];for(let t of e)if(t.kind<2&&a.push(t),a.length===i)break;if(a.length<i){for(let t of e)if(t.kind>=2&&a.push(t),a.length===i)break}let o=new Set(a);for(let e=0;e<i;e++){let t=this.assigned[e];t&&!o.has(t)&&(this.target[e]=0,r&&(this.assigned[e]=null,this.current[e]=0))}for(let e of a){if(this.assigned.includes(e))continue;let t=-1;for(let e=0;e<i;e++)if(this.assigned[e]===null){t=e;break}if(t<0){let e=-1,n=1/0;for(let t=0;t<i;t++)this.target[t]===0&&this.current[t]<n&&(n=this.current[t],e=t);if(e<0||n>.15)continue;t=e}this.assigned[t]=e,this.current[t]=0;let n=this.lights[t];n.position.set(e.x,e.y,e.z),n.color.copy(Bt[e.kind]),n.distance=Ht[e.kind]}for(let e=0;e<i;e++){let i=this.assigned[e];i&&o.has(i)&&(this.target[e]=1);let a=r?1:Math.min(1,Math.max(0,n)*4);this.current[e]+=(this.target[e]-this.current[e])*a;let s=this.lights[e];s.intensity=i?Vt[i.kind]*this.current[e]*t:0,(!i||this.target[e]===0&&this.current[e]<.01)&&(this.assigned[e]=null,s.intensity=0,s.position.set(0,-1e3,0))}}removeSources(e){for(let t=0;t<this.size;t++)!this.assigned[t]||!e.includes(this.assigned[t])||(this.assigned[t]=null,this.target[t]=this.current[t]=this.lights[t].intensity=0,this.lights[t].position.set(0,-1e3,0))}dispose(){for(let e of this.lights)this.ctx.scene.remove(e),e.dispose();this.assigned.fill(null)}},Gt=1024,Kt=class{ctx;mesh;material;aData;shops=new Map;uniforms;constructor(e,t,r){this.ctx=e;let i=new a(2,2);i.rotateX(-Math.PI/2),this.aData=new D(new Float32Array(Gt*4),4),this.aData.setUsage(n),i.setAttribute(`aData`,this.aData),this.uniforms={uMap:{value:pe()},uLamp:t,uWet:r},this.material=new f({name:`props-lightpool`,uniforms:this.uniforms,transparent:!0,depthWrite:!1,depthTest:!0,blending:2,polygonOffset:!0,polygonOffsetFactor:-2,polygonOffsetUnits:-2,vertexShader:`
        attribute vec4 aData;
        varying vec2 vUv;
        varying vec4 vData;
        varying float vDist;
        void main() {
          vUv = uv;
          vData = aData;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec4 mv = viewMatrix * wp;
          vDist = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,fragmentShader:`
        precision highp float;
        uniform sampler2D uMap;
        uniform float uLamp;
        uniform float uWet;
        varying vec2 vUv;
        varying vec4 vData;
        varying float vDist;
        void main() {
          // The canvas gradient is white RGB with radial ALPHA, not a greyscale mask.
          float a = texture2D(uMap, vUv).a;
          vec3 c = vData.rgb;
          float strength = vData.w * uLamp * (1.0 + 0.8 * uWet);
          // fade with distance so far pools do not pile up into a bright haze
          strength *= 1.0 - smoothstep(180.0, 320.0, vDist);
          gl_FragColor = vec4(c * a * strength, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `}),this.mesh=new E(i,this.material,Gt),this.mesh.instanceMatrix.setUsage(n),this.mesh.count=0,this.mesh.frustumCulled=!1,this.mesh.renderOrder=20,this.mesh.name=`props-lightpools`,this.mesh.castShadow=!1,this.mesh.receiveShadow=!1;let o=e.modules.get(`atmosphere`);try{o?.setupMaterial?.(this.material)}catch{}}addTile(e){this.shops.set(e,{sources:[]})}removeTile(e){this.shops.delete(e)}set(e,t,n=300){if(t){let r=this.ctx.modules.get(`buildings`),i=[],a=e=>(e.x-t.x)**2+(e.z-t.z)**2;for(let[e,t]of this.shops){let o=r?.storefronts(e);o!==t.segments&&(t.segments=o,t.sources=(o??[]).map(e=>{let t=e.x+e.nx*1.3,n=e.z+e.nz*1.3;return{x:t,z:n,y:0,groundY:this.ctx.physics.groundHeight(t,n),kind:0,poolX:e.width/2,poolZ:1.3,yaw:Math.atan2(e.nx,e.nz),seed:0,color:e.color,get intensity(){return .28*e.lit}}}));for(let e of t.sources)e.intensity>0&&a(e)<n**2&&i.push(e)}i.sort((e,t)=>a(e)-a(t)),i.length=Math.min(40,i.length),e=[...i,...e.slice(0,Gt-i.length)]}let r=Math.min(e.length,Gt),i=this.mesh.instanceMatrix.array,a=this.aData.array;for(let t=0;t<r;t++){let n=e[t],r=Math.cos(n.yaw),o=Math.sin(n.yaw),s=n.poolX,c=n.poolZ,l=t*16;i[l]=r*s,i[l+1]=0,i[l+2]=-o*s,i[l+3]=0,i[l+4]=0,i[l+5]=1,i[l+6]=0,i[l+7]=0,i[l+8]=o*c,i[l+9]=0,i[l+10]=r*c,i[l+11]=0,i[l+12]=n.x,i[l+13]=(n.groundY??0)+Ut,i[l+14]=n.z,i[l+15]=1;let u=n.intensity??(n.kind===0?.55:n.kind===1?.5:n.kind===2?.35:.12);a[t*4]=n.color?.[0]??Bt[n.kind].r,a[t*4+1]=n.color?.[1]??Bt[n.kind].g,a[t*4+2]=n.color?.[2]??Bt[n.kind].b,a[t*4+3]=u}this.mesh.count=r,this.mesh.instanceMatrix.needsUpdate=!0,this.aData.needsUpdate=!0,this.mesh.visible=r>0}dispose(){this.shops.clear(),this.mesh.geometry.dispose(),this.mesh.dispose(),this.material.dispose(),this.uniforms.uMap.value.dispose()}},qt=[24,30,110],Jt=6e3,Yt=class{points;material;geom;aPos;aSeed;aKind;count=0;lastKey=``;uniforms;constructor(e,t){this.uniforms={uTime:{value:0},uWind:{value:new c(.6,0,.3)},uSunColor:{value:new O(1,.95,.85)},uSkyColor:{value:new O(.5,.6,.75)},uLamp:t,uMap:{value:R()},uFogColor:{value:new O(.7,.75,.8)},uFogDensity:{value:8e-4},uPixelRatio:{value:e.renderer.getPixelRatio()}};let r=e.modules.get(`atmosphere`)?.uniforms;r&&(r.uSunColor&&(this.uniforms.uSunColor=r.uSunColor),r.uSkyColor&&(this.uniforms.uSkyColor=r.uSkyColor),r.uFogColor&&(this.uniforms.uFogColor=r.uFogColor),r.uFogDensity&&(this.uniforms.uFogDensity=r.uFogDensity)),this.geom=new x,this.aPos=new C(new Float32Array(Jt*3),3),this.aSeed=new C(new Float32Array(Jt),1),this.aKind=new C(new Float32Array(Jt),1),this.aPos.setUsage(n),this.aSeed.setUsage(n),this.aKind.setUsage(n),this.geom.setAttribute(`position`,this.aPos),this.geom.setAttribute(`aSeed`,this.aSeed),this.geom.setAttribute(`aKind`,this.aKind),this.geom.setDrawRange(0,0),this.geom.boundingSphere=new y(new c,1e6),this.material=new f({name:`props-steam`,uniforms:this.uniforms,transparent:!0,depthWrite:!1,depthTest:!0,blending:1,vertexShader:`
        attribute float aSeed;
        attribute float aKind;
        uniform float uTime;
        uniform vec3 uWind;
        uniform float uPixelRatio;
        varying float vAlpha;
        varying float vLife;
        varying float vFogDepth;
        varying float vKind;
        varying float vRot;
        float h1(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
        void main() {
          // per-particle constants from the seed
          float r0 = h1(aSeed), r1 = h1(aSeed + 1.7), r2 = h1(aSeed + 3.1), r3 = h1(aSeed + 5.3);
          float dur = aKind > 1.5 ? 6.0 + r0 * 4.0 : (aKind > 0.5 ? 3.0 + r0 * 2.0 : 2.5 + r0 * 2.0);
          float rate = 1.0 / dur;
          float life = fract(uTime * rate + r1);            // 0..1
          float t = life * dur;
          // start offset (source area) and motion
          float src = aKind > 1.5 ? 0.22 : (aKind > 0.5 ? 1.2 : 0.35);
          vec3 p = position + vec3((r2 - 0.5) * src, 0.0, (r3 - 0.5) * src);
          float rise = aKind > 1.5 ? 2.6 : (aKind > 0.5 ? 0.45 : 0.7);
          // buoyant rise slows as it cools; wind takes over
          p.y += rise * t * (1.0 - 0.35 * life);
          p += uWind * t * (0.35 + 0.65 * life);
          // turbulence
          float ph = aSeed * 0.37;
          p.x += sin(t * 1.3 + ph) * 0.25 * life + sin(t * 3.1 + ph * 2.0) * 0.08;
          p.z += cos(t * 1.1 + ph * 1.3) * 0.25 * life + cos(t * 2.7 + ph) * 0.08;
          // size grows with life
          float base = aKind > 1.5 ? 1.3 : (aKind > 0.5 ? 1.0 : 0.55);
          float size = base * (0.35 + 3.0 * life);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float dist = max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(size * 900.0 * uPixelRatio / dist, 1.0, 240.0);
          // fade in fast, out slow; thinner for wisps
          float a = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.3, 1.0, life));
          a *= aKind > 1.5 ? 0.5 : (aKind > 0.5 ? 0.14 : 0.22);
          vRot = r2 * 6.2831 + (r3 - 0.5) * t * 1.2;
          // distance fade so far steam does not turn into blobs
          a *= 1.0 - smoothstep(120.0, 220.0, dist);
          vAlpha = a;
          vLife = life;
          vFogDepth = dist;
          vKind = aKind;
        }
      `,fragmentShader:`
        precision highp float;
        uniform sampler2D uMap;
        uniform vec3 uSunColor;
        uniform vec3 uSkyColor;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uLamp;
        varying float vAlpha;
        varying float vLife;
        varying float vFogDepth;
        varying float vKind;
        varying float vRot;
        void main() {
          // rotate the sprite per particle so the puffs do not all share one silhouette
          vec2 pc = gl_PointCoord - 0.5;
          float cs = cos(vRot), sn = sin(vRot);
          vec2 rc = vec2(pc.x * cs - pc.y * sn, pc.x * sn + pc.y * cs) + 0.5;
          vec4 tex = texture2D(uMap, rc);
          float a = tex.a * vAlpha;
          if (a < 0.004) discard;
          // lit by sun + sky in the day (brighter toward the top of each puff), warm sodium/LED glow at night
          float top = 0.75 + 0.5 * (0.5 - pc.y);
          vec3 day = (uSunColor * 0.5 * top + uSkyColor * 0.55);
          vec3 night = vec3(0.85, 0.7, 0.5) * (0.35 + 0.3 * top);
          vec3 col = mix(day, night, uLamp) * (0.9 + 0.1 * (1.0 - vLife));
          col = clamp(col, 0.0, 1.5);
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
          col = mix(col, uFogColor, fog);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `}),this.points=new w(this.geom,this.material),this.points.frustumCulled=!1,this.points.renderOrder=50,this.points.name=`props-steam`;let i=e.modules.get(`atmosphere`);try{i?.setupMaterial?.(this.material)}catch{}}setEmitters(e){let t=e.map(e=>e.seed).join(`,`);if(t===this.lastKey)return;this.lastKey=t;let n=0,r=this.aPos.array,i=this.aSeed.array,a=this.aKind.array;for(let t of e){let e=qt[t.kind];for(let o=0;o<e&&n<Jt;o++)r[n*3]=t.x,r[n*3+1]=t.y,r[n*3+2]=t.z,i[n]=t.seed%1e3*7.31+o*1.618,a[n]=t.kind,n++}this.count=n,this.aPos.needsUpdate=!0,this.aSeed.needsUpdate=!0,this.aKind.needsUpdate=!0,this.geom.setDrawRange(0,n),this.points.visible=n>0}update(e,t,n){this.uniforms.uTime.value=e;let r=-t.dir,i=Math.min(6,t.speed)*.18+.15;this.uniforms.uWind.value.set(Math.sin(r)*i,0,-Math.cos(r)*i),this.uniforms.uPixelRatio.value=n}get particleCount(){return this.count}dispose(){this.geom.dispose(),this.material.dispose(),this.uniforms.uMap.value.dispose()}};function Xt(e,t){let n=-Math.sin(e.yaw),r=-Math.cos(e.yaw),i=null,a=1225;for(let o of t)if(!(o.tunnel||o.lanes<1||o.pts.length<2))for(let s of[!0,!1]){let c=o.pts[s?0:o.pts.length-1],l=o.pts[s?1:o.pts.length-2],u=l[0]-c[0],d=l[1]-c[1],f=Math.hypot(u,d);if(!f||(u*n+d*r)/f<.9)continue;let p=(e.x-c[0])**2+(e.z-c[1])**2;if(p>a||!t.some(e=>e!==o&&!e.tunnel&&e.lanes>=1&&e.pts.length>=2&&[!0,!1].some(t=>{let i=e.pts[t?0:e.pts.length-1],a=e.pts[t?1:e.pts.length-2],o=a[0]-i[0],s=a[1]-i[1],l=Math.hypot(o,s);return Math.hypot(i[0]-c[0],i[1]-c[1])<1&&l>0&&Math.abs((o*n+s*r)/l)<.8})))continue;let m=!o.oneway||!s;i&&Math.abs(p-a)<1e-6?i.incoming||=m:(a=p,i={x:c[0],z:c[1],fx:n,fz:r,incoming:m})}return i}var Zt={STREET:`ST`,AVENUE:`AV`,AVE:`AV`,WEST:`W`,EAST:`E`,NORTH:`N`,SOUTH:`S`,PLACE:`PL`,BOULEVARD:`BLVD`,ROAD:`RD`,DRIVE:`DR`,LANE:`LN`,PARKWAY:`PKWY`,SQUARE:`SQ`,TERRACE:`TER`,COURT:`CT`,EXPRESSWAY:`EXPWY`,HIGHWAY:`HWY`,BRIDGE:`BR`,SAINT:`ST`,ALLEY:`ALY`,PLAZA:`PLZ`,CIRCLE:`CIR`,WALK:`WALK`,ROW:`ROW`,SLIP:`SLIP`,LOOP:`LOOP`,PIER:`PIER`,HEIGHTS:`HTS`,JUNIOR:`JR`,REVEREND:`REV`,DOCTOR:`DR`,MOUNT:`MT`,FORT:`FT`,TUNNEL:`TUNL`,APPROACH:`APPR`,EXIT:`EXIT`,VIADUCT:`VIA`},Qt={"AVENUE OF THE AMERICAS":`6 AV`,"FASHION AVENUE":`7 AV`,"CENTRAL PARK WEST":`CENTRAL PARK W`,"CENTRAL PARK SOUTH":`CENTRAL PARK S`,"CENTRAL PARK NORTH":`CENTRAL PARK N`,"FDR DRIVE":`FDR DR`,"FRANKLIN D. ROOSEVELT EAST RIVER DRIVE":`FDR DR`,"WEST SIDE HIGHWAY":`WEST SIDE HWY`,"JOE DIMAGGIO HIGHWAY":`WEST SIDE HWY`,"ADAM CLAYTON POWELL JR. BOULEVARD":`ADAM C POWELL BLVD`,"FREDERICK DOUGLASS BOULEVARD":`FREDERICK DOUGLASS BLVD`,"MALCOLM X BOULEVARD":`MALCOLM X BLVD`,"MARTIN LUTHER KING JR. BOULEVARD":`M L KING JR BLVD`,"ST. NICHOLAS AVENUE":`ST NICHOLAS AV`,"AVENUE A":`AV A`,"AVENUE B":`AV B`,"AVENUE C":`AV C`,"AVENUE D":`AV D`},$t=new Map;function en(e){if(!e)return``;let t=$t.get(e);if(t!==void 0)return t;let n=e.toUpperCase().replace(/\s+/g,` `).trim(),r;return Qt[n]?r=Qt[n]:(n=n.replace(/\b(\d+)(ST|ND|RD|TH)\b/g,`$1`),n=n.replace(/[.,']/g,``),r=n.split(` `).map(e=>Zt[e]||e).join(` `),r.length>22&&(r=r.slice(0,22).trim())),$t.set(e,r),r}var tn=.914,nn=.13,Q=2.4,rn=4.3,an=3.9;z.nightGlow;var on=2.6,sn=3.2,cn=4.5,ln=2.5,un=.13;function dn(e,t){return new f({name:`props-stairwell`,uniforms:{uTiles:{value:e},uLamp:t.uLamp,uL:{value:6},uW:{value:ln},uD:{value:4.2}},vertexShader:`
      varying vec3 vLocalPos;
      varying vec3 vLocalCam;
      void main() {
        vec3 openingOrigin = vec3(0.0, ${un.toFixed(3)}, 0.0);
        vLocalPos = position - openingOrigin;
        #ifdef USE_INSTANCING
          mat4 im = instanceMatrix;
        #else
          mat4 im = mat4(1.0);
        #endif
        mat4 mw = modelMatrix * im;
        // camera position in the instance's local space (rigid transforms: inverse = transpose of rotation)
        mat4 inv = inverse(mw);
        vLocalCam = (inv * vec4(cameraPosition, 1.0)).xyz - openingOrigin;
        gl_Position = projectionMatrix * viewMatrix * mw * vec4(position, 1.0);
      }
    `,fragmentShader:`
      precision highp float;
      uniform sampler2D uTiles;
      uniform float uLamp, uL, uW, uD;
      varying vec3 vLocalPos;
      varying vec3 vLocalCam;
      // Finite cylinder intersection: continues the real handrails below the virtual opening.
      float railHit(vec3 ro, vec3 rd, vec3 a, vec3 b, float radius) {
        vec3 ba = b - a, oa = ro - a;
        float bb = dot(ba, ba), br = dot(ba, rd), bo = dot(ba, oa);
        float aa = bb - br * br, ab = bb * dot(rd, oa) - bo * br;
        float ac = bb * dot(oa, oa) - bo * bo - radius * radius * bb;
        float disc = ab * ab - aa * ac;
        if (disc < 0.0 || aa < 0.00001) return 1e9;
        float t = (-ab - sqrt(disc)) / aa, y = bo + t * br;
        return t > 0.0 && y > 0.0 && y < bb ? t : 1e9;
      }
      void main() {
        vec3 ro = vLocalPos;               // on the quad (y = 0)
        vec3 rd = normalize(vLocalPos - vLocalCam);
        if (rd.y >= -0.001) { discard; }
        float hx = uL * 0.5, hz = uW * 0.5;
        float t = 1e9; int face = 2;
        float going = uL / 21.0, rise = uD / 21.0;
        // Actual horizontal treads and vertical risers, instead of stripes on an inclined plane.
        for (int i = 0; i < 21; i++) {
          float x0 = -hx + float(i) * going, y0 = -float(i) * rise;
          float tt = (y0 - rise - ro.y) / rd.y;
          float tx = ro.x + rd.x * tt;
          if (tt > 0.0 && tt < t && tx >= x0 && tx <= x0 + going) { t = tt; face = 0; }
          if (abs(rd.x) > 0.00001) {
            float tr = (x0 - ro.x) / rd.x, ty = ro.y + rd.y * tr;
            if (tr > 0.0 && tr < t && ty <= y0 && ty >= y0 - rise) { t = tr; face = 3; }
          }
        }
        if (abs(rd.z) > 0.00001) {
          float tw = ((rd.z < 0.0 ? -hz : hz) - ro.z) / rd.z;
          if (tw > 0.0 && tw < t) { t = tw; face = 1; }
        }
        if (rd.x > 0.00001) {
          float tf = (hx - ro.x) / rd.x;
          if (tf > 0.0 && tf < t) { t = tf; face = 2; }
        }
        // Match the three above-ground steel returns without adding geometry below an opaque street.
        for (int i = 0; i < 3; i++) {
          float z = float(i - 1) * (hz - 0.16);
          vec3 a = vec3(-hx + (i == 1 ? 0.17 : 0.23), i == 1 ? 0.945 : 0.765, z);
          float slope = i == 1 ? (uD / uL) * (0.945 / 0.95) : 0.765 / 1.10;
          vec3 b = vec3(hx - 0.15, a.y - (hx - 0.15 - a.x) * slope, z);
          float tr = railHit(ro, rd, a, b, i == 1 ? 0.024 : 0.022);
          if (tr < t) { t = tr; face = 4; }
        }
        vec3 p = ro + rd * t;
        // depth below ground where we hit (0..uD)
        float depth = clamp(-p.y / uD, 0.0, 1.0);
        vec3 col;
        if (face == 0 || face == 3) {
          float edge = fract((p.x + hx) / going) * going;
          float grain = sin(p.x * 193.0 + sin(p.z * 147.0)) * sin(p.z * 237.0) * 0.018;
          col = vec3(0.42, 0.41, 0.38) * (face == 0 ? 1.0 : 0.58) + grain;
          // Worn 3 cm nosing, never a broad luminous yellow tread.
          float aa = max(fwidth(edge), 0.001);
          float yellow = face == 0 ? 1.0 - smoothstep(0.028 - aa, 0.028 + aa, edge) : 0.0;
          // Continue the landing's end markings on the first exposed step; deeper nosings remain.
          if (p.x < -hx + going * 2.0) yellow *= smoothstep(hz - 0.23, hz - 0.20, abs(p.z));
          col = mix(col, vec3(0.57, 0.43, 0.12), yellow * 0.86);
        } else if (face == 4) {
          col = vec3(0.46, 0.49, 0.48);
        } else if (face == 2) {
          // Recessed throat below the far fascia, not a bright tiled wall sealing the stair shut.
          // This is dark surface albedo; retain the existing fluorescent/daylight response below.
          col = vec3(0.055, 0.059, 0.055);
        } else {
          // Stacked six-inch wall tiles, with 2 mm grout. Sample only cream rows of
          // the existing subway tile map, avoiding its repeated green bands and baked brick joints.
          vec2 wall = vec2(p.x, -p.y) / 0.1524;
          vec2 cell = floor(wall), f = fract(wall);
          float row = 2.0 + mod(cell.y, 9.0);
          // Texture v runs bottom-up; these are canvas rows 5–13, clear of the green band.
          float stagger = mod(row + 1.0, 2.0) * 0.5;
          vec2 tuv = vec2((mod(cell.x, 8.0) + stagger + 0.2 + f.x * 0.6) / 8.0,
                          (row + 0.2 + f.y * 0.6) / 16.0);
          col = texture2D(uTiles, tuv).rgb;
          vec2 border = min(f, 1.0 - f), aa = max(fwidth(wall), vec2(0.002));
          vec2 tile = smoothstep(vec2(0.0065), vec2(0.0065) + aa, border);
          col *= mix(0.48, 1.0, tile.x * tile.y);
        }
        // light: daylight falls off with depth; a fluorescent tube at the bottom glows warm-white
        float day = (1.0 - uLamp);
        float ambient = mix(0.05, 0.9, pow(1.0 - depth, 1.6)) * day + 0.04;
        float tube = 0.9 * smoothstep(0.25, 1.0, depth) * (0.35 + 0.65 * uLamp);
        col *= ambient + tube * vec3(1.0, 0.97, 0.85);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,side:0,depthWrite:!0})}var fn=[[40.7557,-73.987,`N Q R W 1 2 3 7`,`Times Sq–42 St`,`Subway Station`],[40.7574,-73.9899,`A C E`,`42 St–Port Authority`,`Bus Terminal Station`],[40.7541,-73.9844,`B D F M 7`,`42 St–Bryant Park`,`5 Avenue`],[40.7527,-73.9772,`4 5 6 7`,`Grand Central`,`42 Street Station`],[40.7497,-73.9878,`B D F M N Q R W`],[40.7506,-73.9911,`1 2 3`],[40.7522,-73.9932,`A C E`],[40.7349,-73.9906,`4 5 6 L N Q R W`],[40.73,-73.9915,`6`],[40.7305,-73.9925,`N R W`],[40.7323,-74.0003,`A C E B D F M`],[40.7331,-74.0071,`1`],[40.7378,-73.9982,`1 2 3`],[40.7381,-73.9963,`F M L`],[40.7404,-74.002,`A C E L`],[40.7188,-74.0006,`N Q R W J Z 6`],[40.7226,-74.0062,`1`],[40.7102,-74.0079,`2 3 4 5 A C J Z`],[40.7069,-74.0091,`2 3`],[40.7075,-74.0119,`4 5`],[40.7049,-74.0141,`4 5`],[40.715,-74.0092,`1 2 3`],[40.7681,-73.9819,`A B C D 1`],[40.7646,-73.9806,`N Q R W`],[40.7645,-73.9733,`N R W`],[40.7626,-73.9675,`4 5 6 N R W`],[40.7576,-73.9694,`E M 6`],[40.7571,-73.972,`6`],[40.7587,-73.9812,`B D F M`],[40.7597,-73.9843,`N R W`],[40.7623,-73.986,`C E`],[40.7616,-73.9838,`1`],[40.7433,-73.9842,`6`],[40.7471,-73.9935,`1`],[40.7454,-73.9886,`R W`],[40.7398,-73.9865,`6`],[40.744,-73.9954,`1`],[40.7429,-73.9925,`F M`],[40.7413,-73.9895,`R W`],[40.7458,-73.9987,`C E`],[40.8076,-73.9457,`2 3`],[40.8043,-73.9375,`4 5 6`],[40.7838,-73.9799,`1`],[40.7785,-73.9819,`1 2 3`],[40.7795,-73.9556,`4 5 6`],[40.7184,-73.9882,`F J M Z`],[40.7237,-73.9899,`F`],[40.7257,-73.9945,`6 B D F M`],[40.7222,-73.9973,`6`],[40.7262,-74.0037,`C E`],[40.7244,-73.9977,`N R W`],[40.7139,-73.9902,`F`],[40.7183,-73.9938,`B D`],[40.7204,-73.9938,`J Z`],[40.7134,-74.0067,`R W`],[40.7132,-74.0041,`4 5 6 J Z`],[40.7115,-74.0121,`R W 1`],[40.7123,-74.0099,`E`],[40.7076,-74.0132,`1`],[40.7072,-74.0131,`R W`],[40.7018,-74.0132,`1`],[40.7032,-74.0129,`R W`],[40.7192,-74.0067,`1`],[40.7285,-74.0053,`1`],[40.7554,-74.0018,`7`],[40.7539,-73.9819,`7`,`5 Avenue`,`42 Street Station`],[40.7461,-73.9822,`6`],[40.7627,-73.9679,`4 5 6`],[40.7733,-73.964,`6`],[40.7686,-73.966,`6`],[40.7744,-73.9829,`1 2 3`],[40.7854,-73.9762,`1`],[40.793,-73.9721,`1`],[40.7757,-73.9762,`B C`],[40.7816,-73.9722,`B C`],[40.7888,-73.9695,`B C`]],pn=null,mn=[[/lexington/i,`6`],[/park av/i,`6`],[/(seventh|7th) av/i,`1 2 3`],[/varick|west broadway|greenwich st/i,`1`],[/(eighth|8th) av|central park west/i,`A C E`],[/(sixth|6th) av|americas/i,`B D F M`],[/houston/i,`F`],[/canal/i,`N Q R W`],[/14th|fourteenth/i,`L`],[/42nd/i,`7`],[/nassau|fulton|william/i,`J Z`],[/(second|2nd) av/i,`Q`],[/lafayette|bowery/i,`6`],[/broadway/i,`N R W`],[/lenox|malcolm/i,`2 3`]],hn=[`1`,`6`,`N R W`,`A C E`,`B D F M`,`L`,`4 5 6`,`2 3`,`F`,`R W`];function gn(e,t,n,r){pn||=fn.map(([e,t,n,r,i])=>({...j(t,e),lines:r?`${n}|${r}|${i??`Subway Station`}`:n}));let i=null,a=67600;for(let n of pn){let r=(n.x-e)**2+(n.z-t)**2;r<a&&(a=r,i=n.lines)}if(i)return i;if(n){for(let[e,t]of mn)if(e.test(n))return t}return hn[Math.floor(L(Math.round(r*1e6),7)*hn.length)]}var _n=.15,vn=new Set([`motorway`,`trunk`,`primary`,`secondary`,`tertiary`,`residential`,`pedestrian`,`living_street`,`unclassified`]),yn=new Set([`PIZZA`,`BAGELS`,`DINER`,`COFFEE`]),bn=1;function xn(e,t,n){let r=1/0;for(let i=1;i<n.length;i++){let a=n[i-1],o=n[i],s=o[0]-a[0],c=o[1]-a[1],l=s*s+c*c,u=l?Math.max(0,Math.min(1,((e-a[0])*s+(t-a[1])*c)/l)):0,d=(a[0]+u*s-e)**2+(a[1]+u*c-t)**2;d<r&&(r=d)}return Math.sqrt(r)}function*Sn(e,t,n,r,i){let a=t.roads.filter(e=>!e.tunnel&&vn.has(e.cls));if(!a.length)return;let o=(e,t,i,a,o,s=1)=>{let c=n.kinds.get(e);c||n.kinds.set(e,c=new It),c.push(t,i,a,o,s),r?.(e,t,i,a,o)};for(let n of t.buildings){if(yield,!Number.isFinite(n.height))continue;let t=ie(n.footprint);if(!t)continue;let r=t[0],s=Math.max(3,n.height),c=te(n.id),l=N(n,c),u=ne[l.style],d=s<=30,f=d&&l.commercial&&l.style!==9&&l.style!==10&&l.gfH>=3.5,p=d&&(l.style===0||l.style===1),m=M(c,110,0,0)<.42;if(!(!f&&!p&&!m))for(let t=0;t<r.length;t++){let n=r[t],d=r[(t+1)%r.length],h=d[0]-n[0],g=d[1]-n[1],_=Math.hypot(h,g);if(_<3)continue;let v=h/_,y=g/_,b=y,x=-v,S=(n[0]+d[0])/2,C=(n[1]+d[1])/2,w=null,T=1/0;for(let e of a){let t=xn(S+b*2.5,C+x*2.5,e.pts);t<=e.width/2+7.5&&t<T&&(T=t,w=e)}if(!w)continue;let E=xn(S,C,w.pts)-w.width/2,D=t+1,O=Math.atan2(-b,-x),k=(e,t)=>({x:n[0]+v*e+b*t,z:n[1]+y*e+x*t}),A=Math.max(_n,e.physics.groundHeight(S+b*1.5,C+x*1.5));if(f&&_>=4){let{n:e,w:t}=le(_,c,D),n=l.gfH-1.6;for(let r=0;r<e;r++){if(!(t>3&&M(c,21,D,r)<.45))continue;let e=r*t+.25,i=t-.5,a=Math.max(3,Math.round(i/1.04));for(let t=0;t<a;t++){let r=k(e+(t+.5)*(i/a),0);o(`awningHem`,r.x,n,r.z,O)}let s=Math.max(2,Math.round(i/2.4)+1);for(let t=0;t<s;t++){let r=k(e+.12+(i-.24)*(t/(s-1)),0);o(`awningRig`,r.x,n,r.z,O)}}}if(m&&E>=1.8&&M(c,111,D,0)<.36){let t=k(_*(.28+.44*M(c,112,D,0)),Math.max(.8,E-.75));o(`trashPile`,t.x,Math.max(_n,e.physics.groundHeight(t.x,t.z)),t.z,O+(M(c,113,D,0)-.5)*.5)}if(f&&_>=4&&E>=3.4){let{n:e,w:t}=le(_,c,D);for(let n=0;n<e;n++){if(t<3.6)continue;let e=M(c,21,D,n),r=!(e<.45)&&e<.8,a=F[Math.floor(M(c,25,D,n)*F.length)],s=M(c,92,D,n);if(!(yn.has(a)?s<.85:!r&&s<.4))continue;let l=n*t,u=(n+1)*t,d=l+t*(.15+.7*M(c,23,D,n)),f=[];for(let e=l+.75;e<=u-.75;e+=bn)Math.abs(e-d)>=1.25&&f.push(e);if(f.length<2)continue;i&&(i.cafes++,i.tables+=f.length);for(let e=0;e<f.length;e++){let t=k(f[e],.75);o(`cafeTable`,t.x,A,t.z,O+(M(c,94,D,e)-.5)*.25)}let p=M(c,95,D,n)<.55?`umbrellaCream`:`umbrellaGreen`;for(let e=0;e+1<f.length;e+=2){if(f[e+1]-f[e]>1.01)continue;let t=k((f[e]+f[e+1])/2,.82);o(p,t.x,A,t.z,O+M(c,98,D,e)*Math.PI)}let m=f[0]-.45,h=f[f.length-1]+.45;for(let e=m+.45;e<=h-.45+.01;e+=1.1){if(Math.abs(e-d)<1.45)continue;let t=k(e,1.3);o(`cafePlanter`,t.x,A,t.z,O),o(`shrub`,t.x,A+.4,t.z,O+M(c,99,D,Math.round(e*10))*Math.PI,.42)}let g=k(d+(d+1<u-.3?1:-1)*.95,.55);o(`sandwichBoard`,g.x,A,g.z,O+Math.PI/2)}}if(p){let e=ee(l.style,_);for(let t=1;t<12&&e.count>0;t++){let n=P(l.style,t,l.gfH,l.floorH,s);if(!n){if(t>1)break;continue}for(let r=0;r<e.count;r++){if(M(c,70,D*128+r,t)<u.acFrac)continue;let a=M(c,96,D*128+r,t);if(a>(l.style===1?.2:.12))continue;i&&i.flowerBoxes++;let s=k(e.offset+(r+.5)*e.spacing,.02);o(a<.07?`flowerBox2`:`flowerBox`,s.x,n.bottom,s.z,O)}}}}}}var Cn=new Set([`motorway`,`trunk`,`primary`,`secondary`]),wn=new Set([`primary`,`secondary`,`tertiary`,`residential`,`unclassified`]);function Tn(e,t){if(L(e.id,817)>=.15)return null;let n=e.footprint[0];if(!n||n.length<3)return null;let r=null;for(let i=0;i<n.length;i++){let a=n[i],o=n[(i+1)%n.length],s=o[0]-a[0],c=o[1]-a[1],l=Math.hypot(s,c);if(!Number.isFinite(l)||l<3)continue;let u=(a[0]+o[0])/2,d=(a[1]+o[1])/2;for(let n of t){if(n.tunnel||n.bridge||!wn.has(n.cls)||!Number.isFinite(n.width)||n.width<=0)continue;let t=1/0,i=0,a=0;for(let e=1;e<n.pts.length;e++){let r=n.pts[e-1],o=n.pts[e],s=o[0]-r[0],c=o[1]-r[1],l=s*s+c*c;if(!l)continue;let f=Math.max(0,Math.min(1,((u-r[0])*s+(d-r[1])*c)/l)),p=r[0]+s*f,m=r[1]+c*f,h=Math.hypot(u-p,d-m);h<t&&(t=h,i=p,a=m)}let o=t-n.width/2;if(o<1.5||o>12||r&&o>=r.clearance)continue;let f=(u-i)/t,p=(d-a)/t;if(Math.abs((s*f+c*p)/l)>.35)continue;let m=i+f*(n.width/2+.65),h=a+p*(n.width/2+.65);![m,h,f,p].every(Number.isFinite)||ae(m,h,e.footprint)||(r={kind:`trash_bags`,ref:e.id,x:m,z:h,yaw:Math.atan2(f,p),clearance:o,bags:3+Math.floor(L(e.id,818)*6),dayBags:L(e.id,819)<.24?1+Math.floor(L(e.id,820)*2):0,seed:L(e.id,821)})}}return r}var En=new WeakMap;function Dn(e,t){let n=Math.cos(e.yaw),r=Math.sin(e.yaw),i=([t,i])=>[(t-e.x)*n-(i-e.z)*r,(t-e.x)*r+(i-e.z)*n],a=(e,t)=>e>=-1.37&&e<=1.18&&t>=-.47&&t<=1.72;for(let i of[-1.37,0,1.18])for(let a of[-.47,.62,1.72])if(ae(e.x+i*n+a*r,e.z-i*r+a*n,t.footprint))return!0;for(let e of t.footprint)for(let t=0;t<e.length;t++){let n=i(e[t]),r=i(e[(t+1)%e.length]);if(a(n[0],n[1]))return!0;let o=0,s=1;for(let[e,t,i]of[[0,-1.37,1.18],[1,-.47,1.72]]){let a=r[e]-n[e];if(Math.abs(a)<1e-9)(n[e]<t||n[e]>i)&&(s=-1);else{let r=(t-n[e])/a,c=(i-n[e])/a;o=Math.max(o,Math.min(r,c)),s=Math.min(s,Math.max(r,c))}}if(o<=s)return!0}return!1}function*On(e,t,n){let r=En.get(e.world);r||En.set(e.world,r=new Map);for(let[t,n]of r)(e.world.tiles?.get(n.tile.key)!==n.tile||!n.store.kinds.has(`trash_bags`))&&r.delete(t);let i=new Set;for(let a of t.buildings){if(yield,i.has(a.id)||r.has(a.id)||(i.add(a.id),L(a.id,817)>=.15||!a.footprint[0]?.length))continue;let o=re(a.footprint[0]),s=Math.max(...a.footprint[0].map(e=>Math.hypot(e[0]-o[0],e[1]-o[1])))+30,c=new Map(t.roads.map(e=>[e.id,e]));for(let t of e.world.roadsNear?.(o[0],o[1],s)??[])c.set(t.id,t);let l=Tn(a,[...c.values()].sort((e,t)=>e.id-t.id));if(!l||l.clearance<2.37||[...new Set([...t.buildings,...e.world.buildingsNear?.(l.x,l.z,3)??[]])].some(e=>Dn(l,e))||t.crossings.some(e=>Math.hypot(e.x-l.x,e.z-l.z)<3+e.width/2)||t.props.some(e=>![`manhole`,`sewer_grate`,`subway_grate`,`fire_escape`,`scaffolding`].includes(e.kind)&&Math.hypot(e.x-l.x,e.z-l.z)<(e.kind===`subway_entrance`?5:e.kind===`bus_stop`||e.kind===`citibike_dock`?4:1.65)))continue;let u=e.physics.groundHeight(l.x,l.z),d=Math.max(.15,Number.isFinite(u)?u:0),f=n.kinds.get(`trash_bags`);f||n.kinds.set(`trash_bags`,f=new It),f.push(l.x,d,l.z,l.yaw,1,l.bags,l.dayBags,l.seed,0),r.set(a.id,{tile:t,store:n})}}function $(e,t,n){let r=null,i=2025;for(let a of e)if(!(a.tunnel||n&&en(a.name)!==n))for(let e=1;e<a.pts.length;e++){let n=a.pts[e-1],o=a.pts[e],s=o[0]-n[0],c=o[1]-n[1],l=s*s+c*c;if(!l)continue;let u=Math.max(0,Math.min(1,((t.x-n[0])*s+(t.z-n[1])*c)/l)),d=n[0]+u*s,f=n[1]+u*c,p=(d-t.x)**2+(f-t.z)**2;p<i&&(i=p,r={road:a,x:d,z:f,dx:s/Math.sqrt(l),dz:c/Math.sqrt(l)})}return r}function kn(e,t){let n=null,r=1;for(let i of t){if(i.id!==e.ref||!Number.isFinite(i.height))continue;let t=i.footprint[0];if(!t||t.length<3)continue;let a=0;for(let e=0;e<t.length;e++){let n=t[e],r=t[(e+1)%t.length];a+=n[0]*r[1]-r[0]*n[1]}if(!(!Number.isFinite(a)||Math.abs(a)<1e-8))for(let o=0;o<t.length;o++){let s=t[o],c=t[(o+1)%t.length],l=c[0]-s[0],u=c[1]-s[1],d=Math.hypot(l,u);if(!Number.isFinite(d)||d<2.6+.2)continue;let f=Math.max(0,Math.min(1,((e.x-s[0])*l+(e.z-s[1])*u)/(d*d))),p=s[0]+l*f,m=s[1]+u*f,h=(p-e.x)**2+(m-e.z)**2;if(h>=r)continue;let g=(on/2+.1)/d,_=Math.max(g,Math.min(1-g,f)),v=a<0?-1:1;r=h,n={x:s[0]+l*_,z:s[1]+u*_,yaw:Math.atan2(-v*u,v*l),length:2*Math.min(_,1-_)*d,height:i.height}}}return n}function An(e){return{key:e.key,cx:(e.tx+.5)*256,cz:(e.tz+.5)*256,kinds:new Map,signs:[],signals:[],lights:[],steam:[]}}function*jn(e,t,n,r,i,a,o,s){let c=new Set;for(let l of t.props){if(yield,![l.x,l.z,l.yaw].every(Number.isFinite))continue;let u=`${l.kind}:${l.x}:${l.z}:${l.yaw}`;if(c.has(u))continue;c.add(u);let d=L(Math.round(l.x*100),Math.round(l.z*100)),f=l.yaw,p=l.x,m=l.z,h=e.physics.groundHeight(l.x,l.z),g=Number.isFinite(h)?h:0,_=(e,t)=>({x:p+e*Math.cos(f)+t*Math.sin(f),z:m-e*Math.sin(f)+t*Math.cos(f)}),v=(e,t=0,r=0,i=0,a=f,o=[0,0,0,0],c=1)=>{let l=n.kinds.get(e);l||n.kinds.set(e,l=new It);let u=_(t,i);l.push(u.x,g+r,u.z,a,c,...o),s?.(e,u.x,g+r,u.z,a)},y=(e,t,r,i,a,o)=>{n.lights.push({..._(e,r),y:g+t,groundY:g,kind:i,poolX:a,poolZ:o,yaw:f,seed:d})},b=(e,t)=>n.steam.push({x:l.x,y:g+t,z:l.z,kind:e,seed:d*1e6});switch(l.kind){case`street_lamp`:if(v(d<.5?`lampLED`:`lamp`,0,0,0,f,[+(d<.5),0,0,0]),y(B.x,B.y,B.z,+(d<.5),7,9),d<.3&&v(`regSign`,0,2.2,.12,f,r.fixed(d<.15?`no-standing`:`alt-side`)),d>.9&&v(`muni`,2,0,0,f,r.fixed(`muni`)),d>=.3&&d<.62){let e=$(t.roads,l);if(e){let t=Math.cos(f),n=Math.sin(f),i=e.dx*6,a=e.dz*6,o=i*t-a*n,s=i*n+a*t;v(`signPost`,o,0,s,f,r.fixed(`solid-white`)),v(`regSign`,o,2,s+.06,f,r.fixed(d<.46?`alt-side`:`no-standing`))}}break;case`traffic_signal`:{let r=Xt(l,e.world.roadsNear?.(l.x,l.z,45)??t.roads);if(r&&!i.claimApproach(r,t.key)||i.poles.some(e=>Math.hypot(e.x-l.x,e.z-l.z)<.5&&e.fx*-Math.sin(f)+e.fz*-Math.cos(f)>.95))break;let s=i.addPole(l.x,l.z,f,t.key),c=o();a.set(c,s),n.signals.push(c),v(`signal`,0,0,0,f,[0,0,0,c]),v(`pedHead`,-.2,2.35,-.15,f,[0,0,0,c]),v(`pedHead`,.15,2.35,.2,f+Math.PI/2,[1,0,0,c]),d<.25&&v(`signalCabinet`,-1,0,.5);break}case`street_sign`:{let i=(l.text??``).split(`|`).map(en).filter(Boolean).slice(0,2),a=t.props.find(n=>n.kind===`traffic_signal`&&Math.hypot(n.x-l.x,n.z-l.z)<.5&&Xt(n,e.world.roadsNear?.(n.x,n.z,45)??t.roads)?.incoming!==!1),o=Math.cos(f),s=Math.sin(f),c=a?(a.x-l.x)*o-(a.z-l.z)*s:0,u=a?(a.x-l.x)*s+(a.z-l.z)*o:0,p=a?.14:.06,m=(e,t,n)=>{let r=t*Math.cos(e)+n*Math.sin(e),i=-t*Math.sin(e)+n*Math.cos(e);return{x:r*o-i*s,z:r*s+i*o}};a||v(`signPost`,0,0,0,f,r.fixed(`solid-white`)),i.forEach((e,i)=>{let a=$(t.roads,l,e),o=a?Math.atan2(-a.dz,a.dx):f+i*Math.PI/2;if(n.signs.push(`blade:${e}`),v(`streetBlade`,c,3.05+i*.24,u,o,r.streetBlade(e)),a?.road.oneway){let e=m(o,nn+tn/2,p);v(`oneWay`,c+e.x,2.72,u+e.z,o,r.fixed(`one-way-right`))}}),d<.3&&v(`regSign`,c,2,u+p,f,r.fixed(`no-standing`));let h=$(t.roads,l);if(h?.road.cls===`residential`&&!t.props.some(e=>e.kind===`traffic_signal`&&Math.hypot(e.x-l.x,e.z-l.z)<35)&&v(`stopSign`,1,0,0,Math.atan2(-h.dx,-h.dz),r.fixed(`stop`)),h&&!t.props.some(e=>e.kind===`trash_can`&&Math.hypot(e.x-l.x,e.z-l.z)<16)){let e=t.props.find(e=>e.kind===`traffic_signal`&&Math.hypot(e.x-l.x,e.z-l.z)<10),n=e&&(e.x-l.x)*h.dx+(e.z-l.z)*h.dz>0?-1:1,r=l.x-h.x,i=l.z-h.z,a=Math.hypot(r,i)||1,c=h.dx*1.4*n+r/a*.5,u=h.dz*1.4*n+i/a*.5;v(`wireBasket`,c*o-u*s,0,c*s+u*o,Math.atan2(-r,-i))}if(h&&Cn.has(h.road.cls)&&d<.5){let e=l.x-h.x,t=l.z-h.z,n=Math.hypot(e,t)||1,r=d<.25?1:-1,i=3+ +(d>.38);for(let a=0;a<i;a++){let i=r*(2.6+a*.52),c=h.dx*i+e/n*.55,u=h.dz*i+t/n*.55,d=(L(a,Math.round(l.x*100),Math.round(l.z*100))-.5)*.22;v(`newsRack`,c*o-u*s,0,c*s+u*o,Math.atan2(-e,-t)+d)}}break}case`hydrant`:v(d<.18?`hydrantRed`:`hydrant`);break;case`trash_can`:v(d<.2?`steelBasket`:`wireBasket`);break;case`bench`:v(`bench`);break;case`mailbox`:v(`mailbox`);break;case`bike_rack`:v(d<.4?`bikeLocked`:`bikeRack`);break;case`bollard`:v(`bollard`,0,Math.max(0,.15-g),0,d*Math.PI*2,[0,0,0,0],.97+d*.06);break;case`planter`:v(`planter`),v(`shrub`);break;case`phone_booth`:v(`link`,0,0,0,f,r.fixed(`linknyc-screen`));break;case`newsstand`:v(`newsstand`,0,0,0,f,r.fixed(`newsstand-front`));break;case`food_cart`:v(`foodCart`,0,0,0,f,r.fixed(`food-cart-menu`));break;case`con_ed_stack`:v(`stack`),b(2,4.4);break;case`manhole`:d<.12&&b(0,.08);break;case`sewer_grate`:d<.06&&b(0,.08);break;case`subway_grate`:b(1,.08);break;case`bus_stop`:{let e=$(t.roads,l);e&&(f=Math.atan2(l.x-e.x,l.z-e.z));let i=(l.text??``).split(/[;,\s]+/).filter(Boolean).slice(0,4);n.signs.push(`bus:${i.join(` `)}`),v(`busShelter`,0,0,0,f,r.fixed(`bus-shelter-ad`)),v(`shelterGlass`),v(`busSign`,-2.75,0,-.55,f,r.busSign(i));break}case`citibike_dock`:{let e=$(t.roads,l);f=e?Math.atan2(l.x-e.x,l.z-e.z):f+Math.PI/2;let n=Math.max(10,Math.min(20,Math.round((l.len??12)/.75)));for(let e=0;e<n;e++)v(L(e,Math.round(d*1e6))<.75?`citiBike`:`citiEmpty`,(e-n/2)*.75);v(`citiKiosk`,n*.375+1,0,0,f,r.fixed(`citibike-panel`));break}case`subway_entrance`:{let e=$(t.roads,l);e&&(f=Math.atan2(-e.dz,e.dx));let i=l.text?.trim()&&/^[A-Z0-9 ]+$/.test(l.text.trim())&&l.text.trim().length<=12?l.text.trim():gn(l.x,l.z,e?.road.name,d);n.signs.push(`subway:${i}`),v(`subway`,0,0,0,f,r.subwaySign(i)),v(`stairwell`,0,.025);for(let e of[-1,1])v(`globe`,-3,0,e*(ln/2+.12)),y(-3,1.98,e*(ln/2+.12),3,1.2,1.2);break}case`scaffolding`:case`fire_escape`:{f+=Math.PI/2;let n=Number.isFinite(l.len)?Math.max(2.4,Math.min(160,l.len)):7.2;if(l.kind===`scaffolding`){let e=Math.max(1,Math.round(n/Q));for(let t=0;t<e;t++){let n=(t-e/2)*Q,r=L(t,Math.round(d*1e6))<.7?0:.5;v(`shed`,n,0,0,f,[r,0,1,1]),d<.3&&v(`shedNet`,n),y(n+Q/2,rn-.35,-an/2,2,Q*.7,2)}v(`shedEnd`,-e*Q/2,0,0,f,[.5,0,1,1]),v(`shedEnd`,e*Q/2,0,0,f,[0,0,1,1]),v(`shedPost`,e*Q/2)}else{let r=kn(l,t.buildings)??kn(l,e.world.buildingsNear(l.x,l.z,5));if(!r)break;p=r.x,m=r.z,f=r.yaw;let i=Math.max(0,Math.min(20,Math.floor((r.height-1.2-cn)/sn)+1)),a=Math.max(1,Math.min(4,Math.floor(n/6),Math.floor((r.length-on-.2)/5)+1));for(let e=0;e<a;e++){let t=(e-(a-1)/2)*5;for(let e=1;e<=i;e++)v(e===1?`escapeBase`:e%2?`escapeStair`:`escapeReverse`,t,cn+(e-1)*sn,.015);i>0&&v(`escapeLadder`,t,cn,.015);for(let n=2;n<=i;n++)L(e*31+n,Math.round(d*1e6),7)<.3&&v(`escapePlants`,t,cn+(n-1)*sn,.015)}}break}}}yield*Mn(e,t,n,s),yield*On(e,t,n),yield*Sn(e,t,n,s)}function*Mn(e,t,n,r){let i=n.kinds.get(`treeGuard`),a=0,o=t.parks??[];for(let s of t.trees??[]){if(![s.x,s.z].every(Number.isFinite)||fe(s.x,s.z,3)<.5||o.some(e=>de(s.x,s.z,e)))continue;a++&31||(yield);let c=Nn(t,s.x,s.z),l=e.physics.groundHeight(s.x,s.z),u=Math.max(_n,Number.isFinite(l)?l:_n)+.004;i||n.kinds.set(`treeGuard`,i=new It),i.push(s.x,u,s.z,c,1,0,0,0,0),r?.(`treeGuard`,s.x,u,s.z,c)}}function Nn(e,t,n){let r=144,i=0;for(let a of e.roads){if(a.tunnel)continue;let e=a.pts;for(let a=1;a<e.length;a++){let o=e[a-1],s=e[a],c=s[0]-o[0],l=s[1]-o[1],u=c*c+l*l;if(!u)continue;let d=Math.max(0,Math.min(1,((t-o[0])*c+(n-o[1])*l)/u)),f=(o[0]+d*c-t)**2+(o[1]+d*l-n)**2;f<r&&(r=f,i=Math.atan2(-l,c))}}return i}var Pn=class{ctx;body=null;key;count=0;constructor(e,t){this.ctx=e,this.key=`props:${t}`}add=(e,t,n,r,i)=>{let{physics:a}=this.ctx,o=a.RAPIER,s=(e,a,s,c=a/2,l=0,u=0)=>{this.addShape(o.ColliderDesc.cuboid(e/2,a/2,s/2),t+l*Math.cos(i)+u*Math.sin(i),n+c,r-l*Math.sin(i)+u*Math.cos(i),i)},c=(e,a)=>this.addShape(o.ColliderDesc.cylinder(a/2,e),t,n+a/2,r,i);switch(e){case`planter`:s(1.2,.6,1.2);break;case`bollard`:c(.11,.96);break;case`wireBasket`:c(.3,.78);break;case`steelBasket`:c(.3,1.1);break;case`cafeTable`:c(.31,.73),s(.95,.9,.42,.45,0,.53);break;case`cafePlanter`:s(.9,.95,.34);break;case`sandwichBoard`:s(.6,.95,.42);break;case`umbrellaCream`:case`umbrellaGreen`:c(.26,.06);break;case`bench`:s(1.8,.48,.56,.24,0,-.035),s(1.8,.44,.12,.7,0,.16);break;case`newsstand`:s(3.7,2.8,1.8);break;case`link`:s(.3,2.9,.93);break;case`muni`:s(.3,1.56,.28);break;case`citiKiosk`:s(.5,1.85,.4),s(.9,1.1,.06,1.2,.7)}};addShape(e,t,n,r,i){let a=this.ctx.physics;this.body??=a.world.createRigidBody(a.RAPIER.RigidBodyDesc.fixed().setUserData({surface:`prop`,tile:this.key}));let o=a.world.createCollider(e.setTranslation(t,n,r).setRotation({x:0,y:Math.sin(i/2),z:0,w:Math.cos(i/2)}).setFriction(.8),this.body);a.addTileColliders(this.key,[o],`prop`),this.count++}dispose(){this.ctx.physics.removeTileColliders(this.key),this.body=null,this.count=0}};async function Fn(n){let r=A(n),i=r.job(`props catalogue`),a=new Map,s=new g;s.name=`props`;let u=new Map,d=new Map,p=new ve(r,()=>n.world.ready&&a.size===0,n.quality.level===`mobile`?.25:1),h=new he,_=new Map,v=[],y=new Map,x=new Set,S=new Set,C=new Set,w=!1,T=0,E=0,D=0,O=-1/0,k=n.quality.level,j=k===`low`||k===`mobile`?.6:k===`medium`?.8:1;Ft(n);let ee=n.modules.get(`atmosphere`),M=e=>(C.add(e),e),N=(e={})=>{let t=Pt(n,e);return S.add(t),t},P=N({map:M(new b),name:`props-metal`}),te=N({map:p.texture,atlas:!0,name:`props-sign-atlas`}),ne=N({map:M(new b),atlas:!0,selectiveMap:!0,name:`props-plywood`}),re=N({map:M(new b),selectiveMap:!0,alphaTest:.45,side:2}),ie=N({map:M(new b),alphaTest:.4,side:2}),ae=N({map:M(new b),name:`props-pedestrian`}),le=N({transparent:!0,opacity:.22,depthWrite:!1,side:2}),F=dn(M(new b),Z);ee?.setupMaterial?.(F),S.add(F);let ue=(e,t,n,r,i)=>{let a=_.get(e[t+8]);if(!a)return!1;let o=e[t+5]?1-a.phase:a.phase,s=he.phaseTime(a.cluster,i);return n[r+1]=he.vehicleState(o,s),n[r+2]=he.pedFrame(o,s),!0},de=(e,t,i=P,a=180,o=null,c={})=>{let l=new zt(e,t,o,i,i,{capacity:2048,range:Math.min(n.quality.drawDistance,a*j),farRange:Math.min(n.quality.drawDistance,(o?a*2.5:a)*j),radius:4,castShadow:!1,...c});l.addTo(s),v.push(l),x.add(l);let u=y.get(i);u||(u=n.renderer.compileAsync(l.near,n.camera,n.scene),y.set(i,u)),r.job(`props shader:${e}`).run((function*(){try{yield u}finally{x.delete(l)}})())},fe=n.quality.shadows&&k!==`low`,I=null,pe={base:P,mapped:te,plywood:ne,mesh:re,shrub:ie,ped:ae,glass:le,stairwell:F};try{I=new Worker(new URL(`/world/assets/builder.worker-CU7Og7am.js`,``+import.meta.url),{type:`module`,name:`props`}),I.onmessage=e=>{let t=e.data;if(w||!t.kinds||!t.textures){i.cancel(),t.error&&console.warn(`[props] catalogue failed`,t.error),I?.terminate(),I=null;return}let n=t.kinds,r=t.textures;i.run((function*(){p.update(E),yield;for(let e of[`base`,`plywood`,`mesh`,`shrub`,`ped`,`stairwell`]){let t=M(se(r[e]));yield t;let n=pe[e];if(n instanceof f){let e=n.uniforms.uTiles.value;e.dispose(),C.delete(e),n.uniforms.uTiles.value=t}else{let e=n.map;e?.dispose(),e&&C.delete(e),n.map=t}yield}for(let e of n){let t=oe(e.geometry);yield;let n=e.far?oe(e.far):null;yield,de(e.name,t,pe[e.material],e.range,n,{...e.opts,dynamic:e.opts.dynamic?ue:void 0}),yield}})()),I?.terminate(),I=null};let e=()=>{i.cancel(),I?.terminate(),I=null,console.warn(`[props] catalogue worker failed`)};I.onerror=t=>{t.preventDefault(),e()},I.onmessageerror=e,I.postMessage({shadows:fe,mobile:n.quality.level===`mobile`})}catch(e){i.cancel(),console.warn(`[props] catalogue worker unavailable`,e)}let me=new Wt(n,k===`low`||k===`mobile`?4:k===`medium`?6:12),L=new Kt(n,Z.uLamp,Z.uWet),R=new Yt(n,Z.uLamp);s.add(L.mesh,R.points),n.worldGroup.add(s);let z=[],B=[],V=new c,H=new c(1/0,1/0,1/0),U=new m,W=new l,G=e=>(e.x-V.x)**2+(e.y-V.y)**2+(e.z-V.z)**2;function K(){let e=Array.from(_).sort((e,t)=>e[1].x-t[1].x||e[1].z-t[1].z||e[1].fx-t[1].fx||e[1].fz-t[1].fz);h.resetPoles();for(let[t,n]of e)_.set(t,h.addPole(n.x,n.z,Math.atan2(-n.fx,-n.fz),n.tileKey))}function q(e){L.removeTile(e),a.get(e)?.cancel(),a.delete(e),d.get(e)?.dispose(),d.delete(e);let t=u.get(e);if(t){for(let e of t.signs)p.release(e);for(let e of t.signals)_.delete(e);h.removeTile(e),me.removeSources(t.lights),u.delete(e),t.kinds.clear(),t.lights.length=t.steam.length=0,!w&&t.signals.length&&K(),O=-1/0}}function J(e){if(w)return;q(e.key);let t=An(e);u.set(e.key,t),L.addTile(e.key);let i=new Pn(n,e.key);d.set(e.key,i);let o=r.job(`props:${e.key}`);a.set(e.key,o),o.run((function*(){try{yield*jn(n,e,t,p,h,_,()=>++T,i.add),t.signals.length&&K(),O=-1/0}catch(t){console.warn(`[props] skipped invalid tile`,e.key,t)}finally{a.get(e.key)===o&&a.delete(e.key)}})())}let Y=[n.events.on(`tileLoaded`,J),n.events.on(`tileUnloaded`,q)];for(let e of n.world.tiles.values())J(e);let X=new AbortController,ge=r.job(`props normal map`);return(async()=>{let n=!1;try{let r=await t(e(`/assets/textures/manifest.json`),{signal:X.signal});if(!r.ok)return;let i=(await r.json()).find(e=>e.slug===`metal-painted-white`);if(!i?.files.normal||w)return;let a=await ce(`/${i.path}${i.files.normal}`);if(w){a.dispose();return}M(a),a.wrapS=a.wrapT=o,a.repeat.setScalar(1/Math.max(.1,i.physicalSizeM||1)),n=!0,ge.run((function*(){if(yield a,w){a.dispose();return}P.normalMap=a,P.normalScale.setScalar(.2),P.needsUpdate=!0})())}catch{}finally{n||ge.cancel()}})(),{name:`props`,debugCounts(){let e={atlas:p.stats,tiles:{}},t=new Set(v.map(e=>e.name));for(let[r,i]of u){let a={};for(let e of n.world.tiles.get(r)?.props??[])a[e.kind]=(a[e.kind]??0)+1;e.tiles[r]={source:a,kinds:{},unmapped:[...i.kinds.keys()].filter(e=>!t.has(e))}}n.camera.updateMatrixWorld(),n.camera.getWorldPosition(V),W.multiplyMatrices(n.camera.projectionMatrix,n.camera.matrixWorldInverse),U.setFromProjectionMatrix(W);for(let t of v){let r={};t.gather(u.values(),V,U,n.state.serverTime(),r);for(let[n,i]of Object.entries(r)){let r=u.get(n).kinds.get(t.name),a=0,o=0,s=1/0,c=-1/0;for(let e=0;e<r.count;e++){let t=e*9,n=r.data;n[t+4]===0&&a++,[n[t],n[t+1],n[t+2],n[t+3],n[t+4]].every(Number.isFinite)||o++,s=Math.min(s,n[t+1]),c=Math.max(c,n[t+1])}e.tiles[n].kinds[t.name]={...i,zeroScale:a,invalid:o,minY:s,maxY:c}}}return e},signalFor(e,t,r,i){return w?null:h.signalFor(e,t,r,i,n.state.serverTime())},update(e,t){w||(E=t,D=e,ee?.uniforms?.uNight||(Z.uLamp.value=1-n.time.daylight),ee?.uniforms?.uWetness||(Z.uWet.value=n.state.weather.wetness??0),p.update(t),R.update(t,{speed:n.state.weather.wind,dir:n.state.weather.windDir},n.renderer.getPixelRatio()))},preRender(){if(w)return;n.camera.updateMatrixWorld(),n.camera.getWorldPosition(V),W.multiplyMatrices(n.camera.projectionMatrix,n.camera.matrixWorldInverse),U.setFromProjectionMatrix(W);let e=n.state.serverTime();for(let t of v)x.has(t)||t.gather(u.values(),V,U,e);if(E>=O||V.distanceToSquared(H)>16){z.length=B.length=0;for(let e of u.values())if(!((e.cx-V.x)**2+(e.cz-V.z)**2>520**2)){for(let t of e.lights)G(t)<(300*j)**2&&z.push(t);for(let t of e.steam)G(t)<(180*j)**2&&B.push(t)}z.sort((e,t)=>G(e)-G(t)),B.sort((e,t)=>G(e)-G(t)),R.setEmitters(B.slice(0,k===`low`||k===`mobile`?12:48)),L.set(z,V,300*j),O=E+.25,H.copy(V)}me.assign(z,Z.uLamp.value,D,n.state.screenshotMode),L.mesh.visible=L.mesh.count>0&&Z.uLamp.value>.001},dispose(){if(r.dispose(),!w){w=!0,i.cancel(),I?.terminate(),X.abort(),Y.forEach(e=>e());for(let e of u.keys())q(e);z.length=B.length=0;for(let e of v)e.dispose();me.dispose(),L.dispose(),R.dispose(),p.dispose();for(let e of S)e.dispose();for(let e of C)e.dispose();v.length=0,x.clear(),S.clear(),C.clear(),_.clear(),s.clear(),n.worldGroup.remove(s)}}}}export{Fn as createProps};
//# sourceMappingURL=props-coU--UuE.js.map