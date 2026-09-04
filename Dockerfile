# Reconstructed "New York" world app: mirrored client + rebuilt server.
FROM node:20-alpine

WORKDIR /app

# Dependencies first, so the 46 MB world payload does not invalidate the npm layer.
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm install --omit=dev --no-audit --no-fund

# Server code, then the static client + world tiles.
COPY server/ ./server/
COPY public/ ./public/

ENV NODE_ENV=production \
    PORT=8080 \
    BASE_PATH=/world

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}${BASE_PATH}/api/admin/me" >/dev/null || exit 1

CMD ["node", "server/index.js"]
