# ---- stage 1: install workspace deps, build the corpus bundle, build the web SPA ----
FROM node:22-bookworm-slim AS build
WORKDIR /build

# Manifests first for better layer caching.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY data ./data
COPY scripts ./scripts
COPY web ./web
RUN npm run build

# ---- stage 2: runtime image ----
# Server deps are (re)installed standalone from server/package.json rather than copied out of
# the workspace install above — npm workspaces hoist most packages into the root node_modules,
# so "just copy server/node_modules" isn't reliable. Server's dependency set is small (express,
# cors, cookie-session, @google-cloud/firestore, all pure JS), so this is fast.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production

COPY server/package.json ./package.json
RUN npm install --omit=dev

COPY server/src ./src
COPY --from=build /build/web/dist ./web-dist

EXPOSE 8080
CMD ["node", "src/index.js"]
