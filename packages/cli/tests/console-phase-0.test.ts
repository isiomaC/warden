import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { runDemoScenarios } from "../src/console-phase-0.js";
import { toSideshowPost } from "../src/console-phase-0-presentation.js";
import { publishSideshowPost } from "../src/console-phase-0-sideshow.js";

describe("Console Phase 0 scenarios", () => {
  it("records allow, deny-wins, and approved confirmation in one valid ledger", async () => {
    const result = await runDemoScenarios({ databasePath: ":memory:" });

    expect(result.steps.map((step) => step.decision)).toEqual(["ALLOW", "DENY", "ALLOW"]);
    expect(result.steps[1]?.matchedRules).toEqual(["allow-write", "deny-untrusted-write"]);
    expect(result.steps[2]?.approval).toBe("approved");
    expect(result.chain).toEqual({ valid: true });
    expect(result.audit.entries).toHaveLength(3);
    expect(result.audit.entries.map((entry) => entry.decision)).toEqual(["ALLOW", "DENY", "ALLOW"]);
  });

  it("renders completed decisions, chain status, and audit evidence for Sideshow", async () => {
    const result = await runDemoScenarios({ databasePath: ":memory:" });
    const post = toSideshowPost(result);

    expect(post.title).toBe("Warden Console Phase 0");
    expect(post.surfaces.map((surface) => surface.kind)).toEqual(["markdown", "json", "json"]);
    expect(post.surfaces[0]).toHaveProperty("markdown");
    expect(post.surfaces[1]).toHaveProperty("data");
    expect(JSON.stringify(post)).toContain("Deny wins");
    expect(JSON.stringify(post)).toContain("native tools");
    expect(JSON.stringify(post)).toContain("audit");
  });

  it("publishes the completed post to Sideshow's canonical endpoint", async () => {
    const result = await runDemoScenarios({ databasePath: ":memory:" });
    const post = toSideshowPost(result);
    const requests: Array<{ path: string; body: unknown }> = [];
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        requests.push({
          path: request.url ?? "",
          body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
        });
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ id: "post-1" }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port");

    try {
      await expect(publishSideshowPost(`http://127.0.0.1:${address.port}`, post)).resolves.toEqual({ id: "post-1" });
      expect(requests).toEqual([{ path: "/api/posts", body: post }]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
