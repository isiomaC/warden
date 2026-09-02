# Warden

`@stlw/warden` is a deterministic, fail-closed authorization runtime for AI agent actions.

```bash
npm install @stlw/warden
```

```ts
import { createWarden, definePolicy } from "@stlw/warden";

const warden = createWarden();
const decision = await warden.evaluate(
  definePolicy({ id: "allow-read", version: 1, rules: [{ id: "allow", effect: "ALLOW" }] }),
  { subject: { id: "agent-1" }, action: "read", resource: { id: "doc-1" } },
);
```

Unmatched rules and evaluation errors deny by default. See the [Warden repository](https://github.com/isiomaC/warden) for full documentation.
