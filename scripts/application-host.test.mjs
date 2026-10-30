import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { createHost } from "./application-host.mjs";
import { createWorker } from "./application-worker.mjs";
import { execute } from "./application-worker/operations.mjs";
import { hostOperation } from "./application-worker/host-client.mjs";
import { revealExport } from "./application-worker/host-actions.mjs";
import { digest } from "./application-worker/tools.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "btalalos-host-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const exports = path.join(root, "exports");
  const repositoryRoot = path.join(root, "repositories");
  await mkdir(exports);
  await mkdir(repositoryRoot);
  const agent = path.resolve("scripts/application-worker/fixtures/agent.mjs");
  const hostConfig = {
    token: "h".repeat(32), data: path.join(root, "host"), exports,
    codex: agent, claude: agent,
  };
  return { root, exports, repositoryRoot, hostConfig };
}

async function listen(t, service) {
  await new Promise((resolve) => service.server.listen(0, "127.0.0.1", resolve));
  t.after(() => service.close());
  return `http://127.0.0.1:${service.server.address().port}`;
}

test("container operations use the host's two CLI adapters without a worker-local CLI", async (t) => {
  const { root, hostConfig } = await fixture(t);
  const hostUrl = await listen(t, await createHost(hostConfig));
  const config = {
    data: path.join(root, "worker"), hostUrl, hostToken: hostConfig.token,
    codex: "/no-container-cli", claude: "/no-container-cli",
  };
  for (const provider of ["codex", "claude"]) {
    const catalog = await execute(config, { kind: "capabilities", provider }, new AbortController().signal, `catalog-${provider}`);
    const result = await execute(config, {
      kind: "generate", provider, model: catalog.models[0].id,
      effort: "medium", schema: { type: "object" }, prompt: "Write an email.",
    }, new AbortController().signal, `generate-${provider}`);
    assert.equal(result.subject, "Application for Researcher");
  }
  assert.deepEqual(await readdir(path.join(config.data, "operations")), []);
});

test("host companion rejects invalid credentials and non-host operations before creating receipts", async (t) => {
  const { hostConfig } = await fixture(t);
  const url = await listen(t, await createHost(hostConfig));
  assert.equal((await fetch(`${url}/health`)).status, 401);
  const headers = { authorization: `Bearer ${hostConfig.token}`, "content-type": "application/json" };
  assert.equal((await fetch(`${url}/health`, { headers })).status, 200);
  for (const kind of ["compile", "apply", "export", "directories", "worktree"]) {
    const response = await fetch(`${url}/operations/forbidden-${kind}`, {
      method: "POST", headers, body: JSON.stringify({ kind }),
    });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /Unsupported host operation/);
  }
  assert.deepEqual(await readdir(path.join(hostConfig.data, "receipts")), []);
  await assert.rejects(hostOperation({ hostUrl: url, hostToken: "w".repeat(32) },
    { kind: "capabilities", provider: "codex" }, new AbortController().signal, "bad-token"), /Invalid worker token/);
});

test("cancelling a forwarded request cancels the host operation rather than leaving it running", async (t) => {
  const { hostConfig } = await fixture(t);
  let started;
  const active = new Promise((resolve) => { started = resolve; });
  const service = await createWorker(hostConfig, {
    executeOperation: async (_config, _input, signal) => {
      started();
      await setTimeout(30_000, undefined, { signal });
    },
  });
  const hostUrl = await listen(t, service);
  const input = { kind: "capabilities", provider: "codex" };
  const controller = new AbortController();
  const request = hostOperation({ hostUrl, hostToken: hostConfig.token }, input, controller.signal, "cancel");
  const rejected = assert.rejects(request, /cancelled or timed out/);
  await active;
  controller.abort();
  await rejected;
  const key = digest(`cancel:${JSON.stringify(input)}`);
  const receipt = path.join(hostConfig.data, "receipts", `${key}.json`);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (JSON.parse(await readFile(receipt)).status === "FAILED") return;
    await setTimeout(20);
  }
  assert.fail("Host operation did not receive cancellation");
});

