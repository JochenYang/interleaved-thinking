# Build stage
FROM node:22.12-alpine AS builder

# Copy source files
COPY interleaved-thinking /app
COPY tsconfig.json /tsconfig.json

WORKDIR /app

# Install all dependencies (including dev dependencies for building)
RUN --mount=type=cache,target=/root/.npm npm install

# Build the project
RUN npm run build

# Install production dependencies only
RUN --mount=type=cache,target=/root/.npm-production npm ci --ignore-scripts --omit=dev

# Release stage
FROM node:22-alpine AS release

# Copy built files and dependencies from builder
COPY --from=builder /app/dist /app/dist
COPY --from=builder /app/package.json /app/package.json
COPY --from=builder /app/package-lock.json /app/package-lock.json
COPY --from=builder /app/node_modules /app/node_modules

ENV NODE_ENV=production

WORKDIR /app

ENTRYPOINT ["node", "dist/index.js"]
