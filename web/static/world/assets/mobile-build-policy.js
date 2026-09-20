/** Mobile street tuning. Pixel counts grow quadratically with map dimensions.
 * Keep the atlas larger than the surface maps so lane paint stays legible.
 */
export const MOBILE_STREET_BUDGET = Object.freeze({
  mapSize: 64,
  noiseSize: 32,
  atlasSize: 256,
  anisotropy: 1,
  roadStepsPerBackground: 3,
  streetSettleMs: 100,
  streetMaxWaitMs: 400,
});

export const MOBILE_BUILDING_BUDGET = Object.freeze({ mapSize: 64, anisotropy: 1 });

/** Custom towers can allocate large construction arrays before their first
 * yield. Limit those models before construction; ordinary facades keep drawing
 * until a selected landmark actually commits and publishes its building IDs. */
export function selectDetailedLandmarks(ctx, landmarks) {
  if(ctx.quality.level!=='mobile')return null;
  const ios=ctx.world?.ios===true,limit=ios?2:3;
  const range=Math.min(ctx.quality.drawDistance,ios?192:256);
  const selected=new Set(),candidates=[];
  for(const landmark of landmarks) {
    // Parks, bridges and standalone street structures carry walkable surfaces
    // or have no ordinary building replacement; retain their existing rules.
    if(!landmark.bins.length||landmark.radius>100||landmark.id==='bryant-park') {
      selected.add(landmark);continue;
    }
    const distance=Math.max(0,Math.hypot(ctx.camera.position.x-landmark.center[0],
      ctx.camera.position.z-landmark.center[1])-landmark.radius);
    if(distance<=range+(landmark.root?32:0))candidates.push({landmark,rank:distance-(landmark.root?24:0)});
  }
  candidates.sort((a,b)=>a.rank-b.rank||a.landmark.id.localeCompare(b.landmark.id));
  for(const {landmark} of candidates.slice(0,limit))selected.add(landmark);
  return selected;
}

/** Keep scene uploads/collider commits progressing, with more room for rendering
 * while crossing tiles quickly. An individual native operation can still overrun. */
export function sceneBuildBudgetMs(ctx) {
  return ctx.world?.stats?.fastTravel ? (ctx.quality.level === 'mobile' ? 1 : 2) : 3;
}

const maskChanges = new WeakMap();
/** Only park channels depend on neighboring roads/buildings. The water channel
 * comes entirely from the owning tile, even for coastal tiles. */
export function shouldInvalidateMask(rec, tx, tz) {
  return (rec.tile.tx === tx && rec.tile.tz === tz) || !!rec.tile.parks?.length;
}

export function markMaskDirty(rec) {
  const now = performance.now(), state = maskChanges.get(rec);
  maskChanges.set(rec, { first: state?.first ?? now, last: now });
}

export function canBuildMask(rec, ctx) {
  // First ground must appear promptly. Only debounce repaints of visible tiles.
  if (!rec.mask || ctx.quality.level !== 'mobile') return true;
  const state = maskChanges.get(rec);
  if (!state) return true;
  const now = performance.now();
  return now - state.last >= 100 || now - state.first >= 400;
}

export function beginMaskBuild(rec) { maskChanges.delete(rec); }

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
  // Prepared tiles already carry complete road context and cannot be dirtied
  // by neighboring arrivals. Their first roads need no settling delay.
  if (rec.tile.streetContext) return true;
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
  return params.get('streetMobile') === '1' ? MOBILE_STREET_BUDGET.mapSize : 128;
}

/** Facade color and normal maps share the cap; unrelated scene maps keep theirs. */
export function buildingTextureUrl(url) {
  const parsed = new URL(url, 'https://textures.invalid');
  if (!parsed.pathname.includes('/assets/textures-mobile/')) return url;
  parsed.searchParams.set('buildingMobile', '1');
  return /^(https?:)?\/\//.test(url) ? parsed.href : parsed.pathname + parsed.search + parsed.hash;
}

/** Three road steps per background step, within the existing frame
 * deadline. Keep buildings progressing even during continuous road streaming.
 * Queue items return to the tail after yielding, preserving fairness on ties.
 */
export function nextSceneBuild(ready, ctx, turn) {
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
  if (!ctx.world?.tilePriority) return queue.shift();
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
