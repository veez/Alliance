FROM node:22.12-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npx nest build

FROM node:22.12-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=UTC
COPY package*.json ./
RUN npm ci --omit=dev && npm install --no-save prisma@6.19.3 ts-node@10.9.2 typescript@5.7.3
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY src ./src
COPY tsconfig.json ./
USER node
EXPOSE 3000
# Миграции применяются при старте; справочники (регионы, шаблоны) — идемпотентно
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts && node dist/main.js"]
