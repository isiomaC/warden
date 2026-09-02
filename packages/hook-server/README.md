# Warden Hook Server

`@stlw/warden-hook-server` exposes local HTTP policy hooks for Claude Code, Codex CLI, and Copilot SDK integrations.

```bash
npm install @stlw/warden-hook-server @stlw/warden
```

```ts
import { createHookServer, startHookServer } from "@stlw/warden-hook-server";

const app = createHookServer({ config });
await startHookServer(app, 7429);
```

See the [Warden manual](https://github.com/isiomaC/warden/blob/main/docs/MANUAL.md) for client configuration.
