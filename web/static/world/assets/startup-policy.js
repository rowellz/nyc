// Terrain, streets, buildings, landmarks and player controls must be complete
// before entry. Street furniture and traffic can populate an already playable
// city; screenshot mode still waits for the complete scene.
const AFTER_ENTRY = new Set(['props', 'vehicles']);
const labels = { environment: 'terrain', streets: 'roads', buildings: 'buildings',
  landmarks: 'landmarks', character: 'your character', combat: 'controls', ui: 'interface',
  props: 'street furniture', vehicles: 'traffic' };
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

export async function startDeferredModules({ ctx, world, loop, shots, order, create, stage, created }) {
  const names = order.slice(1).filter(name => name !== 'audio');
  const background = ctx.state.screenshotMode ? [] : names.filter(name => AFTER_ENTRY.has(name));
  const required = names.filter(name => !background.includes(name));
  const progress = ctx.startup = { active: '', completed: 0, total: required.length, initializing: false, timings: [] };
  async function idle() {
    do { await nextFrame(); } while (loop.running && ((ctx.busy ?? 0) > 0 || !world.ready));
    return loop.running;
  }
  async function build(name) {
    if (!await idle()) return false;
    progress.active = name;
    const began = performance.now();
    progress.initializing = true;
    try { await create(name, order.indexOf(name)); }
    finally { progress.initializing = false; }
    // Include worker commits, uploads and shader waits in the module timing.
    if (!await idle()) return false;
    progress.timings.push({ module: name, ms: Math.round(performance.now() - began) });
    return true;
  }
  for (const name of required) {
    if (!await build(name)) return;
    progress.completed++;
  }
  progress.active = '';
  stage(background.length ? 'playable_modules_ready' : 'modules_ready', created.join(', '));
  shots.modulesCreated();
  if (!background.length) return;
  // Keep all existing physics, near-scene, render and busy checks in charge of
  // entry. Background work cannot keep their busy count from reaching zero.
  do { await nextFrame(); } while (loop.running && !shots.ready);
  if (!loop.running) return;
  for (const name of background) if (!await build(name)) return;
  progress.active = '';
  stage('modules_ready', created.join(', '));
}

export function startupProgress(ctx, world) {
  const tiles = Math.min(1, world.tiles.size / 9);
  const progress = ctx.startup;
  if (!world.ready) return { text: `Loading nearby city — ${world.tiles.size} tiles loaded`, fraction: .3 + .35 * tiles };
  const label = labels[progress?.active];
  return {
    text: `${label ? `Preparing ${label}` : 'Finishing nearby scene'} — ${world.tiles.size} tiles loaded`,
    // Decoding nine tiles is only one phase. Reserve completion for scene entry.
    fraction: Math.min(.95, .65 + .3 * (progress ? progress.completed / Math.max(1, progress.total) : 0)),
  };
}
