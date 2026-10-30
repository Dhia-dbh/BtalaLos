import { expect, test } from "@playwright/test";
import { resetData, sql } from "./support";

test("browser settings preserve document AI settings and save manual reading and scoped exclusions", async ({ page }) => {
  await resetData();
  const before = await sql('SELECT key, value FROM "Setting" WHERE key IN (\'provider\', \'baseUrl\', \'model\', \'thinkingEffort\') ORDER BY key');
  await page.goto("/settings?section=browser");
  await expect(page.getByLabel("Application submission", { exact: true })).toHaveValue("review");
  await expect(page.getByLabel("Reply submission", { exact: true })).toHaveValue("review");
  await page.getByLabel("AI source", { exact: true }).selectOption("provider");
  await page.getByLabel("Browser provider", { exact: true }).selectOption("LOCAL");
  await page.getByLabel("Browser AI endpoint", { exact: true }).fill("http://localhost:11434");
  await page.getByLabel("Email reading", { exact: true }).selectOption("manual");
  await page.getByLabel("Reply submission", { exact: true }).selectOption("automatic");
  await page.getByRole("button", { name: "Add exclusion filter" }).click();
  await page.getByLabel("Filter 1: look in").selectOption("body");
  await page.getByLabel("Filter 1: words or phrases").fill("LinkedIn jobs\nRecommended roles");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Browser and mail settings saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Email reading", { exact: true })).toHaveValue("manual");
  await expect(page.getByLabel("Application submission", { exact: true })).toHaveValue("review");
  await expect(page.getByLabel("Reply submission", { exact: true })).toHaveValue("automatic");
  await expect(page.getByLabel("Filter 1: look in")).toHaveValue("body");
  await expect(page.getByLabel("Filter 1: words or phrases")).toHaveValue("LinkedIn jobs\nRecommended roles");
  expect(await sql('SELECT key, value FROM "Setting" WHERE key IN (\'provider\', \'baseUrl\', \'model\', \'thinkingEffort\') ORDER BY key')).toEqual(before);
  await page.screenshot({ path: test.info().outputPath("browser-settings-light.png"), fullPage: true });
  await page.context().addCookies([{ name: "dossier_theme", value: "dark", url: new URL(page.url()).origin }, { name: "dossier_sidebar", value: "collapsed", url: new URL(page.url()).origin }]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByLabel("Email reading", { exact: true })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("browser-settings-dark-mobile.png"), fullPage: true });
});

test("automation review shows optional blanks, requires a revision and exports the complete Markdown record", async ({ page }) => {
  await resetData();
  const snapshot = {
    mode: "review", ai: { source: "cli", provider: "codex", model: "fixture", baseUrl: "", effort: "medium" }, prompts: {}, company: "Example", role: "Researcher", posting: "Researcher at Example", postingUrl: "https://example.org/job", applicant: {}, facts: [], answers: [], sessionId: "fixture-session", hops: ["https://careers.example.org/apply"],
    fields: [{ id: "name", label: "Name", type: "text", required: true, value: "Jane Doe", options: [], pageUrl: "https://careers.example.org/apply", proposedValue: "Jane Doe", actualValue: "Jane Doe", source: "APPLICANT.basics.name", state: "filled" }, { id: "phone", label: "Phone", type: "text", required: false, value: "", options: [], pageUrl: "https://careers.example.org/apply", proposedValue: null, actualValue: "", source: "No supported value supplied", state: "empty" }], artifacts: [{ id: "fixture-pdf", role: "package", fileName: "Jane.pdf", version: 1, checksum: "a".repeat(64), text: "" }],
  };
  await sql('INSERT INTO "BrowserRun" (id, kind, status, revision, snapshot, "updatedAt") VALUES ($1, $2, $3, $4, $5::jsonb, now())', ["fixture-browser-review", "portal", "WAITING_FOR_REVIEW", 3, JSON.stringify(snapshot)]);
  await page.goto("/automation");
  await expect(page.getByRole("cell", { name: "Left empty", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "APPLICANT.basics.name filled" })).toBeVisible();
  const report = await page.request.get("/api/browser/report?id=fixture-browser-review");
  expect(report.status()).toBe(200);
  expect(report.headers()["content-type"]).toContain("text/markdown");
  expect(await report.text()).toContain("| https://careers.example.org/apply | Phone | no |  | (empty) | empty |");
  let approval: unknown;
  await page.route("**/api/browser/approve", async (route) => { approval = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.getByRole("button", { name: "Approve and submit", exact: true }).click();
  await expect.poll(() => approval).toEqual({ id: "fixture-browser-review", revision: 3 });
  await page.screenshot({ path: test.info().outputPath("browser-review.png"), fullPage: true });
});
