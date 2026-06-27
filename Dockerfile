# ---- Build Stage ----
FROM node:22 AS build
WORKDIR /app

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/hook-server/package.json packages/hook-server/
COPY packages/mcp-gateway/package.json packages/mcp-gateway/
COPY packages/cli/package.json packages/cli/
COPY packages/opencode-plugin/package.json packages/opencode-plugin/

RUN npm ci

# Copy source and type-check
COPY . .
RUN npx tsc --noEmit

# ---- Runtime Stage ----
FROM node:22-slim AS runtime
WORKDIR /app

# Copy installed dependencies
COPY --from=build /app/node_modules ./node_modules

# Copy source code (tsx runs TypeScript directly)
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/core/src ./packages/core/src
COPY --from=build /app/packages/core/package.json ./packages/core/package.json
COPY --from=build /app/packages/hook-server/src ./packages/hook-server/src
COPY --from=build /app/packages/hook-server/package.json ./packages/hook-server/package.json
COPY --from=build /app/packages/mcp-gateway/src ./packages/mcp-gateway/src
COPY --from=build /app/packages/mcp-gateway/package.json ./packages/mcp-gateway/package.json
COPY --from=build /app/packages/cli/src ./packages/cli/src
COPY --from=build /app/packages/cli/package.json ./packages/cli/package.json

# Create persistent data directory
RUN mkdir -p .warden && chown -R node:node /app

# Switch to non-root user
USER node

# Expose the hook server port
EXPOSE 7429

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:7429/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Start the hook server via tsx (TypeScript runner)
CMD ["npx", "tsx", "packages/cli/src/bin.ts", "start", \
     "--config", "warden.config.yml", \
     "--db", ".warden/ledger.db", \
     "--port", "7429"]
