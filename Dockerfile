# syntax=docker/dockerfile:1

# ---- Base ----
FROM node:22-alpine AS base
# libc6-compat is needed by some native deps on Alpine (e.g. bcrypt)
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ---- Dependencies (dev + prod, needed to build) ----
# Workspace package.json files must be present for `yarn install` to resolve
# the monorepo's workspaces and validate the lockfile — copying only the root
# manifest would make yarn think there are no workspace packages at all.
FROM base AS deps
COPY package.json yarn.lock ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client-student/package.json client-student/package.json
RUN yarn install --frozen-lockfile --network-timeout 600000

# ---- Production-only dependencies ----
FROM base AS prod-deps
COPY package.json yarn.lock ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client-student/package.json client-student/package.json
RUN yarn install --frozen-lockfile --production --network-timeout 600000

# ---- Builder ----
FROM base AS builder
COPY --from=deps /app ./
COPY . .
RUN yarn build:shared && yarn build:server && yarn build:client-student

# ---- Runner (production) ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

# Run as an unprivileged user
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 app

# node_modules includes the yarn-workspaces symlink node_modules/@beton-boi/shared
# -> ../shared, so shared/dist + shared/package.json must land at that relative
# path for the server's `@beton-boi/shared` import to resolve at runtime.
COPY --from=prod-deps --chown=app:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=app:nodejs /app/shared/dist ./shared/dist
COPY --from=builder --chown=app:nodejs /app/shared/package.json ./shared/package.json
COPY --from=builder --chown=app:nodejs /app/server/dist ./server/dist
COPY --from=builder --chown=app:nodejs /app/server/package.json ./server/package.json

# Served statically by the Nest app in production — see server/src/main.ts.
COPY --from=builder --chown=app:nodejs /app/client-student/dist ./client-student

USER app
EXPOSE 3000

CMD ["node", "server/dist/main.js"]
