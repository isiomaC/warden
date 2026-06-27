# ---- Build Stage ----
# Install dependencies and run type-check as a validation gate
FROM oven/bun:1.2 AS build
WORKDIR /app

# Install build tools for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies first (layer caching)
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/hook-server/package.json packages/hook-server/
COPY packages/mcp-gateway/package.json packages/mcp-gateway/
COPY packages/cli/package.json packages/cli/
COPY packages/opencode-plugin/package.json packages/opencode-plugin/

RUN bun install

# Copy source and type-check
COPY . .
RUN bun run tsc --noEmit

# ---- Runtime Stage ----
FROM oven/bun:1.2-slim AS runtime
WORKDIR /app

# Copy installed dependencies from build stage
COPY --from=build /app/node_modules ./node_modules

# Copy workspace metadata and source
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages

# Ensure TS config is available for Bun's internal resolver
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Create persistent data directory and set ownership for non-root user
RUN mkdir -p .warden && chown -R bun:bun /app

# Switch to non-root user (bun user already exists in base image, uid 1000)
USER bun

# Expose the hook server port
EXPOSE 7429

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD bun -e "try{const r=await fetch('http://localhost:7429/health');process.exit(r.ok?0:1)}catch(_){process.exit(1)}"

# Start the hook server via the CLI
# Default config path is warden.config.yml — mount or copy your config
CMD ["bun", "run", "packages/cli/src/bin.ts", "start", \
     "--config", "warden.config.yml", \
     "--db", ".warden/ledger.db", \
     "--port", "7429"]
