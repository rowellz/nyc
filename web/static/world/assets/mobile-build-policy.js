/** Mobile street tuning. Pixel counts grow quadratically with map dimensions.
 * Keep the atlas larger than the surface maps so lane paint stays legible.
 */
export const MOBILE_STREET_BUDGET = Object.freeze({
  mapSize: 128,
  noiseSize: 64,
  atlasSize: 512,
  anisotropy: 2,
  roadStepsPerBackground: 3,
  streetSettleMs: 100,
  streetMaxWaitMs: 400,
});

export const MOBILE_BUILDING_BUDGET = Object.freeze({ mapSize: 128, anisotropy: 2 });

const streetChanges = new WeakMap();

/** Adjacent tile arrivals can invalidate the same motorway several frames in
 * a row. Coalesce that burst before spending worker CPU on its replacement. */
export function markStreetDirty(rec) {
  const now = performance.now();
  const state = streetChanges.get(rec);
  streetChanges.set(rec, { first: state?.first ?? now, last: now });
}

export function canBuildStreet(rec, active, ctx) {
  // An invalidation can requeue a tile while its old revision still occupies
  // a worker. Do not let the other worker build that same tile simultaneously.
  for (const request of active.values()) if (request.rec === rec) return false;
  if (ctx.quality.level !== 'mobile') return true;
  const state = streetChanges.get(rec);
  if (!state) return true;
  const now = performance.now();
  return now - state.last >= MOBILE_STREET_BUDGET.streetSettleMs
    || now - state.first >= MOBILE_STREET_BUDGET.streetMaxWaitMs;
}

export function beginStreetBuild(rec) {
  streetChanges.delete(rec);
}

/** Tag street maps so the shared decoder can apply their mobile budget. */
export function streetTextureUrl(url, mobile) {
  if (!mobile) return url;
  const parsed = new URL(url, 'https://textures.invalid');
  parsed.pathname = parsed.pathname.replace('/assets/textures/', '/assets/textures-mobile/');
  parsed.searchParams.set('streetMobile', '1');
  return /^(https?:)?\/\//.test(url) ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}

export function mobileTextureSize(url) {
  const params = new URL(url, 'https://textures.invalid').searchParams;
  if (params.get('buildingMobile') === '1') return MOBILE_BUILDING_BUDGET.mapSize;
  return params.get('streetMobile') === '1' ? MOBILE_STREET_BUDGET.mapSize : 256;
}

/** Facade color and normal maps share the cap; unrelated scene maps keep theirs. */
export function buildingTextureUrl(url) {
  const parsed = new URL(url, 'https://textures.invalid');
  if (!parsed.pathname.includes('/assets/textures-mobile/')) return url;
  parsed.searchParams.set('buildingMobile', '1');
  return /^(https?:)?\/\//.test(url) ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}

/** Three road steps per background step on mobile, within the existing frame
 * deadline. Keep buildings progressing even during continuous road streaming.
 * Queue items return to the tail after yielding, preserving fairness on ties.
 */
export function nextSceneBuild(ready, ctx, turn) {
  if (ctx.quality.level !== 'mobile') return ready.shift();
  const share = MOBILE_STREET_BUDGET.roadStepsPerBackground;
  const roads = turn % (share + 1) !== share;
  const fifoBackground = !roads && turn % ((share + 1) * 4) === (share + 1) * 4 - 1;
  let best = -1, priority = Infinity;
  for (let i = 0; i < ready.length; i++) {
    const item = ready[i];
    if (!item.job.pending) continue;
    const street = /^streets[: ]/.test(item.label);
    if (street !== roads) continue;
    let score = 0;
    if (street || !fifoBackground) {
      const match = /(?:^streets:|^buildings:|^environment mask |^props:|^building landmark colliders:)(-?\d+)_(-?\d+)$/.exec(item.label);
      score = match ? ctx.world?.tilePriority?.(+match[1], +match[2]) ?? 0 : -Infinity;
    }
    if (best < 0 || score < priority) { best = i; priority = score; }
  }
  return best < 0 ? ready.shift() : ready.splice(best, 1)[0];
}

const buildingTurns = new WeakMap();
/** Follow the same route when dispatching queued building workers, while
 * reserving every fourth dispatch for the oldest queued tile. */
export function nextBuildingTile(queue, ctx) {
  if (ctx.quality.level !== 'mobile' || !ctx.world?.tilePriority) return queue.shift();
  const turn = buildingTurns.get(ctx) ?? 0;
  buildingTurns.set(ctx, turn + 1);
  if (turn % 4 === 3) return queue.shift();
  let best = 0, priority = Infinity;
  for (let i = 0; i < queue.length; i++) {
    const { tx, tz } = queue[i].tile;
    const score = ctx.world.tilePriority(tx, tz);
    if (score < priority) { best = i; priority = score; }
  }
  return queue.splice(best, 1)[0];
}
