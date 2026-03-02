# ── Build ─────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# ── Runtime ───────────────────────────────
FROM node:20-slim
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip ffmpeg curl ca-certificates && \
    pip3 install --break-system-packages youtube-transcript-api && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
      -o /usr/local/bin/yt-dlp && \
    chmod +x /usr/local/bin/yt-dlp && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/index.js"]
