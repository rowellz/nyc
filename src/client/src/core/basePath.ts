import { mobileTextureUrl } from './quality';

/** Build-time mount, shared by fetch/WS/world URLs and Vite's legacy asset-literal adapter. */
export function basePath(resource = ''): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '');
  if (!resource) return base;
  if (/^(?:[a-z]+:)?\/\//i.test(resource) || resource.startsWith('data:') || resource.startsWith('blob:')) return resource;
  return `${base}/${resource.replace(/^\//, '')}`;
}

/** Legacy manifests can construct /assets URLs dynamically (also inside workers).
 * Vite redirects module-local fetch calls here; never monkey-patch the browser's global fetch. */
export const mountedFetch: typeof fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  let mapped = raw;
  if (raw.startsWith('/assets/')) mapped = basePath(raw);
  else if (typeof location !== 'undefined') {
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && url.pathname.startsWith('/assets/')) {
      url.pathname = basePath(url.pathname);
      mapped = url.href;
    }
  }
  mapped = mobileTextureUrl(mapped);
  return globalThis.fetch(mapped === raw ? input : input instanceof Request ? new Request(mapped, input) : mapped, init);
};
