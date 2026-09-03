# backend/Dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies (only production)
RUN npm install --omit=dev

# Copy backend source code
COPY src/ ./src/

# Expose HTTP port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Run server
CMD ["node", "src/server.js"]
