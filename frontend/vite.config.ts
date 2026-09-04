import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const GAME_ORIGIN = process.env.GAME_ORIGIN ?? 'http://127.0.0.1:8080';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    // In dev, Vite fronts the game service. In production the equivalent lives in
    // server.js, so the browser only ever talks to one origin.
    proxy: {
      '/world': { target: GAME_ORIGIN, changeOrigin: true, ws: true },
    },
  },
});
