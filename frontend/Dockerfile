# SvelteKit frontend. Fronts the game service: serves the site routes itself and
# proxies /world/* (including the WebSocket upgrade) to the nyc container.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Only the runtime dependency (http-proxy) - SvelteKit's output is self-contained.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY --from=build /app/build ./build
COPY server.js ./

ENV PORT=3000 \
    HOST=0.0.0.0 \
    GAME_ORIGIN=http://nyc:8080 \
    GAME_BASE_PATH=/world

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/" >/dev/null || exit 1

CMD ["node", "server.js"]
