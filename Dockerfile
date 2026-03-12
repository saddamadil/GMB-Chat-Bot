# ─────────────────────────────────────────────
#  GMB AI Agent — Dockerfile
#  Works on Railway, Render, Heroku, VPS, etc.
# ─────────────────────────────────────────────

# Use official Node.js LTS (Alpine = small image)
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (for layer caching)
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy all source files
COPY . .

# Don't run as root (security best practice)
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

# Expose the port the app runs on
EXPOSE 3001

# Health check — Railway/Render use this
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Start the server
CMD ["node", "server.js"]
