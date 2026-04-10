FROM node:20-slim

# Install FFmpeg (used for Google Drive video compression before CDN upload)
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Run in watch mode — polls Lark every 15 minutes indefinitely
CMD ["node", "scheduler.js", "--watch"]
