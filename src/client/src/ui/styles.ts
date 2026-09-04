/**
 * UI stylesheet + web fonts. One <style> and one <link>, injected once.
 * Headline face: Barlow Condensed. Body: Inter. Both with system fallbacks so nothing breaks offline.
 */
export const FONT_HEAD = "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
export const FONT_BODY = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const STYLE_ID = 'nyc-ui-style';
const FONT_ID = 'nyc-ui-fonts';

export function injectStyles(fonts = true): void {
  if (fonts && !document.getElementById(FONT_ID)) {
    const pre = document.createElement('link');
    pre.rel = 'preconnect';
    pre.href = 'https://fonts.gstatic.com';
    pre.crossOrigin = 'anonymous';
    document.head.appendChild(pre);
    const link = document.createElement('link');
    link.id = FONT_ID;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(link);
  }
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
#nyc {
  --head: ${FONT_HEAD};
  --body: ${FONT_BODY};
  --fg: #f4f6f8;
  --dim: rgba(244, 246, 248, 0.62);
  --dimmer: rgba(244, 246, 248, 0.38);
  --amber: #ffbe3d;
  --blue: #5cb2ff;
  --red: #ff4b4b;
  --green: #5fd977;
  --glass: rgba(9, 11, 15, 0.72);
  --line: rgba(255, 255, 255, 0.12);
  --gold: #f2c14e;
  --silver: #cfd6de;
  --bronze: #c98d5c;
  /* type scale: 10 caps-label · 12 meta · 14 body · 22 head-s · 26 head-m · 44 head-l */
  --t-cap: 10px;
  --t-meta: 12px;
  --t-body: 14px;
  --t-hs: 22px;
  --t-hm: 26px;
  --t-hl: 44px;
  --shadow: 0 1px 1px rgba(0, 0, 0, 0.85), 0 0 6px rgba(0, 0, 0, 0.45);
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  font-family: var(--body);
  color: var(--fg);
  font-size: 14px;
  line-height: 1.25;
  text-shadow: var(--shadow);
  -webkit-font-smoothing: antialiased;
}
#nyc *, #nyc *::before, #nyc *::after { box-sizing: border-box; }
#nyc .ia { pointer-events: auto; }
#nyc[data-hud="off"] .hud { display: none !important; }
#nyc .head { font-family: var(--head); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
#nyc .num { font-variant-numeric: tabular-nums; }
#nyc .hidden { display: none !important; }
#nyc button, #nyc input, #nyc select { font-family: inherit; }
#nyc button { cursor: pointer; }

/* ---- HUD anchors ---- */
#nyc .hud { position: absolute; transition: opacity 0.25s ease; }
#nyc .centre { position: absolute; inset: 0; width: 100%; height: 100%; }
#nyc .tl { top: 22px; left: 26px; display: flex; flex-direction: column; gap: 6px; max-width: 46vw; }
#nyc .tr { top: 20px; right: 28px; text-align: right; }
#nyc .bl { bottom: 22px; left: 22px; display: flex; flex-direction: column; gap: 8px; }
#nyc .br { bottom: 26px; right: 30px; text-align: right; }
#nyc .bc { bottom: 96px; left: 50%; transform: translateX(-50%); }
#nyc .tc { top: 18px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }

/* ---- kill feed ---- */
#nyc .feed { display: flex; flex-direction: column; gap: 4px; }
#nyc .feed .row {
  display: inline-flex; align-items: center; gap: 8px; align-self: flex-start;
  padding: 5px 10px 5px 9px; border-radius: 3px;
  background: rgba(8, 10, 14, 0.55); border-left: 2px solid rgba(255,255,255,0.35);
  font-size: var(--t-meta); font-weight: 500; text-shadow: 0 1px 1px rgba(0,0,0,0.8);
  animation: nyc-in 0.22s ease-out; transition: opacity 0.6s ease, transform 0.6s ease;
}
#nyc .feed .row.kill { border-left-color: var(--red); }
#nyc .feed .row.discover { border-left-color: var(--amber); }
#nyc .feed .row.system { border-left-color: rgba(255,255,255,0.25); color: var(--dim); }
#nyc .feed .row.gone { opacity: 0; transform: translateX(-8px); }
#nyc .feed .row b { font-weight: 600; }
#nyc .wg { display: inline-block; fill: rgba(255,255,255,0.85); vertical-align: -1px; flex: none; filter: drop-shadow(0 1px 0 rgba(0,0,0,0.7)); }
#nyc .wg.x { fill: var(--red); }

