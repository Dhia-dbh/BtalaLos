import { setTimeout } from "node:timers/promises";
import { digest, requireValue } from "./tools.mjs";

export async function hostOperation(config, input, signal, operationId) {
  requireValue(config.hostToken?.length >= 32, "Configure the host companion token.");
  const endpoint = `${config.hostUrl.replace(/\/$/, "")}/operations/${digest(`${operationId}:${JSON.stringify(input)}`)}`;
  const headers = { authorization: `Bearer ${config.hostToken}`, "content-type": "application/json" };
  const controller = AbortSignal.any([signal, AbortSignal.timeout(910_000)]);
  const cancel = () => {
    void fetch(endpoint, { method: "DELETE", headers, signal: AbortSignal.timeout(5000) }).catch(() => {});
  };
  controller.throwIfAborted();
  controller.addEventListener("abort", cancel, { once: true });
  try {
    const posted = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(input), signal: controller });
    if (!posted.ok) throw new Error((await posted.json()).error || "Host companion rejected the operation.");
    for (;;) {
      const response = await fetch(endpoint, { headers, signal: controller });
      const record = await response.json();
      if (!response.ok || record.status === "FAILED") throw new Error(record.error || "Host operation failed.");
      if (record.status === "DONE") return record.result;
      await setTimeout(500, undefined, { signal: controller });
    }
  } catch (error) {
    if (controller.aborted) throw new Error("Host operation cancelled or timed out.");
    if (error instanceof TypeError)
      throw new Error("Cannot reach the host companion. Check its service and configured URL.");
    throw error;
  } finally {
    controller.removeEventListener("abort", cancel);
  }
}
