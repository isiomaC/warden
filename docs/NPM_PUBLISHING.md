# Warden — NPM Publishing Guide

How to build and publish all five `@wardenlabs/*` packages to a private npm registry (GitHub Packages).

---

## Package Inventory

| Package | npm Name | Internal Dependencies | External Dependencies |
|---|---|---|---|
| core | `@wardenlabs/core` | — | `better-sqlite3`, `ulid` |
| hook-server | `@wardenlabs/hook-server` | `@wardenlabs/core` | `hono`, `grammy` |
| mcp-gateway | `@wardenlabs/mcp-gateway` | `@wardenlabs/core` | `@modelcontextprotocol/sdk` |
| cli | `@wardenlabs/cli` | `@wardenlabs/core`, `@wardenlabs/hook-server` | `citty` |
| opencode-plugin | `@wardenlabs/opencode-plugin` | `@wardenlabs/core` (peer) | — |

**Publish order matters:** `core` first (no deps), then `hook-server` + `mcp-gateway` + `opencode-plugin` (all depend on core, parallel-safe), then `cli` last (depends on core + hook-server).

---

## 1. Pre-Publish Checklist

Before publishing any package, verify these pass:

```bash
# From repo root
npx tsc --noEmit        # Zero type errors
npx vitest run           # 104 tests pass
```

---

## 2. Prepare Packages for Publishing

Each package.json needs these publish-ready fields. Currently they have `"private": true` to prevent accidental publish. Update each before publishing:

### packages/core/package.json

