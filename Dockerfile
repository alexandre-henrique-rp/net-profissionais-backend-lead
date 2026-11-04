# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app

# Prisma 7 gera o client durante postinstall e precisa do schema/config presentes.
COPY package.json yarn.lock prisma7.config.ts ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:24-alpine AS production-dependencies
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production --ignore-scripts

# Ferramentas de desenvolvimento/Prisma CLI ficam fora da imagem runtime.
# Este target só é usado manualmente para aplicar migrations compatíveis.
FROM build AS migrate
CMD ["yarn", "prisma:deploy"]

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
	PORT=3000
WORKDIR /app

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=production-dependencies --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000

HEALTHCHECK --interval=5s --timeout=3s --start-period=15s --retries=12 \
	CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/main.js"]