/* ---- toasts (top center) ---- */
#nyc .toast {
  font-family: var(--head); text-transform: uppercase; letter-spacing: 0.08em; font-weight: 600; font-size: var(--t-hs);
  padding: 6px 18px; border-radius: 3px; background: rgba(8,10,14,0.55); border-bottom: 1px solid rgba(255,255,255,0.3);
  animation: nyc-toast 3s ease forwards;
}
#nyc .toast.discover { border-bottom-color: var(--amber); color: #fff; }
#nyc .toast.score { border-bottom-color: var(--green); }
#nyc .toast.warn { border-bottom-color: var(--red); }
#nyc .toast small { display: block; font-family: var(--body); font-size: 12px; letter-spacing: 0.12em; color: var(--dim); text-transform: uppercase; }

/* ---- score ---- */
#nyc .score-label { font-size: var(--t-cap); letter-spacing: 0.22em; color: var(--dim); text-transform: uppercase; font-weight: 600; }
#nyc .score-val { font-family: var(--head); font-size: var(--t-hl); font-weight: 700; line-height: 1; margin-top: 2px; }
#nyc .online { font-size: var(--t-meta); color: var(--dim); margin-top: 4px; letter-spacing: 0.02em; }
#nyc .online i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); margin-right: 6px; vertical-align: 1px; box-shadow: 0 0 6px var(--green); }
#nyc .pops { position: absolute; right: 0; top: 100%; margin-top: 4px; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
#nyc .pop {
  font-family: var(--head); font-size: 24px; font-weight: 700; color: var(--amber); letter-spacing: 0.03em; white-space: nowrap;
  animation: nyc-pop 1.8s cubic-bezier(0.2, 0.8, 0.3, 1) forwards;
}
#nyc .pop small { font-family: var(--body); font-size: 11px; font-weight: 600; letter-spacing: 0.16em; color: var(--dim); margin-left: 8px; text-transform: uppercase; }

/* ---- minimap + bars ---- */
#nyc .minimap {
  width: 280px; height: 180px; border-radius: 12px; display: block;
  border: 1px solid rgba(255,255,255,0.1); background: #172c44;
  box-shadow: 0 8px 28px rgba(0,0,0,0.45), 0 0 0 1px rgba(0,0,0,0.5);
}
#nyc .bars { width: 284px; display: flex; flex-direction: column; gap: 4px; }
#nyc .health-row { display: flex; align-items: center; gap: 8px; }
#nyc .health-row .health { flex: 1; }
#nyc .health-value { min-width: 42px; font-size: 12px; font-weight: 700; text-align: right; }
#nyc .bar { display: flex; gap: 2px; height: 9px; }
#nyc .bar.armor { height: 5px; }
#nyc .bar i { flex: 1; background: rgba(0,0,0,0.5); border-radius: 1px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.35); transition: background 0.2s ease; }
#nyc .bar i.on { background: var(--green); box-shadow: 0 0 6px rgba(95,217,119,0.35); }
#nyc .bar.mid i.on { background: #ffc44d; box-shadow: 0 0 6px rgba(255,196,77,0.35); }
#nyc .bar.low i.on { background: var(--red); box-shadow: 0 0 8px rgba(255,75,75,0.5); animation: nyc-pulse 0.9s ease-in-out infinite; }
#nyc .bar.armor i.on { background: var(--blue); box-shadow: 0 0 6px rgba(92,178,255,0.4); animation: none; }
#nyc .loc { width: 284px; min-height: 40px; }
#nyc .loc .street { font-family: var(--head); font-size: var(--t-hs); font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em; line-height: 1; transition: opacity 0.5s ease; }
#nyc .loc .area { font-size: var(--t-meta); font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); margin-top: 3px; transition: opacity 0.5s ease; }
#nyc .loc .fade { opacity: 0; }
#nyc .chips { display: flex; gap: 6px; min-height: 22px; }
#nyc .chip {
  font-family: var(--head); font-size: var(--t-body); font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase;
  padding: 3px 9px; border-radius: 3px; background: rgba(8,10,14,0.6); border: 1px solid var(--line); line-height: 1.1;
}
#nyc .chip.prot { color: var(--blue); border-color: rgba(92,178,255,0.55); }
#nyc .chip.safe { color: #fff; background: rgba(40,110,190,0.55); border-color: rgba(92,178,255,0.7); }
#nyc .stats { font-size: var(--t-cap); color: var(--dimmer); letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }

