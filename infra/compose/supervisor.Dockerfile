# Supervisor runtime: the pinned MediaMTX image supplies FFmpeg (one FFmpeg build across the media node,
# ADR-0002); Node comes from node:24-alpine (same Alpine release). Build the bundle first:
#   pnpm --filter @raelstream/supervisor build
FROM node:24-alpine AS node

FROM bluenviron/mediamtx:1.21.1-ffmpeg
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY infra/media/fonts/slate.ttf /usr/share/fonts/raelstream/slate.ttf
COPY apps/supervisor/dist/supervisor.js /app/supervisor.js
RUN adduser -D -H -u 10001 rs && mkdir -p /var/lib/raelstream/slates && chown rs /var/lib/raelstream/slates
USER rs
ENV NODE_ENV=production
ENTRYPOINT ["node", "/app/supervisor.js"]
