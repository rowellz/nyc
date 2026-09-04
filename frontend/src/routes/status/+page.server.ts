import { fetchStatus } from '$lib/server/game';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, setHeaders }) => {
  setHeaders({ 'cache-control': 'no-store' });
  return { status: await fetchStatus(fetch) };
};
