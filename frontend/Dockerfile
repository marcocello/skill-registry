FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable

COPY app/package.json app/pnpm-lock.yaml app/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY app/ ./

RUN pnpm run build

FROM nginx:1.28-alpine

COPY app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
