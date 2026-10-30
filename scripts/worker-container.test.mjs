import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { setTimeout } from "node:timers/promises";
import { createHost } from "./application-host.mjs";
import { command, digest } from "./application-worker/tools.mjs";

test("image prepares linked PDFs with host-only CLI login and persistent editable worktrees", {
  skip: process.env.WORKER_CONTAINER_TEST !== "1",
  timeout: 300_000,
}, async (t) => {
  const testDirectory = path.resolve("data/worker-container-tests");
  await mkdir(testDirectory, { recursive: true });
  const root = await mkdtemp(path.join(testDirectory, "run-"));
  const repositories = path.join(root, "repositories");
  const repo = path.join(repositories, "latex project");
  const data = path.join(root, "worker");
  const exports = path.join(root, "exports");
  for (const directory of [repo, data, exports]) await mkdir(directory, { recursive: true });
  let container;
  t.after(async () => {
    if (container) await command("docker", ["rm", "-f", container]);
    await rm(root, { recursive: true, force: true });
  });
  await command("git", ["init", repo]);
  const source = (text) => `\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}${text} \\href{https://example.org}{Link}\\end{document}\n`;
  const files = { "cv.tex": source("CV"), "letter.tex": source("Letter"), "support.tex": source("Supporting records") };
  for (const [file, contents] of Object.entries(files)) await writeFile(path.join(repo, file), contents);
  await command("git", ["-C", repo, "add", "."]);
  await command("git", ["-C", repo, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", "commit", "-m", "Base"]);
  const agent = path.resolve("scripts/application-worker/fixtures/agent.mjs");
  const token = "container-worker-test-token-0123456789";
  const hostToken = "container-host-test-token-0123456789";
  const host = await createHost({ data: path.join(root, "host"), token: hostToken, exports, codex: agent, claude: agent });
  await new Promise((resolve) => host.server.listen(0, "127.0.0.1", resolve));
  t.after(() => host.close());
  const hostPort = host.server.address().port;
  const native = process.env.WORKER_TEST_NETWORK === "host";
  let workerPort = 8788;
  if (native) {
    const listener = net.createServer();
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    workerPort = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
  }
  const args = ["run", "-d", "--rm", "--init", "--read-only", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--user", `${process.getuid()}:${process.getgid()}`,
    "--tmpfs", "/tmp:rw,nosuid,size=536870912,mode=1777", "--mount", `type=bind,src=${root},dst=${root}`,
    "-e", `DOSSIER_WORKER_TOKEN=${token}`, "-e", `DOSSIER_WORKER_REPOSITORY_ROOT=${repositories}`,
    "-e", `DOSSIER_WORKER_DATA_DIR=${data}`, "-e", `DOSSIER_WORKER_EXPORT_DIR=${exports}`,
    "-e", `DOSSIER_HOST_TOKEN=${hostToken}`, "-e", `DOSSIER_WORKER_PORT=${workerPort}`,
    "-e", `DOSSIER_HOST_URL=http://${native ? "127.0.0.1" : "host.docker.internal"}:${hostPort}`];
  if (native) args.push("--network", "host", "-e", "DOSSIER_WORKER_BIND=127.0.0.1");
  else args.push("-p", "127.0.0.1::8788", "--add-host", "host.docker.internal:host-gateway");
  args.push(process.env.DOSSIER_WORKER_IMAGE || "btalalos-worker:local");
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let url;
  async function start() {
    container = await command("docker", args, { timeout: 60_000 });
    const port = native ? workerPort : JSON.parse(await command("docker", ["inspect", "--format", '{{json (index .NetworkSettings.Ports "8788/tcp")}}', container]))[0].HostPort;
    url = `http://127.0.0.1:${port}`;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        if ((await fetch(`${url}/health`, { headers, signal: AbortSignal.timeout(1000) })).ok) return;
      } catch { /* Wait for this disposable container to start. */ }
      await setTimeout(100);
    }
    assert.fail(await command("docker", ["logs", container]));
  }
  async function operation(input, key) {
    const posted = await fetch(`${url}/operations/${key}`, { method: "POST", headers, body: JSON.stringify(input) });
    assert.equal(posted.status, 202, await posted.text());
    for (let attempt = 0; attempt < 180; attempt++) {
      const response = await fetch(`${url}/operations/${key}`, { headers });
      const result = await response.json();
      assert.notEqual(result.status, "FAILED", `${key}: ${result.error}`);
      if (result.status === "DONE") return result.result;
      await setTimeout(500);
    }
    assert.fail(`Operation ${key} did not finish`);
  }
  await start();
  assert.equal((await fetch(`${url}/health`)).status, 401);
  await assert.rejects(command("docker", ["exec", container, "sh", "-c", "command -v codex || command -v claude || command -v npm"]));
  for (const provider of ["codex", "claude"]) {
    const catalog = await operation({ kind: "capabilities", provider }, `catalog-${provider}`);
    const generated = await operation({ kind: "generate", provider, model: catalog.models[0].id, effort: "medium", schema: { type: "object" }, prompt: "Write an email." }, `generate-${provider}`);
    assert.equal(generated.subject, "Application for Researcher");
  }
  const inspected = await operation({ kind: "inspect", repository: repo, baseRef: "HEAD", cvPath: "cv.tex", letterPath: "letter.tex", editablePaths: Object.keys(files) }, "inspect");
  await operation({ kind: "worktree", repository: repo, applicationId: "fixture", commit: inspected.commit }, "worktree");
  const tailored = source("Tailored CV");
  await operation({ kind: "apply", applicationId: "fixture", expected: { "cv.tex": digest(files["cv.tex"]) }, files: [{ path: "cv.tex", content: tailored }] }, "apply");
  const expected = Object.fromEntries(Object.entries({ ...files, "cv.tex": tailored }).map(([name, text]) => [name, digest(text)]));
  let cv;
  for (const engine of ["pdflatex", "xelatex", "lualatex"]) {
    cv = await operation({ kind: "compile", applicationId: "fixture", entrypoint: "cv.tex", engine, expected }, `cv-${engine}`);
    assert.equal(cv.pages, 1);
    assert.match(cv.text, /Tailored CV/);
  }
  const letter = await operation({ kind: "compile", applicationId: "fixture", entrypoint: "letter.tex", engine: "pdflatex", expected }, "letter");
  const supporting = await operation({ kind: "compile", applicationId: "fixture", entrypoint: "support.tex", engine: "pdflatex", expected }, "support");
  const merged = await operation({ kind: "merge", documents: [cv, supporting, letter] }, "merge");
  assert.equal(merged.pages, 3);
  const parsed = await operation({ kind: "pdf", documents: [merged] }, "read-merged");
  assert.ok(parsed.text.indexOf("Tailored CV") < parsed.text.indexOf("Supporting records"));
  assert.ok(parsed.text.indexOf("Supporting records") < parsed.text.indexOf("Letter"));
  await operation({ kind: "export", folder: "dossier-fixture", fileName: "application.pdf", version: 1, ...merged }, "export");
  const packagePath = path.join(exports, "dossier-fixture", "application.pdf");
  await command("docker", ["exec", container, "/opt/venv/bin/python", "-c", "import pymupdf,sys; d=pymupdf.open(sys.argv[1]); assert len(d)==3; assert all(p.get_links() for p in d)", packagePath]);
  assert.equal(digest(await readFile(packagePath)), merged.checksum);
  assert.equal(await readFile(path.join(repo, "cv.tex"), "utf8"), files["cv.tex"]);
  const worktree = path.join(data, "worktrees", "fixture");
  assert.equal(await readFile(path.join(worktree, "cv.tex"), "utf8"), tailored);
  assert.equal(await command("git", ["-C", worktree, "branch", "--show-current"]), "dossier-fixture");
  assert.deepEqual(await readdir(path.join(data, "operations")), []);
  await command("docker", ["rm", "-f", container]);
  container = undefined;
  await start();
  const receipt = await (await fetch(`${url}/operations/merge`, { headers })).json();
  assert.equal(receipt.result.checksum, merged.checksum);
  const changed = source("Host-edited CV");
  await writeFile(path.join(worktree, "cv.tex"), changed);
  const fresh = await operation({ kind: "inspect", repository: repo, baseRef: "HEAD", applicationId: "fixture", cvPath: "cv.tex", letterPath: "letter.tex", editablePaths: Object.keys(files) }, "inspect-after-recreate");
  assert.equal(fresh.files["cv.tex"], changed);
});
