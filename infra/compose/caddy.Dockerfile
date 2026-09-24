FROM node:24-bookworm-slim AS web
WORKDIR /src
RUN corepack enable
COPY . .
# The deployed git SHA, compared with control's /api/health to offer a reload (SPEC §14.3).
ARG RS_APP_VERSION=dev
ENV RS_APP_VERSION=${RS_APP_VERSION}
RUN pnpm install --frozen-lockfile && pnpm --filter @raelstream/web build

FROM caddy:2.11
COPY infra/proxy/Caddyfile infra/proxy/app-routes.caddy /etc/caddy/
COPY --from=web /src/apps/web/dist /srv/web
