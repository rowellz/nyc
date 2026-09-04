import { fetchStatus } from '$lib/server/game';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch }) => ({
  status: await fetchStatus(fetch),
});
