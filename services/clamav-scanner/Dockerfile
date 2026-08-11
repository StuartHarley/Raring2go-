FROM node:22.18.0-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends clamav clamav-daemon ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY services/clamav-scanner/package.json services/clamav-scanner/package.json

RUN corepack enable \
  && corepack prepare pnpm@11.16.0 --activate \
  && pnpm install --filter @raring2go/clamav-scanner --prod=false --frozen-lockfile

COPY services/clamav-scanner services/clamav-scanner

RUN pnpm --filter @raring2go/clamav-scanner exec tsc --noEmit false

COPY services/clamav-scanner/clamd.conf /etc/clamav/clamd.conf
COPY services/clamav-scanner/freshclam.conf /etc/clamav/freshclam.conf
COPY services/clamav-scanner/start.sh /app/start.sh

RUN chmod +x /app/start.sh \
  && mkdir -p /run/clamav /var/log/clamav \
  && chown -R clamav:clamav /run/clamav /var/log/clamav /var/lib/clamav

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["/app/start.sh"]
