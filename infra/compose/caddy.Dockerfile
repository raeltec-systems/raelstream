FROM node:24-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @raelstream/web build

FROM caddy:2.11
COPY infra/proxy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web /src/apps/web/dist /srv/web
