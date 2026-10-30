import path from "node:path";
import { pathToFileURL } from "node:url";
import { createWorker } from "./application-worker.mjs";
import { executeHost } from "./application-worker/host-actions.mjs";

export async function createHost(config) {
  const host = await createWorker(config, {
    executeOperation: executeHost,
    allowedKinds: ["capabilities", "generate", "reveal", "browser"],
    maxRequestBytes: 12 * 1024 * 1024,
  });
  const close = host.close;
  host.close = async () => {
    const { closeBrowsers } = await import("./browser/runtime.mjs");
    await closeBrowsers();
    await close();
  };
  return host;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const host = await createHost({
      token: process.env.DOSSIER_HOST_TOKEN,
      data: process.env.DOSSIER_HOST_DATA_DIR,
      exports: process.env.DOSSIER_WORKER_EXPORT_DIR,
      codex: process.env.DOSSIER_CODEX_BIN || "codex",
      claude: process.env.DOSSIER_CLAUDE_BIN || "claude",
      browserBinary: process.env.DOSSIER_BROWSER_BIN,
      browserEngine: process.env.DOSSIER_BROWSER_ENGINE,
      browserDisplay: process.env.DOSSIER_BROWSER_DISPLAY,
    });
    host.server.listen(Number(process.env.DOSSIER_HOST_PORT || 8789), "127.0.0.1", () => {
      console.log("BtalaLos host companion listening on loopback.");
    });
    host.server.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => void host.close());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
