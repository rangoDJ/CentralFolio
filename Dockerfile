# Use Node.js LTS (v22+)
FROM node:22-slim

# Install sqlite3 dependencies (needed for better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy application source
COPY . .

# Expose the application port
EXPOSE 3000

# Start the application using tsx as defined in package.json
CMD ["npm", "start"]
