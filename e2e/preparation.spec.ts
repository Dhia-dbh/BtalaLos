import { test, expect } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const command = async (
  binary: string,
  args: string[],
  options: { cwd?: string } = {},
) => (await execute(binary, args, options)).stdout.trim();
import { resetData, sql } from "./support";
let root: string, repository: string;
let worker: ChildProcess;
const tex = (text: string) =>
  `\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}${text} \\href{https://example.org}{Example}\\end{document}\n`;

test.beforeAll(async () => {
  await resetData();
  root = await mkdtemp(path.join(tmpdir(), "dossier-preparation-browser-"));
  repository = path.join(root, "repository");
  await command("git", ["init", repository]);
  await writeFile(
    path.join(repository, "cv.tex"),
    tex("CV: verified Python research"),
  );
  await writeFile(
    path.join(repository, "letter.tex"),
    tex("Letter: verified Python research"),
  );
  await command("git", ["-C", repository, "add", "."]);
  await command("git", [
    "-C",
    repository,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "-m",
    "Base",
  ]);
  await writeFile(
    path.join(repository, "records.tex"),
    tex("Academic records"),
  );
  await command(
    "pdflatex",
    ["-interaction=nonstopmode", "-halt-on-error", "records.tex"],
    { cwd: repository },
  );
  await command("git", [
    "clone",
    repository,
    path.join(root, "initial-repository"),
  ]);
  const agent = path.resolve("scripts/application-worker/fixtures/agent.mjs");
  worker = spawn(
    process.execPath,
    [path.resolve("scripts/application-worker.mjs")],
    {
      env: {
        ...process.env,
        DOSSIER_WORKER_TOKEN: "dossier-e2e-worker-token-dossier-e2e-worker",
        DOSSIER_WORKER_REPOSITORY: path.join(root, "initial-repository"),
        DOSSIER_WORKER_DATA_DIR: path.join(root, "worker"),
        DOSSIER_WORKER_EXPORT_DIR: path.join(root, "exports"),
        DOSSIER_CODEX_BIN: agent,
        DOSSIER_CLAUDE_BIN: agent,
        DOSSIER_WORKER_PORT: "8791",
      },
      stdio: "pipe",
    },
  );
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch("http://127.0.0.1:8791/health", {
      headers: {
        authorization: "Bearer dossier-e2e-worker-token-dossier-e2e-worker",
      },
    }).catch(() => null);
    if (response?.ok) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(ready).toBe(true);
});
test.afterAll(async () => {
  if (worker && worker.exitCode === null) {
    const stopped = new Promise<void>((resolve) =>
      worker.once("exit", () => resolve()),
    );
    worker.kill("SIGTERM");
    await stopped;
  }
  await rm(root, { recursive: true, force: true });
});

