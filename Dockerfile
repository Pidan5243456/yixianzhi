FROM node:24.15.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
WORKDIR /app
COPY server ./server
COPY scripts/build-web.cjs scripts/web-files.cjs ./scripts/
COPY js ./js
COPY css ./css
COPY assets ./assets
COPY *.html ./
RUN node scripts/build-web.cjs --release && mkdir -p /app/server/data && chown -R node:node /app/server/data
ENV NODE_ENV=production PORT=8394 DATA_DIR=/app/server/data
USER node
VOLUME ["/app/server/data"]
EXPOSE 8394
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8394/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/server.js"]
