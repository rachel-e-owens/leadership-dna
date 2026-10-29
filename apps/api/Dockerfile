FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci

COPY apps/api apps/api

WORKDIR /app/apps/api
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
RUN npm run prisma:generate && npm run build

FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm ci --workspace=@leadership-dna/api --include-workspace-root=false

COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma
COPY --from=build /app/node_modules/@prisma /app/node_modules/@prisma
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/prisma apps/api/prisma

WORKDIR /app/apps/api

ENV NODE_ENV=production

EXPOSE 4000

CMD ["sh", "-c", "node dist/src/check-config.js && npx prisma migrate deploy && if [ \"$SEED_DEMO\" = \"true\" ]; then npm run prisma:seed; fi && npm start"]