/* ---- weapon / speed ---- */
#nyc .weapon .name { font-family: var(--head); font-size: var(--t-hs); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1; }
#nyc .weapon .ammo { font-family: var(--head); font-size: var(--t-hl); font-weight: 700; line-height: 1; margin-top: 2px; }
#nyc .weapon .ammo span { font-size: var(--t-hs); color: var(--dim); font-weight: 600; }
#nyc .weapon .reload { font-size: var(--t-cap); letter-spacing: 0.2em; color: var(--amber); text-transform: uppercase; font-weight: 600; margin-top: 2px; animation: nyc-pulse 0.8s ease-in-out infinite; }
#nyc .weapon.unarmed .name { color: var(--dim); }
#nyc .speed .val { font-family: var(--head); font-size: 56px; font-weight: 700; line-height: 1; }
#nyc .speed .unit { font-size: var(--t-cap); letter-spacing: 0.24em; color: var(--dim); text-transform: uppercase; font-weight: 600; }

/* ---- center ---- */
#nyc .cross { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
#nyc .cross i { position: absolute; background: #fff; box-shadow: 0 0 2px rgba(0,0,0,0.9); }
#nyc .cross .dot { width: 3px; height: 3px; border-radius: 50%; left: -1.5px; top: -1.5px; }
#nyc .cross .u, #nyc .cross .d { width: 2px; height: 9px; left: -1px; }
#nyc .cross .l, #nyc .cross .r { height: 2px; width: 9px; top: -1px; }
#nyc .hitmark { position: absolute; left: 50%; top: 50%; width: 0; height: 0; opacity: 0; }
#nyc .hitmark i { position: absolute; width: 2px; height: 12px; background: #fff; left: -1px; top: -20px; transform-origin: 1px 20px; box-shadow: 0 0 3px rgba(0,0,0,0.9); }
#nyc .hitmark.on { animation: nyc-hit 0.18s ease-out; }
#nyc .hitmark.head i { background: var(--red); }
#nyc .dmg { position: absolute; left: 50%; top: 50%; width: 0; height: 0; }
#nyc .dmg i { position: absolute; left: -70px; top: -70px; width: 140px; height: 140px; border-radius: 50%; border: 3px solid transparent; border-top-color: var(--red); opacity: 0; transition: opacity 0.15s ease; }
#nyc .dmg i.on { opacity: 1; animation: nyc-fade 1.2s ease-out forwards; }
#nyc .prompt {
  font-size: 14px; font-weight: 500; padding: 7px 14px; border-radius: 4px; white-space: nowrap;
  background: rgba(8,10,14,0.62); border: 1px solid var(--line); animation: nyc-in 0.2s ease-out;
}
#nyc .prompt b { font-family: var(--head); font-weight: 700; font-size: 15px; padding: 1px 6px; border: 1px solid rgba(255,255,255,0.5); border-radius: 3px; margin-right: 8px; letter-spacing: 0.04em; }
#nyc .clickhint { position: absolute; left: 50%; top: 58%; transform: translateX(-50%); font-size: 12px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); animation: nyc-pulse 1.6s ease-in-out infinite; }

/* ---- banners ---- */
#nyc .banner {
  position: absolute; top: 20px; left: 20px; max-width: min(360px, calc(100vw - 40px)); z-index: 30;
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px;
  font-size: 13px; font-weight: 600; letter-spacing: 0.02em; padding: 8px 16px; border-radius: 4px;
  background: rgba(255,190,61,0.92); color: #1a1300; text-shadow: none; cursor: pointer; box-shadow: 0 4px 16px rgba(0,0,0,0.4);
}
#nyc .banner:hover { background: #ffd070; }
#nyc .banner button { cursor: pointer; border: 1px solid #70521e; border-radius: 3px; padding: 4px 8px; background: transparent; color: inherit; }
#nyc .banner span { flex-basis: 100%; }
#nyc .name-help { color: var(--dim); font-size: 12px; line-height: 1.4; text-align: left; }

