# Stage 1: Install production dependencies
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# Stage 2: Production image
FROM node:20-alpine
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -u 1001 -S appuser -G appgroup

COPY --from=deps /app/node_modules ./node_modules
COPY data ./data
COPY server.js index.html index.css app.js manifest.json sw.js package.json ./

RUN chown -R appuser:appgroup /app
USER appuser

EXPOSE 8080
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:8080/api/health || exit 1

CMD ["node", "server.js"]
