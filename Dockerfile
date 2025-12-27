# Use Node.js LTS version as base image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY . .

# Install dev dependencies for building
RUN npm ci

# Build TypeScript to JavaScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Copy data directory if it exists
COPY data/ ./data/

# Expose any ports if needed (adjust if your app uses ports)
# EXPOSE 3000

# Set the entry point
ENTRYPOINT ["node", "dist/main.js"]

# Default command (can be overridden)
CMD []