/* ---- screens ---- */
#nyc .screen { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; animation: nyc-fade-in 0.35s ease; }
#nyc .screen.out { animation: nyc-fade-out 0.35s ease forwards; }
#nyc .intro { background: radial-gradient(ellipse at center, rgba(4,6,10,0.55) 0%, rgba(4,6,10,0.88) 100%); justify-content: flex-start; overflow-y: auto; padding: 24px 0 42px; }
#nyc .intro > * { flex-shrink: 0; }
#nyc .intro .title { margin-top: auto; }
#nyc .intro .controls { margin-bottom: auto; }
#nyc .intro .title { font-family: var(--head); font-size: clamp(72px, 13vw, 140px); font-weight: 800; letter-spacing: 0.06em; line-height: 0.95; text-transform: uppercase; text-shadow: 0 2px 4px rgba(0,0,0,0.8), 0 0 40px rgba(0,0,0,0.6); }
#nyc .intro .sub { font-size: 15px; letter-spacing: 0.34em; text-transform: uppercase; color: var(--dim); margin: 12px 0 44px; }
#nyc .intro form { display: flex; flex-direction: column; gap: 10px; align-items: stretch; width: 460px; max-width: calc(100vw - 32px); }
#nyc .intro input:not([type="checkbox"]) {
  width: 100%; box-sizing: border-box; padding: 0 16px; height: 50px; font-size: 18px; font-weight: 500; letter-spacing: 0.02em; color: #fff; text-shadow: none;
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.28); border-radius: 4px; outline: none; transition: border-color 0.2s ease, background 0.2s ease;
}
#nyc .intro input::placeholder { color: rgba(255,255,255,0.35); }
#nyc .intro input:focus { border-color: rgba(255,255,255,0.75); background: rgba(255,255,255,0.1); }
#nyc .intro .newsletter { padding: 4px 0 8px; text-align: left; }
#nyc .intro .newsletter label { display: flex; align-items: flex-start; gap: 10px; color: var(--fg); font-size: 14px; line-height: 1.5; cursor: pointer; }
#nyc .intro .newsletter input { flex: 0 0 20px; width: 20px; height: 20px; margin: 1px 0 0; accent-color: #f4f6f8; cursor: pointer; }
#nyc .intro .newsletter input:focus-visible { outline: 2px solid #f4f6f8; outline-offset: 3px; }
#nyc .intro .newsletter small { display: block; margin: 3px 0 0 30px; font-size: 12px; line-height: 1.5; color: var(--dim); }
#nyc .btn {
  font-family: var(--head); font-size: 20px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; text-shadow: none;
  padding: 0 26px; height: 50px; color: #0b0e14; background: #f4f6f8; border: 0; border-radius: 4px; transition: background 0.15s ease, transform 0.1s ease, opacity 0.2s ease;
}
#nyc .btn:hover { background: #fff; transform: translateY(-1px); }
#nyc .btn:active { transform: translateY(0); }
#nyc .btn:disabled { opacity: 0.35; cursor: default; transform: none; }
#nyc .btn.ghost { background: transparent; color: var(--fg); border: 1px solid rgba(255,255,255,0.35); }
#nyc .btn.ghost:hover { background: rgba(255,255,255,0.08); }
#nyc .btn.danger { background: var(--red); color: #fff; }
#nyc .btn.danger:hover { background: #ff6a6a; }
#nyc .intro .controls { margin-top: 40px; font-size: 12px; letter-spacing: 0.06em; color: var(--dim); display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
#nyc .intro .controls b { color: var(--fg); font-family: var(--head); font-size: 14px; letter-spacing: 0.08em; font-weight: 600; margin-right: 5px; }
#nyc .intro .ver { position: absolute; right: 22px; bottom: 18px; font-size: 11px; letter-spacing: 0.16em; color: var(--dimmer); text-transform: uppercase; }
#nyc .intro .err { margin-top: 10px; font-size: 12px; color: var(--red); height: 14px; }

