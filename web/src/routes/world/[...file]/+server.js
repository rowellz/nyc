/**
 * GET /world/*  — the mirrored client, its assets and the world tiles.
 *
 * In the original server this was a branch in the http request handler; here it
 * is an ordinary SvelteKit endpoint, which is why the SvelteKit process can be
 * the whole service. The more specific /world/api/* routes win over this rest
 * parameter, so they are never shadowed by a file lookup.
 */
import { redirect } from '@sveltejs/kit';

import { addonsFor } from '$lib/server/client-addons.js';
import { serveStatic } from '$lib/server/static.js';

// The client is built with BASE_URL=/world/ and asks for basePath('/world'), so
// both /world and /world/ have to resolve. SvelteKit would otherwise redirect
// the trailing-slash form away.
export const trailingSlash = 'ignore';

/** @type {import('./$types').RequestHandler} */
export async function GET({ params, url, request }) {
  const file = params.file;

  // /world -> /world/ , matching the original server's 302.
  if (!file && !url.pathname.endsWith('/')) {
    redirect(302, `${url.pathname}/${url.search}`);
  }
  // /world/ -> public/world/index.html. Pages this service extends get its
  // addon tags appended; everything else goes out exactly as mirrored.
  const rel = file ? `world/${file}` : 'world/index.html';
  return serveStatic(rel, { method: request.method, transform: addonsFor(rel) });
}

export const HEAD = GET;