test("prepares a LaTeX application and a native package through the interface", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/settings");
  await page
    .getByRole("link", { name: "Job profiles and bundles", exact: true })
    .click();
  await page
    .getByLabel("Document name", { exact: true })
    .fill("Academic records");
  await page
    .getByLabel("PDF file", { exact: true })
    .setInputFiles(path.join(repository, "records.pdf"));
  await page.getByRole("button", { name: "Upload PDF", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Academic records", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Profile name", { exact: true }).fill("PhD");
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Document 3", exact: true })
    .selectOption({ label: "Academic records" });
  await page
    .getByRole("button", { name: "Move document 3 up", exact: true })
    .click();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByLabel("Edit a profile").locator("option")).toHaveCount(
    2,
  );
  await page.getByRole("link", { name: "LaTeX project", exact: true }).click();
  await page
    .getByRole("button", { name: "Browse repositories", exact: true })
    .click();
  await expect(page.getByLabel("Folder path", { exact: true })).toHaveValue(
    path.join(root, "initial-repository"),
  );
  await page.getByLabel("Folder path", { exact: true }).fill(repository);
  await page.getByRole("button", { name: "Open folder", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Use this repository", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: "/tmp/dossier-repository-picker.png",
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Use this repository", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page
    .getByLabel("CV entrypoint (.tex)", { exact: true })
    .selectOption("cv.tex");
  await page
    .getByLabel("Cover-letter entrypoint (.tex)", { exact: true })
    .selectOption("letter.tex");
  await page
    .getByLabel("Editable source files", { exact: true })
    .selectOption(["cv.tex", "letter.tex"]);
  await page
    .getByRole("button", { name: "Test CLI and load models", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .selectOption("fixture");
  const saved = page.waitForResponse((response) =>
    response.url().endsWith("/api/preparation/config"),
  );
  await page
    .getByRole("button", { name: "Validate and save project", exact: true })
    .click();
  expect((await saved).status()).toBe(200);
  const modeSaved = page.waitForResponse((response) =>
    response.url().endsWith("/api/preparation/document-mode"),
  );
  await page
    .getByLabel("Default document mode", { exact: true })
    .selectOption("LATEX");
  expect((await modeSaved).status()).toBe(200);
  await page.reload();
  await expect(
    page.getByLabel("Default document mode", { exact: true }),
  ).toHaveValue("LATEX");
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByLabel("CV entrypoint (.tex)", { exact: true }).locator("option"),
  ).toHaveCount(4);
  await expect(
    page.getByLabel("Editable source files", { exact: true }),
  ).toHaveValues(["cv.tex", "letter.tex"]);
  await expect(page.getByLabel("Git repository", { exact: true })).toHaveValue(
    repository,
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: "/tmp/dossier-project-settings-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "/tmp/dossier-project-settings-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/new");
  await expect(page).toHaveURL(/\/new\/latex/);
  await page
    .getByLabel("Document mode", { exact: true })
    .selectOption("NATIVE");
  await expect(page).toHaveURL(/\/new\?mode=NATIVE/);
  await expect(page.getByLabel("Document mode", { exact: true })).toHaveValue(
    "NATIVE",
  );
  await page.goto("/new");
  await expect(page).toHaveURL(/\/new\/latex/);
  await page
    .getByLabel("Job posting", { exact: true })
    .fill(
      "Researcher at Example. Python required. Apply by 2026-12-31 to hr@example.org.",
    );
  await page
    .getByLabel("Application profile", { exact: true })
    .selectOption({ label: "PhD" });
  await page.getByLabel("Coding CLI", { exact: true }).selectOption("claude");
  await page
    .getByRole("button", { name: "Load available models", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Model", exact: true })
    .selectOption("sonnet");
  await page
    .getByRole("button", { name: "Prepare application", exact: true })
    .click();
  await expect(page).toHaveURL(/\/applications\//);
  await expect(
    page.getByRole("heading", { name: "Application package ready" }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(
    page.getByRole("button", { name: "Copy the recipient" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy the subject" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy message" }),
  ).toBeVisible();
  const id = page.url().split("/applications/")[1].split("?")[0];
  const result = await page.request.get(
    `/api/preparation/application?applicationId=${id}`,
  );
  const data = await result.json();
  expect(data.status).toBe("DRAFT");
  expect(data.cli).toMatchObject({ provider: "claude", model: "sonnet" });
  expect(
    data.artifacts
      .filter((file: { role: string }) => ["cv", "letter"].includes(file.role))
      .every((file: { pages: number }) => file.pages === 1),
  ).toBe(true);
  const pack = data.artifacts.find(
    (file: { role: string }) => file.role === "package",
  );
  expect(pack.pages).toBe(3);
  const download = await page.request.get(`/api/artifacts/${pack.id}`);
  await writeFile(path.join(root, "merged.pdf"), await download.body());
  await writeFile("/tmp/dossier-preparation-merged.pdf", await download.body());
  for (const role of ["cv", "letter"]) {
    const artifact = data.artifacts.find(
      (file: { role: string }) => file.role === role,
    );
    await writeFile(
      `/tmp/dossier-preparation-${role}.pdf`,
      await (await page.request.get(`/api/artifacts/${artifact.id}`)).body(),
    );
  }
  const text = await command("pdftotext", [path.join(root, "merged.pdf"), "-"]);
  expect(text.indexOf("CV:")).toBeLessThan(text.indexOf("Academic records"));
  expect(text.indexOf("Academic records")).toBeLessThan(
    text.indexOf("Letter:"),
  );
  expect(
    await command("pdfinfo", ["-url", path.join(root, "merged.pdf")]),
  ).toContain("https://example.org");
  await page.getByRole("button", { name: "Edit email", exact: true }).click();
  await page
    .getByLabel("Subject", { exact: true })
    .fill("My revised application subject");
  await page.getByRole("button", { name: "Save email", exact: true }).click();
  await expect(
    page.getByText("My revised application subject", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Regenerate merged PDF", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(
              `/api/preparation/application?applicationId=${id}`,
            )
          ).json()
        ).artifacts.filter((file: { role: string }) => file.role === "package")
          .length,
    )
    .toBe(2);
  const native = (
    await sql<{ id: string }>(
      `SELECT a.id FROM "Application" a WHERE a."documentMode" = 'NATIVE' AND EXISTS (SELECT 1 FROM "Document" d WHERE d."applicationId" = a.id AND d.kind = 'RESUME') AND EXISTS (SELECT 1 FROM "Document" d WHERE d."applicationId" = a.id AND d.kind = 'COVER_LETTER') ORDER BY a."createdAt" LIMIT 1`,
    )
  )[0];
  await page.goto(`/applications/${native.id}?tab=preparation`);
  await page
    .getByLabel("Application profile", { exact: true })
    .selectOption({ label: "PhD" });
  await page
    .getByRole("button", { name: "Build document package", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Application package ready" }),
  ).toBeVisible({ timeout: 45_000 });
  await page.goto(`/applications/${id}`);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({
    path: "/tmp/dossier-preparation-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.screenshot({
    path: "/tmp/dossier-preparation-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await expect(page.getByRole("complementary")).toHaveAttribute(
    "data-collapsed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Regenerate merged PDF" }),
  ).toBeVisible();
  await page.screenshot({
    path: "/tmp/dossier-preparation-mobile.png",
    animations: "disabled",
  });
});