/* ---- leaderboard ---- */
#nyc .lb-wrap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
#nyc .lb {
  width: 620px; max-width: calc(100vw - 40px); max-height: calc(100vh - 60px); overflow: hidden; display: flex; flex-direction: column;
  border-radius: 6px; border: 1px solid rgba(255,255,255,0.12); text-shadow: none;
  background: linear-gradient(180deg, rgba(13,15,20,0.9), rgba(8,10,14,0.86));
  backdrop-filter: blur(18px) saturate(1.2); -webkit-backdrop-filter: blur(18px) saturate(1.2);
  box-shadow: 0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.07);
  animation: nyc-rise 0.24s cubic-bezier(0.2, 0.8, 0.3, 1);
}
#nyc .lb .lb-head { display: flex; align-items: flex-end; justify-content: space-between; padding: 18px 24px 14px; border-bottom: 1px solid rgba(255,255,255,0.1); }
#nyc .lb .lb-kicker { font-size: var(--t-cap); letter-spacing: 0.26em; text-transform: uppercase; color: var(--dim); font-weight: 600; margin-bottom: 6px; }
#nyc .lb .lb-kicker .lb-era { color: var(--gold); }
#nyc .lb .lb-title { font-family: var(--head); font-size: 38px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; line-height: 0.9; }
#nyc .lb .lb-online { font-size: var(--t-meta); letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); font-weight: 500; padding-bottom: 2px; }
#nyc .lb .lb-online b { color: var(--fg); font-weight: 700; font-variant-numeric: tabular-nums; }
#nyc .lb .lb-online i { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--green); margin-right: 8px; box-shadow: 0 0 8px var(--green); vertical-align: 1px; animation: nyc-pulse 2.4s ease-in-out infinite; }
#nyc .lb .lb-cols, #nyc .lb .lb-row { display: grid; grid-template-columns: 64px 1fr 72px 128px; align-items: center; padding: 0 24px 0 0; }
#nyc .lb .lb-cols { font-size: var(--t-cap); letter-spacing: 0.22em; text-transform: uppercase; color: var(--dimmer); font-weight: 600; padding-top: 10px; padding-bottom: 6px; }
#nyc .lb .lb-cols > :first-child { padding-left: 24px; }
#nyc .lb .lb-cols > :nth-child(n+3) { text-align: right; }
#nyc .lb .lb-body { overflow-y: auto; }
#nyc .lb .lb-row { height: 42px; border-top: 1px solid rgba(255,255,255,0.05); position: relative; }
#nyc .lb .lb-row .rank { font-family: var(--head); font-size: 24px; font-weight: 800; color: var(--dimmer); padding-left: 24px; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
#nyc .lb .lb-row .who { display: flex; align-items: center; gap: 10px; min-width: 0; padding-right: 12px; }
#nyc .lb .lb-row .name { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#nyc .lb .lb-row .on { flex: none; width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.14); }
#nyc .lb .lb-row .on.live { background: var(--green); box-shadow: 0 0 6px rgba(95,217,119,0.7); }
#nyc .lb .lb-row .sc { font-family: var(--head); font-size: 24px; font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; letter-spacing: 0.01em; }
#nyc .lb .lb-row .k { font-size: 13px; color: var(--dim); text-align: right; font-variant-numeric: tabular-nums; }
#nyc .lb .lb-row.top::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
#nyc .lb .lb-row.top .rank { font-size: 30px; color: var(--fg); }
#nyc .lb .lb-row.r1 { height: 56px; background: linear-gradient(90deg, rgba(242,193,78,0.13), rgba(242,193,78,0.03) 45%, transparent 75%); }
#nyc .lb .lb-row.r1::before { background: var(--gold); box-shadow: 0 0 12px rgba(242,193,78,0.45); }
#nyc .lb .lb-row.r1 .rank { color: var(--gold); font-size: 38px; }
#nyc .lb .lb-row.r1 .sc { font-size: 32px; color: var(--gold); }
#nyc .lb .lb-row.r1 .name { font-size: 17px; font-weight: 600; color: #fff; }
#nyc .lb .lb-row.r2::before { background: var(--silver); }
#nyc .lb .lb-row.r2 .rank { color: var(--silver); }
#nyc .lb .lb-row.r3::before { background: var(--bronze); }
#nyc .lb .lb-row.r3 .rank { color: var(--bronze); }
#nyc .lb .lb-row.you { background: rgba(92,178,255,0.1); }
#nyc .lb .lb-row.you::after { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--blue); box-shadow: 0 0 10px rgba(92,178,255,0.5); }
#nyc .lb .lb-row.you .name { color: #fff; font-weight: 600; }
#nyc .lb .lb-row.you .name::after { content: 'you'; font-family: var(--head); font-size: 11px; letter-spacing: 0.18em; color: var(--blue); margin-left: 8px; font-weight: 700; text-transform: uppercase; }
#nyc .lb .lb-row.you .sc { color: var(--blue); }
#nyc .lb .lb-pin { border-top: 1px solid rgba(255,255,255,0.14); }
#nyc .lb .lb-pin .lb-row { border-top: 0; }
#nyc .lb .lb-foot { display: flex; justify-content: space-between; gap: 16px; padding: 8px 24px 10px; font-size: var(--t-cap); letter-spacing: 0.14em; text-transform: uppercase; color: var(--dimmer); border-top: 1px solid rgba(255,255,255,0.06); white-space: nowrap; }
#nyc .lb .lb-foot .hint { color: var(--dim); }
#nyc .lb .lb-empty { padding: 28px; text-align: center; color: var(--dim); font-size: 13px; }
#nyc .lb.compact { width: 560px; }
#nyc .lb.compact .lb-head { padding: 12px 20px 10px; }
#nyc .lb.compact .lb-title { font-size: 26px; }
#nyc .lb.compact .lb-kicker { margin-bottom: 4px; }
#nyc .lb.compact .lb-cols { display: none; }
#nyc .lb.compact .lb-row { height: 36px; }
#nyc .lb.compact .lb-row.r1 { height: 44px; }
#nyc .lb.compact .lb-row .rank { font-size: 20px; padding-left: 20px; }
#nyc .lb.compact .lb-row.top .rank { font-size: 24px; }
#nyc .lb.compact .lb-row.r1 .rank { font-size: 30px; }
#nyc .lb.compact .lb-row .sc { font-size: 20px; }
#nyc .lb.compact .lb-row.r1 .sc { font-size: 26px; }
#nyc .lb.compact .lb-row .name { font-size: 14px; }
#nyc .lb.compact .lb-row.r1 .name { font-size: 15px; }
#nyc .lb.compact .lb-foot { padding: 6px 20px 8px; justify-content: flex-end; }
#nyc .lb.compact .lb-foot > span:first-child { display: none; }

