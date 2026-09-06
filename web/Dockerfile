# The New York world service, ported to SvelteKit.
#
# Build context is the repository root, not web/: the image also carries the
# mirrored client and the 46 MB of world tiles from public/, which this service
# serves itself rather than proxying to the original container.
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so editing a route does not re-resolve the tree.
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY web/svelte.config.js web/vite.config.js web/jsconfig.json ./
COPY web/src ./src
COPY web/static ./static
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    BASE_PATH=/world \
    PUBLIC_DIR=/app/public

# adapter-node's output, plus the game modules server.js loads outside the
# SvelteKit bundle (it owns the http server so it can accept the WS upgrade).
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY web/package.json web/server.js ./
COPY web/src/lib/server ./src/lib/server
COPY web/src/lib/shared ./src/lib/shared

# The client + world payload, byte-for-byte as mirrored.
COPY public/ ./public/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/api/admin/me" >/dev/null || exit 1

CMD ["node", "server.js"]
