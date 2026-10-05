# syntax=docker/dockerfile:1
# -- Compilation de l'interface -------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY . .
RUN npm run typecheck && npm test && npm run build

# -- Image d'exécution -------------------------------------------------------------
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATABASE_PATH=/app/data/compta.db NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/core/src packages/core/src
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
COPY scripts scripts
COPY docs/exemples docs/exemples
RUN mkdir -p /app/data /app/sauvegardes && chown -R node:node /app/data /app/sauvegardes
USER node
VOLUME ["/app/data", "/app/sauvegardes"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--import", "tsx", "apps/api/src/server.ts"]
