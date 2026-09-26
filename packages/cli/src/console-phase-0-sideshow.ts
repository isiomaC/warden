import type { SideshowPost } from "./console-phase-0-presentation.js";

export async function publishSideshowPost(
  boardUrl: string,
  post: SideshowPost,
): Promise<{ id: string }> {
  const endpoint = new URL("/api/posts", boardUrl);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(post),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(`Sideshow board unavailable at ${new URL(boardUrl).origin}`, { cause: error });
  }

  if (!response.ok) {
    throw new Error(`Sideshow board rejected the post at ${endpoint}: HTTP ${response.status}`);
  }
  const result = await response.json() as { id?: unknown };
  if (typeof result.id !== "string") {
    throw new Error(`Sideshow board returned no post id at ${endpoint}`);
  }
  return { id: result.id };
}
