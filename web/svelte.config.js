import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
export default {
  kit: {
    // adapter-node emits build/handler.js, which server.js mounts behind the
    // static middleware and the WebSocket upgrade listener.
    adapter: adapter({ out: 'build' }),
  },
};
