# Warden Console Phase 0

This runnable demo creates an isolated SQLite ledger, evaluates three real
Warden scenarios (allow, deny-wins, and approved confirmation), and writes a
structured audit export. It does not read or modify a project policy or ledger.

Run it offline:

```bash
npm run demo:console-phase-0
```

The command prints the exact temporary directory containing `warden-ledger.db`
and `warden-audit.json`.

To publish the completed evidence to a local Sideshow board, start Sideshow in
another terminal and pass its URL explicitly:

```bash
npx sideshow serve --port 8228
npm run demo:console-phase-0 -- --sideshow-url http://127.0.0.1:8228
```

Sideshow is outside Warden's enforcement path. If it is unavailable, only the
explicit publishing invocation fails; normal Warden hook-server and proxy
decisions never import or call this example.

The board makes the boundary visible: Warden governs MCP tools routed through
its proxy. Native tools are not governed by that proxy without a separate,
verified integration.

To record the actual board after the demo publishes its evidence:

```bash
npm run demo:console-phase-0:capture -- --sideshow-url http://127.0.0.1:8228 --output /tmp/warden-console-phase-0.webm
```

The recording stays local. It is not uploaded or included in the package.
