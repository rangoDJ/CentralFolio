# Use Node.js LTS (v22+)
FROM node:22-slim

# Install sqlite3 dependencies (needed for better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Express renders err.stack into its default error page unless this is set,
# and it enables the framework's production optimisations. The global error
# handler in src/server.ts no longer relies on it, but both should hold.
ENV NODE_ENV=production

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies. NOT --omit=dev: the container runs TypeScript directly
# through tsx, which is a devDependency, so trimming them breaks the entrypoint.
RUN npm ci --include=dev

# Copy application source
COPY . .

# Fail the build on type errors (tsx runs untyped at runtime, so this is the gate).
RUN npx tsc --noEmit

# Run as a non-root user rather than the container default (root).
RUN chown -R node:node /app
USER node

# Expose the application port
EXPOSE 3000

# Start the application using tsx as defined in package.json
CMD ["node_modules/.bin/tsx", "src/server.ts"]
