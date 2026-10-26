# syntax=docker/dockerfile:1

FROM oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --if-present --filter '*' build
# Reinstall without devDependencies; the build output stays in place.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
    && bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim
RUN groupadd --gid 10001 keryx \
    && useradd --uid 10001 --gid keryx --no-create-home --shell /usr/sbin/nologin keryx \
    && mkdir /data && chown keryx:keryx /data
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
USER keryx
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "apps/server/src/main.ts"]
