/**
 * Scripts the SvelteKit service adds to the mirrored client on the way out.
 *
 * public/ is shared with the original `nyc` container and stays byte-for-byte as
 * mirrored, so changes to the client cannot be made there. Instead the HTML is
 * rewritten as it is served: each addon is a plain script in web/static/, loaded
 * after the client's own bundle, that reaches the running game through
 * `window.__game`. Only this service serves them.
 */

/** Addon scripts per page, relative to PUBLIC_DIR. Injected in order. */
export const ADDONS = {
  'world/index.html': [
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
  const tags = tagsFor(scripts);
  return (html) => {
    // safe.html has no <body> of its own, so fall back to the closing <html>.
    for (const marker of ['</body>', '</html>']) {
      const at = html.lastIndexOf(marker);
      if (at !== -1) return `${html.slice(0, at)}${tags}\n${html.slice(at)}`;
    }
    return `${html}\n${tags}\n`;
  };
}
