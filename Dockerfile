# syntax=docker/dockerfile:1
FROM node:24.21.0-bookworm-slim

LABEL org.opencontainers.image.title="Silicon Infinity" \
      org.opencontainers.image.description="Digital circuit and MCU design laboratory" \
      org.opencontainers.image.version="0.9.0-selfhost.1" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    SILICON_DATA_DIR=/data

WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node LICENSE ./
COPY --chown=node:node game/ ./game/
COPY --chown=node:node server/ ./server/
COPY --chown=node:node selfhost/ ./selfhost/
COPY --chown=node:node drizzle/ ./drizzle/
COPY --chown=node:node docs/CHIP-USER-MANUAL.html ./docs/CHIP-USER-MANUAL.html

RUN mkdir -p /data && chown node:node /data
USER 1000:1000
EXPOSE 8080
VOLUME ["/data"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/healthz',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "selfhost/main.mjs"]
