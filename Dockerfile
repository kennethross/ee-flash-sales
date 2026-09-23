# syntax=docker/dockerfile:1
#
# Four stages. The runtime image carries only production dependencies, the compiled server and
# the page, and it cannot be produced unless the test stage passed (it copies a marker from it).
#
#   deps ─► build ─► test ─┐
#                          ├─► runtime
#   (production deps) ─────┘

# ---------------------------------------------------------------------------------------------
# 1. deps: every dependency, for building and testing
FROM node:22-alpine AS deps
WORKDIR /app
ENV HUSKY=0
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------------------------
# 2. build: type-check, compile the page with tsc, bundle the server with esbuild
FROM deps AS build
COPY tsconfig.json tsconfig.web.json ./
COPY src ./src
COPY public ./public
RUN npm run typecheck && npm run build

# ---------------------------------------------------------------------------------------------
# 3. test: lint and the whole suite; leaves a marker the runtime stage depends on
FROM build AS test
COPY eslint.config.js .prettierrc.json .prettierignore vitest.config.ts ./
COPY scripts ./scripts
COPY tests ./tests
RUN npm run format:check && npm run lint && npm test && touch /app/.tests-passed

# ---------------------------------------------------------------------------------------------
# 4. runtime: production dependencies only, non-root, health-checked
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the prepare hook installs husky, which is a dev dependency and needs git.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/public ./public
COPY --from=test /app/.tests-passed ./.tests-passed
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# node is PID 1 here and handles SIGTERM itself (see src/main.ts), so `docker stop` is graceful.
CMD ["node", "dist/main.js"]
