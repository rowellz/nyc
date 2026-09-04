import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // /world/* is owned by the game service and proxied there (see server.js and
    // vite.config.ts), so SvelteKit must never try to route or prerender it.
    files: { assets: 'static' },
  },
};
