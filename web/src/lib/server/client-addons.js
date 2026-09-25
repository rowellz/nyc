/**
 * Scripts the SvelteKit service adds to the mirrored client on the way out.
 *
 * public/ is shared with the original `nyc` container and stays byte-for-byte as
 * mirrored, so changes to the client cannot be made there. Instead the HTML is
 * rewritten as it is served: each addon is a plain script in web/static/, loaded
 * after the client's own bundle, that reaches the running game through
 * `window.__game`. Only this service serves them.
 *
 * In development desktop pages load Vite's HMR client, which receives
 * the reload the watcher in vite.config.js sends when the mirrored bundle
 * changes. Nothing else would inject it — these pages are served as bytes off
 * disk, not rendered by SvelteKit.
 */

const DEV = process.env.NODE_ENV !== 'production';

// A phone testing the city should not rebuild its entire WebGL scene whenever
// an editor saves a file. Keep the dev runtime/socket out of mobile game pages;
// ?live=1 opts in, and ?live=0 also disables it on desktop. This does not affect
// SvelteKit's own pages or the game's WebSocket connection.
const DEV_TAGS = DEV ? `<script>
(() => {
  const live = new URLSearchParams(location.search).get('live');
  const mobile = /iPad|iPhone|iPod|Android|Mobile|Silk/i.test(navigator.userAgent)
    || /Mac/i.test(navigator.userAgent + navigator.platform) && navigator.maxTouchPoints > 0
    || typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (live !== '1' && (live === '0' || mobile)) return;
  const script = document.createElement('script');
  script.type = 'module';
  script.src = '/@vite/client';
  document.head.appendChild(script);
})();
</script>` : '';

/** Addon scripts per page, relative to PUBLIC_DIR. Injected in order. */
export const ADDONS = {
  'world/index.html': [
    // Stops rapid thumbstick touches from becoming Safari double-tap or pinch
    // zoom gestures. The game controls use Pointer Events for their actions.
    '/world-addons/touch-zoom.js',
    // Keeps a collapsible HUD in the upper-left, lets the touch map collapse to a small
    // button, and gives admins a live traffic-density control beside it.
    '/world-addons/mobile-map.js',
    '/world-addons/render-distance.js',
    // A right-hand camera stick for touch devices, in both of the client's
    // modes; upstream ships only a movement stick and a drag-to-look zone.
    '/world-addons/look-stick.js',
    // Keeps camera mode from tripping the iOS crash guard, and remembers the
    // viewpoint for safe-return.js below.
    '/world-addons/camera-boot.js',
    // Turns the river's sky and skyline reflections down.
    '/world-addons/water-reflection.js',
  ],
  'world/safe.html': [
    // Offers the viewpoint back, instead of only "retry" into Bryant Park.
    '/world-addons/safe-return.js',
  ],
};

const tagsFor = (scripts) => scripts.map((src) => `<script src="${src}" defer></script>`).join('\n');

/**
 * The transform for a page that takes addons, or null for everything else —
 * which is most of public/, and goes out untouched.
 * @param {string} rel path relative to PUBLIC_DIR
 * @returns {((html: string) => string) | undefined}
 */
export function addonsFor(rel) {
  const scripts = ADDONS[rel];
  if (!scripts || !scripts.length) return undefined;
  let tags = DEV_TAGS ? `${DEV_TAGS}\n${tagsFor(scripts)}` : tagsFor(scripts);
  if (rel === 'world/index.html') tags += '\n<div style="position:fixed;bottom:3px;left:6px;z-index:30;padding:2px 4px;background:#0009;color:#ddd;font:10px sans-serif"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener" style="color:inherit">© OpenStreetMap contributors</a> · <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener" style="color:inherit">Terrain: USGS / Mapzen</a></div>';
  return (html) => {
    // safe.html has no <body> of its own, so fall back to the closing <html>.
    for (const marker of ['</body>', '</html>']) {
      const at = html.lastIndexOf(marker);
      if (at !== -1) return `${html.slice(0, at)}${tags}\n${html.slice(at)}`;
    }
    return `${html}\n${tags}\n`;
  };
}
