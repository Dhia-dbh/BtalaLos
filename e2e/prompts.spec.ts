import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { resetData } from "./support";

test.beforeAll(resetData);

test("edits prompts independently, keeps them after reload, and restores defaults", async ({ page }) => {
  await page.goto("/settings?section=prompts");
  await page.getByRole("radio", { name: "Built-in editor" }).click();
  const original = await page.getByLabel("CV prompt", { exact: true }).inputValue();
  await page.getByLabel("CV prompt", { exact: true }).fill("Use concise wording and relevant coursework.");
  await page.getByLabel("CV prompt", { exact: true }).blur();
  await expect(page.getByText("Saved just now").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("CV prompt", { exact: true })).toHaveValue("Use concise wording and relevant coursework.");
  await page.getByRole("radio", { name: "LaTeX preparation" }).click();
  await expect(page.getByLabel("CV prompt", { exact: true })).not.toHaveValue("Use concise wording and relevant coursework.");
  await page.getByLabel("Email draft prompt").fill("Keep the attachment note to three sentences.");
  await page.getByLabel("Email draft prompt").blur();
  await expect(page.getByText("Saved just now").last()).toBeVisible();
  await page.reload();
  await page.getByRole("radio", { name: "LaTeX preparation" }).click();
  await expect(page.getByLabel("Email draft prompt")).toHaveValue("Keep the attachment note to three sentences.");
  await page.getByRole("radio", { name: "Built-in editor" }).click();
  await page.getByRole("button", { name: "Restore default" }).first().click();
  await expect(page.getByLabel("CV prompt", { exact: true })).toHaveValue(original);
  await expect(page.getByText("Saved just now").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("CV prompt", { exact: true })).toHaveValue(original);
});

test("keeps additional profile information after reload and renders accessible editors", async ({ page }, testInfo) => {
  await page.goto("/profile?section=facts");
  await expect(page.getByRole("heading", { name: "Other relevant information" })).toBeVisible();
  const rows = page.getByRole("textbox", { name: /^Fact \d+$/ });
  const count = await rows.count();
  await page.getByRole("button", { name: "+ Add a fact" }).click();
  await expect(rows).toHaveCount(count + 1);
  const text = "Studied graph algorithms at university. Built a personal Python data analysis project.";
  await rows.last().fill(text);
  await rows.last().blur();
  await expect(page.getByText("Saved just now")).toBeVisible();
  await page.reload();
  await expect(rows.last()).toHaveValue(text);
  await page.screenshot({ path: testInfo.outputPath("other-relevant-information.png"), fullPage: true });
  await page.goto("/settings?section=prompts");
  await page.getByRole("radio", { name: "LaTeX preparation" }).click();
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((chosen) => { document.documentElement.dataset.theme = chosen; }, scheme);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`prompts-${scheme}.png`), fullPage: true });
  }
});
