// Scale the device's normal distances without changing its residency or work budgets.
export const RENDER_DISTANCE_KEY = 'nyc.renderDistance';
export function normalizeRenderDistance(value, maximum = 200) {
  const number = Number(value);
  return value == null || value === '' || !Number.isFinite(number) ? 100
    : Math.max(50, Math.min(maximum, Math.round(number / 25) * 25));
}

export function configureRenderDistance(world, quality) {
  const base = { near: quality.drawDistance, far: quality.farDistance };
  const maximum = world.mobile || world.ios || quality.level === 'mobile' ? 100 : 200;
  let selected = 100;
  try { selected = normalizeRenderDistance(globalThis.localStorage?.getItem(RENDER_DISTANCE_KEY)); } catch {}
  function apply(value, persist = true) {
    selected = normalizeRenderDistance(value, maximum);
    quality.drawDistance = Math.max(256, Math.round(base.near * selected / 100));
    quality.farDistance = Math.min(8000, Math.round(base.far * selected / 100));
    world.setDrawDistance(quality.drawDistance);
    world.farRadius = world.ios ? 1 : Math.ceil(quality.farDistance / 256);
    if (persist) {
      try { globalThis.localStorage?.setItem(RENDER_DISTANCE_KEY, String(selected)); } catch {}
    }
  }
  world.renderDistance = {
    max: maximum,
    get value() { return selected; },
    get near() { return quality.drawDistance; },
    get far() { return quality.farDistance; },
    set: apply,
  };
  apply(selected, selected > maximum);
  return world;
}
