# Демо-стенд в одном контейнере: API отдаёт и собранный фронтенд (STATIC_DIR).
# Рабочая установка — docker-compose.yml (отдельно nginx + API + PostgreSQL).

FROM node:22.12-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM node:22.12-alpine AS api
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ .
RUN npx prisma generate && npx nest build

FROM node:22.12-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=UTC STATIC_DIR=/app/public
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm install --no-save prisma@6.19.3 ts-node@10.9.2 typescript@5.7.3 && npm cache clean --force
COPY --from=api /app/dist ./dist
COPY --from=api /app/node_modules/.prisma ./node_modules/.prisma
COPY backend/prisma ./prisma
COPY backend/src ./src
COPY backend/tsconfig.json ./
COPY --from=web /web/dist ./public
RUN mkdir -p var/files var/mail && chown -R node:node var
USER node
EXPOSE 3000
# Миграции → справочники (+ демо-данные при DEMO_DATA=true, только в пустую БД) → запуск
CMD ["sh", "-c", "npx prisma migrate deploy && npx ts-node --transpile-only prisma/seed.ts && node dist/main.js"]