/* ---- death ---- */
#nyc .death { background: radial-gradient(ellipse at center, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.88) 100%); backdrop-filter: saturate(0.12) contrast(1.05); -webkit-backdrop-filter: saturate(0.12) contrast(1.05); justify-content: center; gap: 0; overflow: hidden; padding: 3vh 0; }
#nyc .death.environmental { background: #0b0e14; backdrop-filter: none; -webkit-backdrop-filter: none; animation: none; }
#nyc .death .card { display: flex; flex-direction: column; align-items: center; animation: nyc-rise 0.24s cubic-bezier(0.2, 0.8, 0.3, 1); }
#nyc .death .title { font-family: var(--head); font-size: clamp(52px, 9vh, 72px); font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; line-height: 1; color: #fff; text-shadow: 0 2px 4px rgba(0,0,0,0.7); }
#nyc .death .by { margin-top: 10px; font-size: 15px; letter-spacing: 0.04em; color: var(--dim); display: flex; align-items: center; gap: 6px; }
#nyc .death .by b { color: var(--fg); font-weight: 600; }
#nyc .death .by .weap { display: inline-flex; align-items: center; gap: 7px; color: var(--fg); font-weight: 500; }
#nyc .death .by .weap::before { content: '·'; color: var(--dimmer); }
#nyc .death .by .wg { width: 26px; height: 12px; }
#nyc .death .where { margin-top: 4px; font-size: var(--t-meta); letter-spacing: 0.14em; text-transform: uppercase; color: var(--dimmer); }
#nyc .death .kept { margin-top: 20px; display: flex; align-items: baseline; gap: 12px; }
#nyc .death .kept .lab { font-size: var(--t-cap); letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); font-weight: 600; }
#nyc .death .kept .val { font-family: var(--head); font-size: 40px; font-weight: 800; color: var(--gold); line-height: 1; letter-spacing: 0.02em; }
#nyc .death .kept .gone { font-size: var(--t-cap); letter-spacing: 0.18em; text-transform: uppercase; color: var(--dimmer); }
#nyc .death .btn { margin: 18px 0 22px; min-width: 200px; height: 44px; font-size: 18px; display: inline-flex; align-items: center; justify-content: center; gap: 12px; }
#nyc .death .btn .cd { font-weight: 800; color: #0b0e14; opacity: 0.55; padding-left: 12px; border-left: 1px solid rgba(11,14,20,0.25); font-variant-numeric: tabular-nums; }
#nyc .death .btn:disabled { opacity: 0.6; }
#nyc .death .lb-wrap { position: static; }
#nyc .death .lb { animation: none; }
#nyc .death .lb .lb-body { max-height: none; }
#nyc .lb .lb-body { max-height: 472px; }

