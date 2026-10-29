import "server-only";
import { createHash } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { ActionError } from "@/lib/action";
import { AiError } from "@/lib/ai/errors";

export const checksum = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
function connection() {
  const url = process.env.DOSSIER_WORKER_URL;
  const token = process.env.DOSSIER_WORKER_TOKEN;
  if (!url || !token)
    throw new ActionError(
      "Configure DOSSIER_WORKER_URL and DOSSIER_WORKER_TOKEN on the Dossier server.",
    );
  return {
    url,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  };
}
export async function workerOperation<T>(
  key: string,
  input: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const { url, headers } = connection();
  const id = checksum(`${key}:${JSON.stringify(input)}`);
  const endpoint = `${url.replace(/\/$/, "")}/operations/${id}`;
  const stop = () => {
    void fetch(endpoint, {
      method: "DELETE",
      headers,
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  };
  const controller = AbortSignal.any([
    ...(signal ? [signal] : []),
    AbortSignal.timeout(920_000),
  ]);
  controller.throwIfAborted();
  controller.addEventListener("abort", stop, { once: true });
  try {
    const posted = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: controller,
    });
    if (!posted.ok)
      throw new Error(
        (await posted.json()).error ||
          "The host worker rejected this operation.",
      );
    for (;;) {
      const response = await fetch(endpoint, {
        headers,
        signal: controller,
        cache: "no-store",
      });
      const record = await response.json();
      if (!response.ok || record.status === "FAILED")
        throw new Error(record.error || "Host operation failed.");
      if (record.status === "DONE") return record.result as T;
      await setTimeout(500, undefined, { signal: controller });
    }
  } catch (error) {
    throw new AiError(
      "provider",
      controller.aborted
        ? "Preparation cancelled or timed out. Retry explicitly."
        : error instanceof Error && !(error instanceof TypeError)
          ? error.message
          : "Cannot reach the private application worker. Check its service and URL.",
    );
  } finally {
    controller.removeEventListener("abort", stop);
  }
}
