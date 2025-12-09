# Multi-stage build for F1-TV App
FROM node:18-alpine AS client-builder

# Build client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Production image
FROM node:18-alpine

# Install FFmpeg (required for stream restreaming)
RUN apk add --no-cache ffmpeg

# Create app directory
WORKDIR /app

# Copy server dependencies
COPY server/package*.json ./
RUN npm ci --only=production

# Copy server source
COPY server/ ./

# Copy built client from builder stage
COPY --from=client-builder /app/client/dist ./public

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Set environment to production
ENV NODE_ENV=production

# Start server
CMD ["node", "server.js"]
