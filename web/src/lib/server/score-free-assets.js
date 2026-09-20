/** Remove the retired scoring system from the mirrored client. Keep these guarded
 * edits in sync with the recovered TypeScript; both dev and prepared production
 * assets pass through this transform. Geometry heuristic scores are unrelated. */
const patches = new Map([
  ["world/assets/main-D_3aygO4.js", [
    ["score:0,", ""],
    ["leaderboard:[],", ""],
    ["leaderboard=!1;", ""],
    ["this.leaderboard=n.has(`Tab`)||!!i?.buttons[8],", ""],
    ["this.leaderboard=", ""],
    ["score:a?.score??0,", ""],
    ["i.score=e.score,", ""],
    [",score:e.score", ""],
    [",r.score=e.score", ""],
    [",score:n.score", ""],
    [",e.score=n.score", ""],
    ["  score ${e.state.local.score}", ""],
    ["case`score`:if(this.status!==`welcomed`)break;t.local.score=e.score,n.emit(`score`,e);break;case`leaderboard`:t.leaderboard=e.entries,t.online=e.online,n.emit(`leaderboard`,e);break;", ""],
    ["You are the first to find ${e.name} (+${e.delta})", "You are the first to find ${e.name}"],
    ["Discovered ${e.name} (+${e.delta})", "Discovered ${e.name}"],
    ["`Tab`,", ""],
  ]],
  ["world/assets/ui-BQvfutKN.js", [
    ["scoreVal;popsEl;", ""],
    ["lastScoreShown=-1;scoreTarget=0;scoreShown=0;", ""],
    ["w(`div`,`score-label`,this.tr).textContent=`Score`,this.scoreVal=w(`div`,`score-val num`,this.tr),this.scoreVal.textContent=`0`,", ""],
    ["this.popsEl=w(`div`,`pops`,this.tr),", ""],
    ["update(e){if(this.scoreShown!==this.scoreTarget){let t=this.scoreTarget-this.scoreShown,n=Math.abs(t)<2?t:t*Math.min(1,e*7);this.scoreShown=Math.abs(t)<2?this.scoreTarget:this.scoreShown+n;let r=Math.round(this.scoreShown);r!==this.lastScoreShown&&(this.lastScoreShown=r,this.scoreVal.textContent=r.toLocaleString(`en-US`))}}setScore(e,t=!1){this.scoreTarget=e,t&&(this.scoreShown=e-.5)}popScore(e,t){if(!e)return;let n=w(`div`,`pop`,this.popsEl);for(n.innerHTML=`${e>0?`+`:``}${e.toLocaleString(`en-US`)}<small></small>`,n.lastElementChild.textContent=T(t),e<0&&(n.style.color=`#ff6a6a`),setTimeout(()=>n.remove(),1900);this.popsEl.children.length>4;)this.popsEl.firstElementChild?.remove()}", ""],
    ["var ce=10,G=5,K=650;function q(e){return!e||e===`present`?`Present day`:e.charAt(0).toUpperCase()+e.slice(1)}var le=class{el;panel;body;pin;onlineEl;eraEl;foot;lastKey=``;visible=!1;topN=ce;scoreEls=[];countStart=-1;raf=0;reduced=typeof matchMedia==`function`?matchMedia(`(prefers-reduced-motion: reduce)`):null;constructor(){this.el=document.createElement(`div`),this.el.className=`lb-wrap hidden`,this.panel=document.createElement(`div`),this.panel.className=`lb`,this.panel.innerHTML=`\n      <div class=\"lb-head\">\n        <div class=\"lb-titles\"><div class=\"lb-kicker\">New York <span class=\"lb-era\"></span></div><div class=\"lb-title\">Leaderboard</div></div>\n        <div class=\"lb-online\"><i></i><b></b> in the city</div>\n      </div>\n      <div class=\"lb-cols\"><span>Rank</span><span>Player</span><span>Kills</span><span>Score</span></div>\n      <div class=\"lb-body\"></div>\n      <div class=\"lb-pin\"></div>\n      <div class=\"lb-foot\"><span>Score survives death. Everything else does not.</span><span class=\"hint\">Hold TAB</span></div>`,this.el.appendChild(this.panel),this.body=this.panel.querySelector(`.lb-body`),this.pin=this.panel.querySelector(`.lb-pin`),this.onlineEl=this.panel.querySelector(`.lb-online b`),this.eraEl=this.panel.querySelector(`.lb-era`),this.foot=this.panel.querySelector(`.hint`),this.render([],null,0,``,0,`present`)}get isVisible(){return this.visible}setHint(e){this.foot.textContent=e}setMode(e){let t=e===`death`?G:ce;t!==this.topN&&(this.topN=t,this.panel.classList.toggle(`compact`,e===`death`),this.lastKey=``)}render(e,t,n,r,i,a=`present`){let o=JSON.stringify([e,t,n,r,i,a,this.topN]);if(o===this.lastKey)return;if(this.lastKey=o,this.onlineEl.textContent=String(n),this.eraEl.textContent=`· ${q(a)}`,this.body.textContent=``,this.pin.textContent=``,this.scoreEls=[],!e.length){let e=document.createElement(`div`);e.className=`lb-empty`,e.textContent=`No scores yet. Be the first name on this board.`,this.body.appendChild(e);return}let s=!1;for(let n of e.slice(0,this.topN)){let e=!!t&&n.rank===t.rank&&n.name===t.name;e&&(s=!0),this.body.appendChild(this.row(n,e))}t&&!s&&this.pin.appendChild(this.row(t,!0)),this.countStart>=0&&this.tick()}row(e,t){let n=document.createElement(`div`);n.className=`lb-row${e.rank<=3?` top r${e.rank}`:``}${t?` you`:``}`,n.innerHTML=`<span class=\"rank\"></span><span class=\"who\"><i class=\"on\"></i><span class=\"name\"></span></span><span class=\"k\"></span><span class=\"sc\"></span>`,n.children[0].textContent=String(e.rank);let r=n.children[1];r.lastElementChild.textContent=e.name,e.online&&r.firstElementChild.classList.add(`live`),r.firstElementChild.title=e.online?`in the city`:`gone`,n.children[2].textContent=String(e.kills);let i=n.children[3];return i.textContent=e.score.toLocaleString(`en-US`),this.scoreEls.push({el:i,value:e.score}),n}tick=()=>{if(this.raf=0,this.countStart<0)return;let e=Math.min(1,(performance.now()-this.countStart)/K),t=1-(1-e)**3;for(let e of this.scoreEls)e.el.textContent=Math.round(e.value*t).toLocaleString(`en-US`);e<1?this.raf=requestAnimationFrame(this.tick):this.countStart=-1};show(){this.visible||(this.visible=!0,this.el.classList.remove(`hidden`),!this.reduced?.matches&&(this.countStart=performance.now(),this.raf||=requestAnimationFrame(this.tick)))}hide(){if(this.visible&&(this.visible=!1,this.el.classList.add(`hidden`),this.raf&&cancelAnimationFrame(this.raf),this.raf=0,this.countStart>=0)){this.countStart=-1;for(let e of this.scoreEls)e.el.textContent=e.value.toLocaleString(`en-US`)}}},", "var "],
    ["[`Tab`,`leaderboard`],", ""],
    ["`Your <b>score survives death</b>. Your weapons, armor and car do not.`,", ""],
    ["`Distance driven and time survived count toward your score.`,", ""],
    ["Hold <b>Tab</b> for the leaderboard. Press <b>M</b> for the map.", "Press <b>M</b> for the map."],
    ["<b>Finding a landmark first</b> is worth more than a kill.", "Explore the city to <b>discover landmarks</b>."],
    ["keptVal;", ""],
    ["cd;slot;", "cd;"],
    ["let r=Q(`div`,`kept`,n);r.innerHTML=`<span class=\"lab\">Score kept</span><span class=\"val num\"></span><span class=\"gone\">everything else is gone</span>`,this.keptVal=r.querySelector(`.val`),", ""],
    [",this.slot=Q(`div`,`lb-slot`,this.el)", ""],
    ["show(e,t,n={},r=!1)", "show(e,n={},r=!1)"],
    [",this.keptVal.textContent=t.toLocaleString(`en-US`)", ""],
    ["Changing quality reloads the city. Your score is safe.", "Changing quality reloads the city."],
    ["let x=new le;d.appendChild(x.el);", ""],
    ["te=!1,R=!0,ne=null,re=-1/0,", ""],
    ["t!==`death`&&(D.hide(),x.el.parentElement!==d&&d.appendChild(x.el),x.setHint(`Hold TAB`),x.setMode(`full`))", "t!==`death`&&D.hide()"],
    ["D.show(e,n.local.score,{weapon:i,glyph:i?C(t):null,where:o},r),D.slot.appendChild(x.el),x.setHint(`Your score is still on the board`),x.setMode(`death`),R=!0,Ce(!0)", "D.show(e,{weapon:i,glyph:i?C(t):null,where:o},r)"],
    ["function Ce(t=!1){let n=performance.now()/1e3;!t&&n-re<1||(re=n,e.net.send({t:`leaderboard`}))}", ""],
    ["e.events.on(`score`,e=>{v.setScore(e.score),v.popScore(e.delta,e.reason)}),", ""],
    ["v.setScore(n.local.score,!0),", ""],
    ["e.events.on(`leaderboard`,e=>{ne=e.you,R=!0}),", ""],
    ["`First to find · +${e.delta}`:`${e.kind===`landmark`?`Landmark`:`Neighborhood`} · +${e.delta}`", "`First to find`:e.kind===`landmark`?`Landmark`:`Neighborhood`"],
    ["v.update(t),", ""],
    ["let s=M===`death`||te||M===`none`&&e.input.leaderboard;if(s&&!x.isVisible?(x.show(),R=!0,Ce()):!s&&x.isVisible&&x.hide(),x.isVisible&&R){R=!1;let e=ne;!e&&a.name&&(e=n.leaderboard.find(e=>e.name===a.name)??null),x.render(n.leaderboard,e,n.online,a.name,a.score,n.era)}", ""],
    ["v.setScore(a.score),", ""],
    ["&&!x.isVisible", ""],
    ["openLeaderboard(e=!0){te=e},", ""],
    [",leaderboard:x.isVisible", ""],
    ["#nyc[data-touch=\"active\"] .score-val {font-size:30px}\n", ""],
  ]],
  ["world/assets/nameEntry-CwO3iapZ.js", [
    ["#nyc .lb, ", ""],
    ["[`Tab`,`leaderboard`],", ""],
    ["/* ---- leaderboard ---- */\n#nyc .lb-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }\n#nyc .lb {\n  width: 620px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); overflow: hidden; display: flex; flex-direction: column;\n  border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); text-shadow: none;\n  background: linear-gradient(180deg, rgba(13,15,20,0.9), rgba(8,10,14,0.86));\n  backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2);\n  box-shadow: 0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07);\n  animation: nyc-rise 0.24s cubic-bezier(0.2, 0.8, 0.3, 1);\n}\n#nyc .lb .lb-head { display: flex; align-items: flex-end; justify-content: space-between; padding: 18px 24px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); }\n#nyc .lb .lb-kicker { font-size: var(--t-cap); letter-spacing: 0.26em; text-transform: uppercase; color: var(--dim); font-weight: 600; margin-bottom: 6px; }\n#nyc .lb .lb-kicker .lb-era { color: var(--gold); }\n#nyc .lb .lb-title { font-family: var(--head); font-size: 38px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; line-height: 0.9; }\n#nyc .lb .lb-online { font-size: var(--t-meta); letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); font-weight: 500; padding-bottom: 2px; }\n#nyc .lb .lb-online b { color: var(--fg); font-weight: 700; font-variant-numeric: tabular-nums; }\n#nyc .lb .lb-online i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); margin-right: 8px; box-shadow: 0 0 8px var(--green); vertical-align: 1px; animation: nyc-pulse 2.4s ease-in-out infinite; }\n#nyc .lb .lb-cols, #nyc .lb .lb-row { display: grid; grid-template-columns: 64px 1fr 72px 128px; align-items: center; padding: 0 24px 0 0; }\n#nyc .lb .lb-cols { font-size: var(--t-cap); letter-spacing: 0.22em; text-transform: uppercase; color: var(--dimmer); font-weight: 600; padding-top: 10px; padding-bottom: 6px; }\n#nyc .lb .lb-cols > :first-child { padding-left: 24px; }\n#nyc .lb .lb-cols > :nth-child(n+3) { text-align: right; }\n#nyc .lb .lb-body { overflow-y: auto; }\n#nyc .lb .lb-row { height: 42px; border-top: 1px solid rgba(255,255,255,0.05); position: relative; }\n#nyc .lb .lb-row .rank { font-family: var(--head); font-size: 24px; font-weight: 800; color: var(--dimmer); padding-left: 24px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }\n#nyc .lb .lb-row .who { display: flex; align-items: center; gap: 10px; min-width: 0; padding-right: 12px; }\n#nyc .lb .lb-row .name { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n#nyc .lb .lb-row .on { flex: none; width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.14); }\n#nyc .lb .lb-row .on.live { background: var(--green); box-shadow: 0 0 6px rgba(95,217,119,0.7); }\n#nyc .lb .lb-row .sc { font-family: var(--head); font-size: 24px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }\n#nyc .lb .lb-row .k { font-size: 13px; color: var(--dim); text-align: right; font-variant-numeric: tabular-nums; }\n#nyc .lb .lb-row.top::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }\n#nyc .lb .lb-row.top .rank { font-size: 30px; color: var(--fg); }\n#nyc .lb .lb-row.r1 { height: 56px; background: linear-gradient(90deg, rgba(242,193,78,0.13), rgba(242,193,78,0.03) 45%, transparent 75%); }\n#nyc .lb .lb-row.r1::before { background: var(--gold); box-shadow: 0 0 12px rgba(242,193,78,0.45); }\n#nyc .lb .lb-row.r1 .rank { color: var(--gold); font-size: 38px; }\n#nyc .lb .lb-row.r1 .sc { font-size: 32px; color: var(--gold); }\n#nyc .lb .lb-row.r1 .name { font-size: 17px; font-weight: 600; color: #fff; }\n#nyc .lb .lb-row.r2::before { background: var(--silver); }\n#nyc .lb .lb-row.r2 .rank { color: var(--silver); }\n#nyc .lb .lb-row.r3::before { background: var(--bronze); }\n#nyc .lb .lb-row.r3 .rank { color: var(--bronze); }\n#nyc .lb .lb-row.you { background: rgba(92,178,255,0.1); }\n#nyc .lb .lb-row.you::after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--blue); box-shadow: 0 0 10px rgba(92,178,255,0.5); }\n#nyc .lb .lb-row.you .name { color: #fff; font-weight: 600; }\n#nyc .lb .lb-row.you .name::after { content: 'you'; font-family: var(--head); font-size: 11px; letter-spacing: 0.18em; color: var(--blue); margin-left: 8px; font-weight: 700; text-transform: uppercase; }\n#nyc .lb .lb-row.you .sc { color: var(--blue); }\n#nyc .lb .lb-pin { border-top: 1px solid rgba(255,255,255,0.14); }\n#nyc .lb .lb-pin .lb-row { border-top: 0; }\n#nyc .lb .lb-foot { display: flex; justify-content: space-between; gap: 16px; padding: 8px 24px 10px; font-size: var(--t-cap); letter-spacing: 0.14em; text-transform: uppercase; color: var(--dimmer); border-top: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }\n#nyc .lb .lb-foot .hint { color: var(--dim); }\n#nyc .lb .lb-empty { padding: 28px; text-align: center; color: var(--dim); font-size: 13px; }\n#nyc .lb.compact { width: 560px; }\n#nyc .lb.compact .lb-head { padding: 12px 20px 10px; }\n#nyc .lb.compact .lb-title { font-size: 26px; }\n#nyc .lb.compact .lb-kicker { margin-bottom: 4px; }\n#nyc .lb.compact .lb-cols { display: none; }\n#nyc .lb.compact .lb-row { height: 36px; }\n#nyc .lb.compact .lb-row.r1 { height: 44px; }\n#nyc .lb.compact .lb-row .rank { font-size: 20px; padding-left: 20px; }\n#nyc .lb.compact .lb-row.top .rank { font-size: 24px; }\n#nyc .lb.compact .lb-row.r1 .rank { font-size: 30px; }\n#nyc .lb.compact .lb-row .sc { font-size: 20px; }\n#nyc .lb.compact .lb-row.r1 .sc { font-size: 26px; }\n#nyc .lb.compact .lb-row .name { font-size: 14px; }\n#nyc .lb.compact .lb-row.r1 .name { font-size: 15px; }\n#nyc .lb.compact .lb-foot { padding: 6px 20px 8px; justify-content: flex-end; }\n#nyc .lb.compact .lb-foot > span:first-child { display: none; }\n\n", ""],
    ["#nyc .pop {\n  font-family: var(--head); font-size: 24px; font-weight: 700; color: var(--amber); letter-spacing: 0.03em; white-space: nowrap;\n  animation: nyc-pop 1.8s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;\n}\n", ""],
    ["#nyc .toast.score { border-bottom-color: var(--green); }\n", ""],
    ["#nyc .score-label { font-size: var(--t-cap); letter-spacing: 0.22em; color: var(--dim); text-transform: uppercase; font-weight: 600; }\n", ""],
    ["#nyc .score-val { font-family: var(--head); font-size: var(--t-hl); font-weight: 700; line-height: 1; margin-top: 2px; }\n", ""],
    ["#nyc .pops { position: absolute; right: 0; top: 100%; margin-top: 4px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }\n", ""],
    ["#nyc .pop small { font-family: var(--body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--dim); margin-left: 8px; text-transform: uppercase; }\n", ""],
    ["#nyc .death .kept { margin-top: 20px; display: flex; align-items: baseline; gap: 12px; }\n", ""],
    ["#nyc .death .kept .lab { font-size: var(--t-cap); letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); font-weight: 600; }\n", ""],
    ["#nyc .death .kept .val { font-family: var(--head); font-size: 40px; font-weight: 800; color: var(--gold); line-height: 1; letter-spacing: 0.02em; }\n", ""],
    ["#nyc .death .kept .gone { font-size: var(--t-cap); letter-spacing: 0.18em; text-transform: uppercase; color: var(--dimmer); }\n", ""],
    ["#nyc .death .lb-wrap { position: static; }\n", ""],
    ["#nyc .death .lb { animation: none; }\n", ""],
    ["#nyc .death .lb .lb-body { max-height: none; }\n", ""],
    ["#nyc .lb .lb-body { max-height: 472px; }\n", ""],
    ["@keyframes nyc-pop { 0% { opacity: 0; transform: translateY(6px) scale(0.9); } 12% { opacity: 1; transform: translateY(0) scale(1.05); } 70% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-16px); } }\n", ""],
    ["/* ---- score ---- */", "/* ---- online count ---- */"],
    ["#nyc .lb .lb-online i, ", ""],
  ]],
  ["world/assets/audio-BF2WSxiT.js", [
    ["scoreTick(){F(this.ac,this.dest,this.now,{freq:1500,peak:.12,tau:.02,dur:.06,type:`triangle`})}", ""],
    ["lastScore=0;", ""],
    ["this.offs.push(n.on(`score`,e=>{e.delta>0&&e.reason!==`kill`&&e.reason!==`discover`&&this.scoreTick()})),", ""],
    ["scoreTick(){let e=performance.now();e-this.lastScore<700||(this.lastScore=e,super.scoreTick())}", ""],
    ["`discovery`,`score`,", "`discovery`,"],
    ["case`ui_score`:t.scoreTick();break;", ""],
  ]],
  ["world/assets/character-O1u3Gxpp.js", [
    ["function Yt(e,t){", "function Yt(e){"],
    ["s=(e,t)=>{let i=`${e}|${t}`", "s=e=>{let i=e"],
    ["let s=t>0?`  ${t.toLocaleString()}`:``;a.font=`600 44px \"Helvetica Neue\", Helvetica, Arial, sans-serif`;let c=a.measureText(e).width;a.font=`500 30px \"Helvetica Neue\", Helvetica, Arial, sans-serif`;let l=c+a.measureText(s).width,u=qt/2-l/2;", "let l=a.measureText(e).width,u=qt/2-l/2;"],
    [",s&&(a.font=`500 30px \"Helvetica Neue\", Helvetica, Arial, sans-serif`,a.fillStyle=`#ffd166`,a.fillText(s,u+c,52))", ""],
    ["return s(e,t),{sprite:a", "return s(e),{sprite:a"],
    ["Yt(e.name,e.score)", "Yt(e.name)"],
    [",lastScore:e.score", ""],
    ["(n.name!==r.lastName||n.score!==r.lastScore)&&(r.lastName=n.name,r.lastScore=n.score,r.tag.set(n.name,n.score))", "n.name!==r.lastName&&(r.lastName=n.name,r.tag.set(n.name))"],
  ]],
 ]);

export const scoreFreeAssetPaths = new Set(patches.keys());

export function scoreFreeAssetTransform(rel, source) {
  for (const [before, after] of patches.get(rel) ?? []) {
    if (source.split(before).length !== 2) {
      throw new Error(`Score removal anchor changed in ${rel}: ${before.slice(0, 100)}`);
    }
    source = source.replace(before, () => after);
  }
  return source;
}
