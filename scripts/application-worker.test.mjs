import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execute } from "./application-worker/operations.mjs";
import { command, digest } from "./application-worker/tools.mjs";
import { createWorker } from "./application-worker.mjs";
const tex =
  "\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}CV \\href{https://example.org}{Example}\\end{document}\n";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "dossier-worker-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  await command("git", ["init", repo]);
  for (const name of ["cv.tex", "letter.tex"])
    await writeFile(path.join(repo, name), tex);
  await command("git", ["-C", repo, "add", "."]);
  await command("git", [
    "-C",
    repo,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=test@example.org",
    "commit",
    "-m",
    "Base",
  ]);
  const agent = path.resolve("scripts/application-worker/fixtures/agent.mjs");
  const config = {
    repository: repo,
    data: path.join(root, "data"),
    exports: path.join(root, "exports"),
    codex: agent,
    claude: agent,
    token: "x".repeat(32),
  };
  return {
    config,
    repo,
    root,
    operation: (input, key = "test") =>
      execute(config, input, new AbortController().signal, key),
  };
}

test("isolates Git edits, preserves exact source bytes, compiles and exports immutable packages", async (t) => {
  const { config, repo, operation } = await fixture(t);
  const inspected = await operation({
    kind: "inspect",
    repository: repo,
    baseRef: "HEAD",
    cvPath: "cv.tex",
    letterPath: "letter.tex",
    editablePaths: ["cv.tex", "letter.tex"],
  });
  assert.equal(inspected.files["cv.tex"], tex);
  await operation({
    kind: "worktree",
    applicationId: "app1",
    commit: inspected.commit,
  });
  const edited = tex.replace("CV", "Tailored CV");
  const diff = await operation({
    kind: "apply",
    applicationId: "app1",
    expected: { "cv.tex": digest(tex) },
    files: [{ path: "cv.tex", content: edited }],
  });
  assert.match(diff.diff, /Tailored CV/);
  assert.equal(await readFile(path.join(repo, "cv.tex"), "utf8"), tex);
  const compiled = await operation(
    {
      kind: "compile",
      applicationId: "app1",
      entrypoint: "cv.tex",
      engine: "pdflatex",
      expected: { "cv.tex": digest(edited), "letter.tex": digest(tex) },
    },
    "compile1",
  );
  assert.equal(compiled.pages, 1);
  assert.match(compiled.text, /Tailored CV/);
  const merged = await operation(
    { kind: "merge", documents: [compiled, compiled] },
    "merge1",
  );
  assert.equal(merged.pages, 2);
  const output = {
    kind: "export",
    folder: "dossier-app1",
    fileName: "BenHamouda_Dhia.pdf",
    version: 1,
    ...merged,
  };
  await operation(output, "export1");
  assert.equal(
    digest(
      await readFile(
        path.join(config.exports, "dossier-app1", "BenHamouda_Dhia.pdf"),
      ),
    ),
    merged.checksum,
  );
  await assert.rejects(
    operation({ ...output, ...compiled }),
    /different bytes/,
  );
  await assert.rejects(
    operation({
      kind: "apply",
      applicationId: "app1",
      expected: { "cv.tex": digest(tex) },
      files: [{ path: "cv.tex", content: edited }],
    }),
    /changed after launch/,
  );
});

test("rejects traversal, symbolic links, unauthorized replacements and modified PDF bytes", async (t) => {
  const { config, repo, operation } = await fixture(t);
  const commit = await command("git", ["-C", repo, "rev-parse", "HEAD"]);
  await operation({ kind: "worktree", applicationId: "app1", commit });
  await symlink(
    "/etc/passwd",
    path.join(config.data, "worktrees", "app1", "unsafe.tex"),
  );
  await assert.rejects(
    operation({
      kind: "apply",
      applicationId: "app1",
      expected: { "unsafe.tex": "" },
      files: [{ path: "unsafe.tex", content: "x" }],
    }),
    /Symbolic links/,
  );
  await assert.rejects(
    operation({
      kind: "apply",
      applicationId: "app1",
      expected: { "cv.tex": digest(tex) },
      files: [{ path: "../cv.tex", content: "x" }],
    }),
    /Unauthorized/,
  );
  await assert.rejects(
    operation({
      kind: "pdf",
      documents: [{ data: "YWJj", checksum: "wrong" }],
    }),
    /checksum/,
  );
  await assert.rejects(
    operation({
      kind: "export",
      folder: "../bad",
      fileName: "bad.pdf",
      version: 1,
    }),
    /identifier/,
  );
  await assert.rejects(
    operation({
      kind: "generate",
      provider: "codex",
      model: "unavailable",
      effort: "medium",
      schema: {},
      prompt: "test",
    }),
    /advertised model/,
  );
});

test("rejects source or branch changes before compilation", async (t) => {
  const { config, repo, operation } = await fixture(t);
  const commit = await command("git", ["-C", repo, "rev-parse", "HEAD"]);
  await operation({ kind: "worktree", applicationId: "app1", commit });
  const root = path.join(config.data, "worktrees", "app1");
  await writeFile(path.join(root, "cv.tex"), tex + "% manual change");
  await assert.rejects(
    operation({
      kind: "compile",
      applicationId: "app1",
      entrypoint: "cv.tex",
      engine: "pdflatex",
      expected: { "cv.tex": digest(tex) },
    }),
    /changed before compilation/,
  );
  await command("git", ["-C", root, "checkout", "-b", "manual-branch"]);
  await assert.rejects(
    operation({
      kind: "apply",
      applicationId: "app1",
      expected: { "cv.tex": digest(tex) },
      files: [{ path: "cv.tex", content: tex }],
    }),
    /branch changed/,
  );
});

test("uses structured generation through both subscription CLI adapters", async (t) => {
  const { operation } = await fixture(t);
  for (const provider of ["codex", "claude"]) {
    const model = provider === "codex" ? "fixture" : "sonnet";
    const result = await operation(
      {
        kind: "generate",
        provider,
        model,
        effort: "medium",
        schema: { type: "object" },
        prompt: "Write an email.",
      },
      provider,
    );
    assert.equal(result.subject, "Application for Researcher");
  }
});

test("authenticates HTTP operations and replays durable successful receipts after restart", async (t) => {
  const { config } = await fixture(t);
  let worker = await createWorker(config);
  const listen = () =>
    new Promise((resolve) => worker.server.listen(0, "127.0.0.1", resolve));
  await listen();
  let base = `http://127.0.0.1:${worker.server.address().port}`;
  const headers = {
    authorization: `Bearer ${config.token}`,
    "content-type": "application/json",
  };
  assert.equal((await fetch(`${base}/health`)).status, 401);
  const input = { kind: "capabilities", provider: "claude" };
  assert.equal(
    (
      await fetch(`${base}/operations/receipt`, {
        method: "POST",
        headers,
        body: JSON.stringify(input),
      })
    ).status,
    202,
  );
  let result;
  for (let i = 0; i < 100; i++) {
    result = await (
      await fetch(`${base}/operations/receipt`, { headers })
    ).json();
    if (result.status === "DONE") break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(result.status, "DONE");
  await worker.close();
  worker = await createWorker(config);
  await listen();
  base = `http://127.0.0.1:${worker.server.address().port}`;
  t.after(() => worker.close());
  const replay = await (
    await fetch(`${base}/operations/receipt`, { headers })
  ).json();
  assert.deepEqual(replay, result);
  assert.equal(
    (
      await fetch(`${base}/operations/receipt`, {
        method: "POST",
        headers,
        body: JSON.stringify({ kind: "different" }),
      })
    ).status,
    422,
  );
});
