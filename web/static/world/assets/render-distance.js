// Scale the device's normal distances without changing its residency or work budgets.
export const RENDER_DISTANCE_KEY = 'nyc.renderDistance';
export function normalizeRenderDistance(value) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? 100
    : Math.max(50, Math.min(200, Math.round(number / 25) * 25));
}

export function configureRenderDistance(world, quality) {
  const base = { near: quality.drawDistance, far: quality.farDistance };
  let selected = 100;
  try { selected = normalizeRenderDistance(globalThis.localStorage?.getItem(RENDER_DISTANCE_KEY)); } catch {}
  function apply(value, persist = true) {
    selected = normalizeRenderDistance(value);
    quality.drawDistance = Math.max(256, Math.round(base.near * selected / 100));
    quality.farDistance = Math.min(8000, Math.round(base.far * selected / 100));
    world.setDrawDistance(quality.drawDistance);
    world.farRadius = world.ios ? 1 : Math.ceil(quality.farDistance / 256);
    if (persist) {
      try { globalThis.localStorage?.setItem(RENDER_DISTANCE_KEY, String(selected)); } catch {}
    }
  }
  world.renderDistance = {
    get value() { return selected; },
    get near() { return quality.drawDistance; },
    get far() { return quality.farDistance; },
    set: apply,
  };
  apply(selected, false);
  return world;
}
