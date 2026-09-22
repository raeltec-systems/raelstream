# Build stage: install workspace and bundle the control service with its workspace packages.
FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @raelstream/control build

FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/apps/control/dist ./dist
COPY --from=build /src/infra/migrations ./migrations
USER node
CMD ["node", "dist/server.js"]
