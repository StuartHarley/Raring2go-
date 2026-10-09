FROM node:22.18.0-bookworm-slim AS base

# Chromium prints the pages; Ghostscript converts to PDF/X-1a. Fonts are what the layouts can use: add the
# brand fonts here (and to the templates) or text will fall back to these.
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ghostscript fonts-liberation fonts-dejavu-core ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY services/pdf-render/package.json services/pdf-render/package.json

RUN corepack enable \
  && corepack prepare pnpm@11.16.0 --activate \
  && pnpm install --filter @raring2go/pdf-render --prod=false --frozen-lockfile

COPY services/pdf-render services/pdf-render

RUN pnpm --filter @raring2go/pdf-render exec tsc --noEmit false

# The press profile is licensed separately and is NOT in this image. Mount or bake your printer's CMYK ICC profile
# (for example FOGRA39 or PSO Coated v3) and point OUTPUT_INTENT_ICC at it; without it print renders are refused.
ENV NODE_ENV=production
ENV PORT=3000
ENV CHROMIUM_PATH=/usr/bin/chromium
ENV GHOSTSCRIPT_PATH=/usr/bin/gs
EXPOSE 3000

USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "services/pdf-render/dist/server.js"]
