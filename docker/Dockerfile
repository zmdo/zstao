FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY plugins ./plugins
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci --ignore-scripts
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=builder /app /app
RUN npm install -g @deepseek-ai/dsh@0.2.1-rc.5 --registry=https://registry.npmmirror.com
# The loader does not pick the NAPI prebuild from the optional package; expose it
# through the local-build path that it probes next.
RUN ADDON=/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules/node-addon-require-builtin \
    && mkdir -p "$ADDON/build/napi/napi-v9-linux-x64-gnu" \
    && cp "$ADDON/../node-addon-require-builtin-linux-x64-gnu/prebuilt/linux-x64-gnu-napi-v9.node" "$ADDON/build/napi/napi-v9-linux-x64-gnu/require_builtin.node"
COPY docker/profile /opt/dsh-profile
COPY docker/render-profile.mjs /app/docker/render-profile.mjs
COPY docker/entrypoint.sh /app/docker/entrypoint.sh
COPY docker/healthcheck.mjs /app/docker/healthcheck.mjs
RUN cd /opt/dsh-profile && npm install --omit=dev --ignore-scripts --registry=https://registry.npmmirror.com
RUN chmod +x /app/docker/entrypoint.sh
ENV DSH_HOME=/dsh-home NODE_ENV=production DSH_TELEMETRY_DISABLED=1
EXPOSE 9090
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "/app/docker/healthcheck.mjs"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