#nyc .intro .privacy { max-width: 570px; padding: 0 20px; font-size: 12px; line-height: 1.7; color: var(--dim); text-align: center; }
#nyc .intro .privacy a { color: var(--fg); text-decoration: underline; text-underline-offset: 3px; }
#nyc .intro .privacy a:focus-visible { outline: 2px solid var(--fg); outline-offset: 3px; }
#nyc .intro .disclaimer { margin-top: 0; }
#nyc .admin-chip { display: inline-block; margin: 6px; padding: 5px 9px; border: 1px solid #d6b66b; border-radius: 4px; color: #f0d89a; background: #111b25; font-size: 10px; letter-spacing: .16em; }
#nyc .admin-chip[hidden] { display: none; }
#nyc .admin-tools { margin-top: 24px; padding-top: 18px; border-top: 1px solid #ffffff22; }
#nyc .admin-tools .btn { margin: 5px 8px 5px 0; padding: 9px 12px; font-size: 12px; }
#nyc .admin-tools input { padding: 10px; color: var(--fg); background: #ffffff0c; border: 1px solid #ffffff44; border-radius: 4px; }
#nyc .admin-location { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
#nyc .admin-location select { width: auto; }
#nyc .admin-tools > select { margin: 10px 0; }

/* ---- pause ---- */
#nyc .pause { background: rgba(6,8,12,0.78); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
#nyc .pause .panel { width: 640px; max-width: calc(100vw - 40px); max-height: calc(100vh - 40px); overflow: auto; text-shadow: none; }
#nyc .pause .title { font-family: var(--head); font-size: 56px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1; }
#nyc .pause .sub { font-size: 12px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--dim); margin: 6px 0 26px; }
#nyc .pause .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; }
#nyc .pause h4 { font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--dimmer); margin: 0 0 10px; font-weight: 600; }
#nyc .pause .vol { display: grid; grid-template-columns: 80px 1fr 36px; align-items: center; gap: 10px; font-size: 13px; margin-bottom: 8px; }
#nyc .pause .vol span:last-child { text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; font-size: 12px; }
#nyc .pause input[type=range] { width: 100%; accent-color: #f4f6f8; }
#nyc .pause .vol.off { opacity: 0.4; }
#nyc .pause select { width: 100%; padding: 8px 10px; background: rgba(255,255,255,0.06); color: var(--fg); border: 1px solid rgba(255,255,255,0.25); border-radius: 4px; font-size: 13px; }
#nyc .pause .note { font-size: 11px; color: var(--dimmer); margin-top: 6px; }
#nyc .pause .keys { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px; color: var(--dim); }
#nyc .pause .keys b { font-family: var(--head); font-size: 13px; letter-spacing: 0.08em; color: var(--fg); font-weight: 600; }
#nyc .pause .actions { display: flex; gap: 10px; margin-top: 28px; align-items: center; }
#nyc .pause .ver { margin-left: auto; font-size: 11px; letter-spacing: 0.16em; color: var(--dimmer); text-transform: uppercase; }
#nyc .pause .jump-sec { margin-top: 24px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.08); transition: background 0.4s ease; border-radius: 4px; }
#nyc .pause .jump-sec.lit { background: rgba(255,255,255,0.04); }
#nyc .pause .jump-sec h4 span { display: inline-block; font-family: var(--head); font-size: 12px; letter-spacing: 0.08em; color: var(--fg); border: 1px solid rgba(255,255,255,0.4); border-radius: 3px; padding: 0 5px; margin-left: 8px; line-height: 1.3; }
#nyc .pause .jump { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; }
#nyc .pause .jump-it {
  display: flex; flex-direction: column; align-items: flex-start; gap: 1px; text-align: left; padding: 5px 8px; border: 0; border-radius: 3px;
  background: transparent; color: var(--fg); text-shadow: none; transition: background 0.12s ease;
}
#nyc .pause .jump-it:hover { background: rgba(255,255,255,0.08); }
#nyc .pause .jump-it b { font-size: 13px; font-weight: 600; line-height: 1.15; }
#nyc .pause .jump-it span { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--dimmer); line-height: 1.2; }

