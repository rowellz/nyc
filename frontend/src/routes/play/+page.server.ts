import { error } from '@sveltejs/kit';
import { fetchClientBundle } from '$lib/server/game';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  const bundle = await fetchClientBundle(fetch);
  if (!bundle) {
    error(503, 'The game service is unreachable. Is the "nyc" container running?');
  }
  return { bundle };
};
