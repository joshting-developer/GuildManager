FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001 \
    DATABASE_PATH=/data/guildmanager.sqlite
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/src/domain ./src/domain
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "server/index.js"]
