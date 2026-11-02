FROM node:22-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates openssh-client && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY plugins ./plugins
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci --ignore-scripts && npm run build

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates openssh-client && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app /app
RUN npm install -g @deepseek-ai/dsh@0.2.1-alpha.5 --registry=https://registry.npmmirror.com
COPY docker/profile /dsh-home/profiles/web
COPY docker/render-profile.mjs /app/docker/render-profile.mjs
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
RUN cd /dsh-home/profiles/web && npm install --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com
RUN chmod +x /app/docker/entrypoint.sh
ENV DSH_HOME=/dsh-home NODE_ENV=production
EXPOSE 9090
ENTRYPOINT ["/app/docker/entrypoint.sh"]