test("shared repository browsing stays inside the configured root and needs no companion", async (t) => {
  const { root, repositoryRoot } = await fixture(t);
  const config = { data: path.join(root, "worker"), repositoryRoot, hostUrl: "http://127.0.0.1:1" };
  const result = await execute(config, { kind: "directories" }, new AbortController().signal, "browse");
  assert.equal(result.directory, repositoryRoot);
  assert.equal(result.parent, repositoryRoot);
  await symlink(root, path.join(repositoryRoot, "outside"));
  await assert.rejects(execute(config, { kind: "directories", directory: path.join(repositoryRoot, "outside") },
    new AbortController().signal, "symlink"), /shared repository root/);
  await assert.rejects(execute(config, { kind: "repository", repository: root },
    new AbortController().signal, "outside"), /shared repository root/);
});

test("host reveal validates the saved package and opens only an export path", async (t) => {
  const { root, exports, hostConfig } = await fixture(t);
  const folder = path.join(exports, "dossier-application");
  await mkdir(folder);
  const file = path.join(folder, "package.pdf");
  const bytes = Buffer.from("%PDF-fixture");
  await writeFile(file, bytes);
  const input = { kind: "reveal", folder: "dossier-application", fileName: "package.pdf", checksum: digest(bytes) };
  await assert.rejects(revealExport(hostConfig, { ...input, folder: ".." }, new AbortController().signal), /identifier/);
  await assert.rejects(revealExport(hostConfig, { ...input, fileName: "../outside.pdf" }, new AbortController().signal), /filename/);
  await assert.rejects(revealExport(hostConfig, { ...input, checksum: "changed" }, new AbortController().signal), /checksum/);
  await symlink(file, path.join(folder, "linked.pdf"));
  await assert.rejects(revealExport(hostConfig, { ...input, fileName: "linked.pdf" }, new AbortController().signal), /Symbolic/);
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const capture = path.join(root, "opened.json");
  await writeFile(path.join(bin, "gdbus"), `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));`, { mode: 0o700 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before}`;
  try {
    const hostUrl = await listen(t, await createHost(hostConfig));
    await hostOperation({ hostUrl, hostToken: hostConfig.token }, input, new AbortController().signal, "reveal");
    assert.match(await readFile(capture, "utf8"), /FileManager1.ShowItems/);
    assert.ok((await readFile(capture, "utf8")).includes(file));
  } finally {
    process.env.PATH = before;
  }
});

test("unavailable companion gives an actionable error without selecting a local CLI", async (t) => {
  const { root } = await fixture(t);
  await assert.rejects(execute({ data: path.join(root, "worker"), hostUrl: "http://127.0.0.1:1", hostToken: "h".repeat(32) },
    { kind: "capabilities", provider: "codex" }, new AbortController().signal, "offline"), /Cannot reach the host companion/);
});

test("failed PDF operations remove temporary copies but retain the worker data directory", async (t) => {
  const { root } = await fixture(t);
  const config = { data: path.join(root, "worker") };
  const bytes = Buffer.from("not a PDF");
  await assert.rejects(execute(config, { kind: "pdf", documents: [{ data: bytes.toString("base64"), checksum: digest(bytes) }] },
    new AbortController().signal, "bad-pdf"), /Invalid or oversized/);
  assert.deepEqual(await readdir(path.join(config.data, "operations")), []);
});

test("container startup rejects missing mounts and symlink aliases", { skip: process.getuid() === 0 }, async (t) => {
  const { root, repositoryRoot, exports } = await fixture(t);
  const data = path.join(root, "worker");
  await mkdir(data);
  const config = { token: "w".repeat(32), container: true, repositoryRoot, data, exports, hostUrl: "http://127.0.0.1:8789", hostToken: "h".repeat(32) };
  const alias = path.join(root, "repository-alias");
  await symlink(repositoryRoot, alias);
  await assert.rejects(createWorker({ ...config, repositoryRoot: alias }), /canonical mount paths/);
  await assert.rejects(createWorker({ ...config, data: path.join(root, "missing") }), /ENOENT/);
});
