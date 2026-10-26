# syntax=docker/dockerfile:1

FROM oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --if-present --filter '*' build
ARG GIT_SHA=dev
RUN bun apps/server/scripts/release.ts apps/console/dist "$GIT_SHA" > release.json
# Reinstall without devDependencies; the build output stays in place.
RUN find . -name node_modules -type d -prune -exec rm -rf {} + \
    && bun install --frozen-lockfile --production

FROM oven/bun:1.4.4-slim
RUN groupadd --gid 10001 keryx \
    && useradd --uid 10001 --gid keryx --no-create-home --shell /usr/sbin/nologin keryx \
    && mkdir /data && chown keryx:keryx /data
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    KERYX_DATA_DIR=/data \
    KERYX_KEK_FILE=/run/secrets/kek \
    KERYX_OPERATOR_TOKEN_FILE=/run/secrets/operator-token
USER keryx
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD ["bun", "-e", "const r = await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"]
CMD ["bun", "apps/server/src/main.ts"]
