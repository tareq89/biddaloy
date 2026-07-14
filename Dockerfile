# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:22-alpine AS base
# libc6-compat is needed by some native deps on Alpine
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Dependencies ----
FROM base AS deps
COPY package.json yarn.lock ./
# --network-concurrency 1 + long timeout avoid aborted parallel downloads of
# sharp's many optional platform binaries, which corrupt the Yarn 1 cache.
RUN yarn install --frozen-lockfile --network-concurrency 1 --network-timeout 600000

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN yarn build

# ---- Runner (production) ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as an unprivileged user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone output already contains a minimal node_modules + server.js
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