```json
{
  "name": "@wardenlabs/core",
  "version": "0.1.0",
  "description": "Warden core — policy engine, trust tagger, hash-chained ledger, injection scanner",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

### packages/hook-server/package.json

```json
{
  "name": "@wardenlabs/hook-server",
  "version": "0.1.0",
  "description": "Warden hook server — Claude Code PreToolUse/PostToolUse/UserPromptSubmit HTTP handlers",
  "license": "MIT",
  "type": "module",
  "main": "./dist/server.js",
  "module": "./dist/server.js",
  "types": "./dist/server.d.ts",
  "exports": {
    ".": {
      "import": "./dist/server.js",
      "types": "./dist/server.d.ts"
    }
  },
  "files": ["dist"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "dependencies": {
    "@wardenlabs/core": "^0.1.0",
    "hono": "^4.0.0",
    "grammy": "^1.32.0"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

### packages/mcp-gateway/package.json

```json
{
  "name": "@wardenlabs/mcp-gateway",
  "version": "0.1.0",
  "description": "Warden MCP gateway — wrapMCP with policy enforcement, server registry, lateral detection",
  "license": "MIT",
  "type": "module",
  "main": "./dist/gateway.js",
  "module": "./dist/gateway.js",
  "types": "./dist/gateway.d.ts",
  "exports": {
    ".": {
      "import": "./dist/gateway.js",
      "types": "./dist/gateway.d.ts"
    }
  },
  "files": ["dist"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "dependencies": {
    "@wardenlabs/core": "^0.1.0",
    "@modelcontextprotocol/sdk": "^1.0.0"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

### packages/cli/package.json

```json
{
  "name": "@wardenlabs/cli",
  "version": "0.1.0",
  "description": "Warden CLI — init, start, audit, policy test, injection scan, supply-chain check",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": {
    "warden": "./dist/bin.js"
  },
  "files": ["dist"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "dependencies": {
    "@wardenlabs/core": "^0.1.0",
    "@wardenlabs/hook-server": "^0.1.0",
    "citty": "^0.1.6"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

### packages/opencode-plugin/package.json

```json
{
  "name": "@wardenlabs/opencode-plugin",
  "version": "0.1.0",
  "description": "Warden policy enforcement plugin for OpenCode",
  "license": "MIT",
  "type": "module",
  "main": "./warden-plugin.ts",
  "exports": {
    ".": "./warden-plugin.ts"
  },
  "files": ["warden-plugin.ts", "dist"],
  "publishConfig": {
    "registry": "https://npm.pkg.github.com",
    "access": "restricted"
  },
  "peerDependencies": {
    "@wardenlabs/core": "^0.1.0"
  },
  "scripts": {
    "build": "tsc",
    "prepublishOnly": "npm run build"
  }
}
```

The CLI also needs a bin entry point:

```typescript
// packages/cli/src/bin.ts
#!/usr/bin/env node
import { runMain } from "citty";
import main from "./index";

runMain(main);
```

---

## 3. Per-Package TypeScript Build Configs

Each package needs its own `tsconfig.json` for the `tsc` build step:

### packages/core/tsconfig.json

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests"]
}
```

(Repeat for `packages/hook-server/`, `packages/mcp-gateway/`, `packages/cli/`, `packages/opencode-plugin/` with same structure, adjusting `rootDir`.)

---

## 4. Authentication

### GitHub Packages

```bash
# In .npmrc at repo root:
@wardenlabs:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Generate a GitHub token with `read:packages` and `write:packages` scopes:

```bash
export GITHUB_TOKEN=ghp_...
```

### npm Private Registry (Verdaccio, npm Pro, etc.)

```bash
npm login --registry=https://npm.pkg.github.com --scope=@wardenlabs
# Enter GitHub username and token
```

---

## 5. Publishing

Publish in dependency order:

```bash
# Step 1: Core (no internal deps)
npm publish --workspace=packages/core

# Step 2: Hook server, MCP gateway, and OpenCode plugin (all depend on core)
npm publish --workspace=packages/hook-server
npm publish --workspace=packages/mcp-gateway
npm publish --workspace=packages/opencode-plugin

# Step 3: CLI (depends on core + hook-server)
npm publish --workspace=packages/cli
```

Or use the publish script:

```bash
#!/bin/bash
# scripts/publish-all.sh
set -e

PACKAGES=(
  "packages/core"
  "packages/hook-server"
  "packages/mcp-gateway"
  "packages/opencode-plugin"
  "packages/cli"
)

for pkg in "${PACKAGES[@]}"; do
  echo "=== Publishing $pkg ==="
  npm publish --workspace="$pkg" "$@"
done

echo "=== All packages published ==="
```

```bash
chmod +x scripts/publish-all.sh
./scripts/publish-all.sh
```

---

## 6. Verify Published Packages

```bash
# Check versions on registry
npm view @wardenlabs/core version
npm view @wardenlabs/hook-server version
npm view @wardenlabs/mcp-gateway version
npm view @wardenlabs/opencode-plugin version
npm view @wardenlabs/cli version

# Test install in a fresh project
mkdir /tmp/warden-test && cd /tmp/warden-test
npm init -y
npm install @wardenlabs/cli
npx warden scan --prompt "test"
```

---

## 7. Versioning Strategy

**Lockstep versioning:** All five packages share the same version number. When one bumps, all bump. This avoids dependency hell in a tightly coupled monorepo.

Follow semver (MAJOR.MINOR.PATCH):

```
0.1.0  — alpha, internal testing
0.2.0  — beta, early adopters
0.3.0  — release candidate
1.0.0  — GA release
```

Version bump commands:

```bash
# Bump all packages in lockstep
npm version patch --workspaces
npm version minor --workspaces
npm version major --workspaces
```

---

## 8. CI/CD Publishing (GitHub Actions)

```yaml
# .github/workflows/publish.yml
name: Publish to GitHub Packages

on:
  release:
    types: [published]

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      packages: write
      contents: read
      id-token: write   # required for --provenance

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          registry-url: https://npm.pkg.github.com
          scope: "@wardenlabs"

      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx vitest run

      - name: Build all packages
        run: |
          for pkg in packages/core packages/hook-server packages/mcp-gateway packages/opencode-plugin packages/cli; do
            npx tsc -p "$pkg/tsconfig.json"
          done

      - run: npm publish --provenance --workspace=packages/core
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - run: npm publish --provenance --workspace=packages/hook-server
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - run: npm publish --provenance --workspace=packages/mcp-gateway
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - run: npm publish --provenance --workspace=packages/opencode-plugin
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - run: npm publish --provenance --workspace=packages/cli
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

This workflow triggers when a GitHub Release is published. It runs typecheck + tests, builds all packages, then publishes in dependency order.

### npm Provenance

The `--provenance` flag generates a signed build provenance attestation using GitHub Actions OIDC. This cryptographically links the published package to the exact git commit and workflow that built it.

**Requirements:**
- `id-token: write` permission in the workflow (shown above)
- Public repository (or GitHub Enterprise with internal visibility)
- npm >= 9.5
- The `GITHUB_TOKEN` secret is automatically provided by GitHub Actions; no manual secret setup needed for provenance to work

**When publishing to npmjs.org instead of GitHub Packages,** replace the registry URL and use an npm automation token:

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 22
    registry-url: https://registry.npmjs.org
    scope: "@wardenlabs"

# Then authenticate with an npm automation token:
env:
  NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

The `NPM_TOKEN` is a granular access token created at https://www.npmjs.com/settings/[user]/tokens with type "Automation" (bypasses 2FA for CI/CD). Store it in GitHub repository secrets as `NPM_TOKEN`.
