/** Resolution changes are infrequent: resizing a WebGL back buffer costs a frame.
 * Use presentation intervals, not JS execution time (GPU work is asynchronous).
 */
export function createResolutionController(initialRatio, apply, options = {}) {
  const ceiling = initialRatio;
  const floor = Math.min(ceiling, options.floor ?? 0.65);
  let ratio = ceiling, last = null, warmup = 0, elapsed = 0, frames = 0, fast = 0, cooldown = 0;
  function reset() { last = null; warmup = 0; elapsed = 0; frames = 0; fast = 0; }
  return (now, active = true) => {
    if (!active || !Number.isFinite(now)) { reset(); return; }
    if (last === null) { last = now; return; }
    const dt = now - last;
    last = now;
    // A suspended tab or a one-off loading stall is not a sustained GPU budget.
    if (dt <= 0 || dt > 250) { reset(); return; }
    warmup += dt;
    cooldown = Math.max(0, cooldown - dt);
    if (warmup < (options.warmupMs ?? 3000) || cooldown > 0) return;
    elapsed += dt;
    frames++;
    if (elapsed < (options.windowMs ?? 2000)) return;
    const average = elapsed / frames;
    options.report?.(average);
    fast = average < (options.fastMs ?? 18) ? fast + elapsed : 0;
    let next = ratio;
    if (average > (options.slowMs ?? 23)) next = Math.max(floor, Math.round((ratio - 0.1) * 100) / 100);
    else if (fast >= 10000) next = Math.min(ceiling, Math.round((ratio + 0.05) * 100) / 100);
    elapsed = 0; frames = 0;
    if (next === ratio) return;
    apply(next);
    ratio = next;
    fast = 0;
    cooldown = options.cooldownMs ?? 3000;
  };
}

/** Called by the existing frame loop; no second RAF or per-frame GPU queries.
 * Composed rendering owns additional targets, so only direct rendering adapts.
 */
export function createMobileFrameBudget(ctx, bundle, enabled = true) {
  // screenshotMode also means interactive free camera (?spot / ?fly).
  // Only an explicit capture/opt-out should prevent resolution adaptation.
  if (ctx.quality.level !== 'mobile' || !enabled) return () => {};
  const sample = createResolutionController(ctx.quality.pixelRatio, ratio => {
    bundle.applyPixelRatio(ratio);
    ctx.quality.pixelRatio = bundle.renderer.getPixelRatio();
  }, {
    ...(ctx.world?.ios ? {floor:.5,warmupMs:1500,windowMs:1000,cooldownMs:1500,slowMs:35,fastMs:24} : {}),
    report:ms=>{ctx.mobileFrameMs=Math.round(ms*10)/10;},
  });
  return (now, ready) => sample(now, ready && !document.hidden && !ctx.state.menuOpen
    && (ctx.state.screenshotMode || !ctx.net.interrupted) && !ctx.startup?.initializing && !ctx.composer);
}

/** Set size and ratio together, avoiding setPixelRatio's intermediate allocation. */
export function resizeDrawingBuffer(renderer, width, height, ratio) {
  renderer.setDrawingBufferSize(width, height, ratio);
  renderer.domElement.style.width = `${width}px`;
  renderer.domElement.style.height = `${height}px`;
}
