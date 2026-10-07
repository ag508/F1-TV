# Multi-stage build for F1-TV App
FROM node:22-alpine AS client-builder

# Build client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Production image
FROM node:22-alpine

# FFmpeg for restreaming. On x86_64 also install the Intel VAAPI drivers so
# FFmpeg can decode/encode on Intel iGPUs (e.g. UHD 630 / Quick Sync) when
# /dev/dri is passed into the container. arm64 builds skip them.
RUN apk add --no-cache ffmpeg \
  && if [ "$(apk --print-arch)" = "x86_64" ]; then \
       apk add --no-cache intel-media-driver libva-intel-driver libva-utils; \
     fi

# Create app directory
WORKDIR /app

# Copy server dependencies
COPY server/package*.json ./
RUN npm ci --omit=dev

# Copy server source
COPY server/ ./

# Copy built client from builder stage
COPY --from=client-builder /app/client/dist ./public

# Expose port
EXPOSE 3001

# Health check: use IPv4 explicitly (localhost resolves to ::1 first on Alpine,
# but the server listens on 0.0.0.0) and handle connection errors instead of
# crashing with an unhandled 'error' event.
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3001)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Set environment to production
ENV NODE_ENV=production
# Intel iHD driver (Gen9+ iGPUs such as UHD 630)
ENV LIBVA_DRIVER_NAME=iHD

# Start server
CMD ["node", "server.js"]