/* ---- full map ---- */
#nyc .map { background: #101a26; cursor: grab; }
#nyc .map.drag { cursor: grabbing; }
#nyc .map canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
#nyc .map .map-head { position: absolute; top: 18px; left: 26px; text-shadow: var(--shadow); }
#nyc .map .map-head .t { font-family: var(--head); font-size: 34px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1; }
#nyc .map .map-head .s { font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--dim); margin-top: 4px; }
#nyc .map .map-foot { position: absolute; bottom: 18px; left: 26px; right: 26px; display: flex; justify-content: space-between; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dim); text-shadow: var(--shadow); }
#nyc .map .map-foot b { color: var(--fg); font-family: var(--head); font-size: 13px; letter-spacing: 0.08em; }
#nyc .map .legend { position: absolute; top: 22px; right: 26px; display: flex; flex-direction: column; gap: 5px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); text-shadow: var(--shadow); }
#nyc .map .legend i { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 8px; vertical-align: -1px; }

/* ---- loading ---- */
#nyc .loading { background: #0b0e14; }
#nyc .loading .title { font-family: var(--head); font-size: 64px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; line-height: 1; }
#nyc .loading .sub { font-size: 12px; letter-spacing: 0.32em; text-transform: uppercase; color: var(--dim); margin: 10px 0 34px; }
#nyc .loading .track { width: 280px; height: 2px; background: rgba(255,255,255,0.1); border-radius: 2px; overflow: hidden; }
#nyc .loading .track i { display: block; height: 100%; width: 0; background: #f4f6f8; transition: width 0.3s ease; }
#nyc .loading .status { margin-top: 12px; font-size: 12px; color: var(--dim); letter-spacing: 0.06em; font-variant-numeric: tabular-nums; }
#nyc .loading .tip { position: absolute; bottom: 40px; left: 0; right: 0; text-align: center; font-size: 13px; color: var(--dim); letter-spacing: 0.02em; padding: 0 30px; }
#nyc .loading .tip b { color: var(--fg); font-weight: 600; }

@media (prefers-reduced-motion: reduce) {
  #nyc .lb, #nyc .death .card, #nyc .screen, #nyc .feed .row, #nyc .prompt { animation: none !important; }
  #nyc .lb .lb-online i, #nyc .clickhint, #nyc .weapon .reload { animation: none !important; }
}
@keyframes nyc-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes nyc-fade { from { opacity: 1; } to { opacity: 0; } }
@keyframes nyc-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes nyc-fade-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes nyc-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
@keyframes nyc-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes nyc-pop { 0% { opacity: 0; transform: translateY(6px) scale(0.9); } 12% { opacity: 1; transform: translateY(0) scale(1.05); } 70% { opacity: 1; transform: translateY(0) scale(1); } 100% { opacity: 0; transform: translateY(-16px); } }
@keyframes nyc-toast { 0% { opacity: 0; transform: translateY(-8px); } 10% { opacity: 1; transform: none; } 85% { opacity: 1; } 100% { opacity: 0; transform: translateY(-6px); } }
@keyframes nyc-hit { 0% { opacity: 1; transform: scale(1.35); } 100% { opacity: 0; transform: scale(1); } }
`;
