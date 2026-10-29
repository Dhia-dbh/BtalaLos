import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, readdir, realpath } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { execute } from "./application-worker/operations.mjs";
import {
  atomic,
  digest,
  id,
  privateDirectory,
  requireValue,
} from "./application-worker/tools.mjs";

export async function createWorker(config) {
  requireValue(
    config.token?.length >= 32,
    "Set a private worker token of at least 32 characters.",
  );
  config.repository = await realpath(config.repository);
  const operations = await privateDirectory(path.join(config.data, "receipts"));
  const controllers = new Map();
  const accepted = new Map();
  let queue = Promise.resolve();
  const receipt = (key) => path.join(operations, `${id(key)}.json`);
  for (const name of await readdir(operations)) {
    if (!name.endsWith(".json")) continue;
    const record = JSON.parse(
      await readFile(path.join(operations, name), "utf8"),
    );
    if (record.status === "RUNNING" || record.status === "QUEUED")
      await atomic(
        path.join(operations, name),
        JSON.stringify({
          ...record,
          status: "FAILED",
          error: "Worker restarted. Review the worktree and retry explicitly.",
        }),
      );
  }
  const read = async (key) => JSON.parse(await readFile(receipt(key), "utf8"));
  const send = (res, status, data) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    const expected = Buffer.from(`Bearer ${config.token}`),
      actual = Buffer.from(req.headers.authorization ?? "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      return send(res, 401, { error: "Invalid worker token." });
    const key = req.url?.match(/^\/operations\/([a-zA-Z0-9_-]{1,100})$/)?.[1];
    try {
      if (req.method === "GET" && req.url === "/health")
        return send(res, 200, { status: "ok" });
      if (!key) return send(res, 404, { error: "Unknown route." });
      if (req.method === "GET") return send(res, 200, await read(key));
      if (req.method === "DELETE") {
        controllers.get(key)?.abort();
        return send(res, 200, { cancelled: true });
      }
      requireValue(req.method === "POST", "Unsupported method.");
      let size = 0;
      const parts = [];
      for await (const part of req) {
        size += part.length;
        requireValue(
          size <= 280 * 1024 * 1024,
          "Worker request exceeds 280 MiB.",
        );
        parts.push(part);
      }
      const input = JSON.parse(Buffer.concat(parts).toString());
      const hash = digest(JSON.stringify(input));
      if (accepted.has(key)) {
        requireValue(
          accepted.get(key) === hash,
          "Operation identifier already belongs to different inputs.",
        );
        return send(res, 202, { status: "QUEUED" });
      }
      accepted.set(key, hash);
      const existing = await read(key).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      requireValue(
        !existing || existing.hash === hash,
        "Operation identifier already belongs to different inputs.",
      );
      if (existing && existing.status !== "FAILED") {
        accepted.delete(key);
        return send(res, 202, { status: existing.status });
      }
      const controller = new AbortController();
      controllers.set(key, controller);
      await atomic(receipt(key), JSON.stringify({ status: "QUEUED", hash }));
      queue = queue
        .then(async () => {
          const timer = setTimeout(() => controller.abort(), 900_000);
          try {
            controller.signal.throwIfAborted();
            await atomic(
              receipt(key),
              JSON.stringify({ status: "RUNNING", hash }),
            );
            const result = await execute(config, input, controller.signal, key);
            await atomic(
              receipt(key),
              JSON.stringify({ status: "DONE", hash, result }),
            );
          } catch (error) {
            const message = String(
              error.message ?? "Worker operation failed.",
            ).replace(/(bearer\s+)[\w.+/=-]+/gi, "$1[redacted]");
            await atomic(
              receipt(key),
              JSON.stringify({
                status: "FAILED",
                hash,
                error: message.slice(-16_000),
              }),
            );
          } finally {
            clearTimeout(timer);
            controllers.delete(key);
            accepted.delete(key);
          }
        })
        .catch(() => {});
      return send(res, 202, { status: "QUEUED" });
    } catch (error) {
      if (key && !controllers.has(key)) accepted.delete(key);
      send(res, error.code === "ENOENT" ? 404 : 422, { error: error.message });
    }
  });
  return {
    server,
    async close() {
      for (const controller of controllers.values()) controller.abort();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await queue;
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const worker = await createWorker({
      token: process.env.DOSSIER_WORKER_TOKEN,
      repository: process.env.DOSSIER_WORKER_REPOSITORY,
      data: process.env.DOSSIER_WORKER_DATA_DIR,
      exports: process.env.DOSSIER_WORKER_EXPORT_DIR,
      codex: process.env.DOSSIER_CODEX_BIN || "codex",
      claude: process.env.DOSSIER_CLAUDE_BIN || "claude",
    });
    worker.server.listen(
      Number(process.env.DOSSIER_WORKER_PORT || 8788),
      "127.0.0.1",
      () => console.log("Dossier application worker listening on loopback."),
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => void worker.close());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
