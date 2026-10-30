import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { createTestClient, resetDatabase } from "@/test/db";
import type { Observation, RunSnapshot } from "./types";

const state = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined, page: undefined as Observation | undefined, actions: [] as unknown[], calls: [] as Record<string, unknown>[], uncertain: false, changed: false }));
vi.mock("@/lib/prisma", async () => { const { createTestClient } = await import("@/test/db"); state.client = createTestClient(); return { prisma: state.client }; });
vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "browser-tests-secret-browser-tests-secret", DOSSIER_DATA_DIR: "/tmp/btalalos-browser-db-tests" } }));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: <T,>(job: T) => job, startJob: async () => "fixture-job", cancelJob: async () => {} }));
vi.mock("@/lib/preparation/worker", () => ({
  checksum: (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex"),
  workerOperation: async (_key: string, input: Record<string, unknown>) => {
    state.calls.push(input);
    if (input.kind === "generate") return { next: state.actions.shift() };
    if (input.command === "observe") return structuredClone(state.page);
    if (input.command === "expand") {
      const field = state.page!.fields.find((field) => field.id === input.fieldId)!;
      field.options = ["Euro"]; field.choices = [{ id: "euro-option", label: "Euro" }];
      return { expanded: true };
    }
    if (input.command === "fill") {
      const field = state.page!.fields.find((field) => field.id === input.fieldId)!;
      field.value = String(input.value); return { actualValue: input.value };
    }
    if (input.command === "upload") { state.page!.fields[0].value = "CV.pdf"; return { actualValue: "CV.pdf" }; }
    if (input.command === "submit") { if (state.changed) return { attempted: false, observation: state.page, reason: "The reviewed page changed" }; if (state.uncertain) throw new Error("Connection lost after the click."); return { ...state.page, fields: [], controls: [], text: "Thank you for applying. Your application has been submitted." }; }
    if (input.command === "status") return { opened: true, connected: true, email: "jane@gmail.com" };
    if (input.command === "gmail-observe") return { to: "hr@example.org", subject: "Application", body: "Hello", account: "jane@gmail.com" };
    if (input.command === "gmail-send") return { id: "browser:sent-message", threadId: "browser:thread", threadUrl: "https://mail.google.com/mail/u/0/#all/thread", sent: true };
    return { ok: true };
  },
}));

import { saveSettings } from "@/lib/settings-data";
import { saveBytes } from "@/lib/preparation/storage";
import { buildExport } from "@/lib/data-export";
import { importExport, parseExport } from "@/lib/data-import";
import { approveBrowserRun, browserJob, recoverBrowserRuns, queueBrowser, startMailRun, startPortal, updateBrowserAnswers } from "./service";
import { markdownReport } from "./audit";
const db = () => state.client!;
const context = { id: "fixture-job", step: async () => {}, signal: new AbortController().signal };
async function run(id: string) { return browserJob.run({ runId: id }, context); }
async function row(id: string) { return db().browserRun.findUniqueOrThrow({ where: { id }, include: { events: true } }); }

beforeEach(async () => {
  await resetDatabase(db()); state.actions = []; state.calls = []; state.uncertain = false; state.changed = false;
  state.page = { url: "https://careers.example.org/apply/1", title: "Researcher — Example", text: "Researcher at Example", links: [], fields: [{ id: "name", label: "Name", type: "text", required: true, value: "Jane Doe", options: [], pageUrl: "https://careers.example.org/apply/1" }, { id: "phone", label: "Phone", type: "text", required: false, value: "", options: [], pageUrl: "https://careers.example.org/apply/1" }], controls: [{ id: "submit", label: "Submit application", final: true }] };
  await saveSettings({ browserEnabled: true, browserAi: { source: "cli", provider: "codex", baseUrl: "", model: "fixture", effort: "medium" }, gmailBackend: "browser", gmailBrowserEmail: "jane@gmail.com" });
  await db().profileField.create({ data: { key: "name", value: "Jane Doe" } });
  await db().applicationProfile.create({ data: { id: "profile", name: "PhD", items: [{ role: "cv" }, { role: "letter" }] } });
  await db().application.create({ data: { id: "application", company: "Example", role: "Researcher", packageProfileId: "profile", postingText: "Researcher at Example. Apply here: https://careers.example.org/apply/1", postingUrl: "https://example.org/posting/1", extracted: { applicationUrl: "https://careers.example.org/apply/1" } } });
  await db().preparationRun.create({ data: { id: "preparation", applicationId: "application", kind: "prepare", status: "READY", snapshot: {} } });
  for (const [role, id] of [["cv", "cv"], ["letter", "letter"], ["package", "package"]]) await db().applicationArtifact.create({ data: { id, applicationId: "application", runId: "preparation", role, version: 1, ...await saveBytes(Buffer.from(`%PDF-1.4 ${role}`)), manifest: role === "package" ? { cv: "cv", letter: "letter", fileName: "Jane.pdf", items: [{ role: "cv", id: "cv" }, { role: "letter", id: "letter" }] } : { text: `${role}: Jane Doe` } } });
});
afterAll(async () => { await db().$disconnect(); await rm("/tmp/btalalos-browser-db-tests", { recursive: true, force: true }); });

describe("persistent application browser runs", () => {
  it("refreshes dropdown choices after expansion before selecting a predefined value", async () => {
    state.page!.fields.push({ id: "currency", label: "Currency", type: "combobox", required: true, value: "", options: [], pageUrl: state.page!.url });
    state.actions.push({ action: "expand", fieldId: "currency" }, { action: "fill", fieldId: "currency", value: "Euro", source: "USER ANSWERS currency" }, { action: "input", question: "Continue later" });
    const created = await startPortal("application");
    await run(created.id);
    const saved = await row(created.id);
    expect(saved.status).toBe("WAITING_FOR_INPUT");
    expect(saved.error).toBe("Continue later");
    const currency = (saved.snapshot as unknown as RunSnapshot).fields.find((field) => field.id === "currency");
    expect(currency).toMatchObject({ options: ["Euro"], choices: [{ id: "euro-option", label: "Euro" }], actualValue: "Euro" });
    expect(state.calls.filter((call) => ["expand", "fill"].includes(String(call.command))).map((call) => call.command)).toEqual(["expand", "fill"]);
  });
  it("reviews all observed fields, including optional blanks, before one approved submission", async () => {
    state.actions.push({ action: "review", controlId: "submit", summary: "Ready" });
    const created = await startPortal("application"); await run(created.id);
    const ready = await row(created.id);
    expect(ready.status).toBe("WAITING_FOR_REVIEW");
    expect((ready.snapshot as unknown as RunSnapshot).fields.find((field) => field.label === "Phone")).toMatchObject({ required: false, state: "empty", actualValue: "" });
    expect(markdownReport(ready)).toContain("(empty)");
    expect(state.calls.filter((call) => call.command === "submit")).toHaveLength(0);
    await approveBrowserRun(created.id, ready.revision); await run(created.id);
    expect((await row(created.id)).status).toBe("SUBMITTED");
    expect(state.calls.filter((call) => call.command === "submit")).toHaveLength(1);
    expect((await db().application.findUniqueOrThrow({ where: { id: "application" } })).status).toBe("SENT");
    await expect(queueBrowser(created.id)).rejects.toThrow("current state");
  });
  it("invalidates approval after a correction and rejects the old revision", async () => {
    state.actions.push({ action: "review", controlId: "submit", summary: "Ready" });
    const created = await startPortal("application"); await run(created.id);
    await updateBrowserAnswers(created.id, 1, [{ question: "Phone", answer: "Leave it empty" }]);
    expect(await row(created.id)).toMatchObject({ revision: 2, approvedHash: null, status: "WAITING_FOR_INPUT" });
    await expect(approveBrowserRun(created.id, 1)).rejects.toThrow("current run");
  });
  it("submits in automatic mode while keeping the submission intent and evidence", async () => {
    await saveSettings({ applicationSubmissionMode: "automatic" });
    state.actions.push({ action: "review", controlId: "submit", summary: "Ready" });
    const created = await startPortal("application"); await run(created.id);
    const result = await row(created.id);
    expect(result.status).toBe("SUBMITTED");
    expect(result.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["submission_intent", "submission_confirmed"]));
  });
  it("pauses on missing information and rejects links that the browser never observed", async () => {
    state.actions.push({ action: "input", question: "What is your notice period?" });
    const created = await startPortal("application"); await run(created.id);
    expect(await row(created.id)).toMatchObject({ status: "WAITING_FOR_INPUT", error: "What is your notice period?" });
    await updateBrowserAnswers(created.id, 1, [{ question: "notice", answer: "One month" }]);
    state.actions.push({ action: "navigate", url: "https://invented.example.org" });
    await queueBrowser(created.id); await run(created.id);
    expect((await row(created.id)).error).toMatch(/not on the observed page/);
    expect(state.calls.some((call) => call.command === "navigate")).toBe(false);
  });
  it("invalidates a changed reviewed page without treating it as an attempted submission", async () => {
    state.actions.push({ action: "review", controlId: "submit", summary: "Ready" });
    const created = await startPortal("application"); await run(created.id);
    await approveBrowserRun(created.id, 1);
    state.changed = true;
    await run(created.id);
    expect(await row(created.id)).toMatchObject({ status: "WAITING_FOR_INPUT", approvedHash: null, revision: 2 });
    expect((await row(created.id)).events.some((event) => event.kind === "approval_invalidated")).toBe(true);
    expect((await db().application.findUniqueOrThrow({ where: { id: "application" } })).status).toBe("DRAFT");
  });
  it("does not replay an uncertain submission, including after restart", async () => {
    await saveSettings({ applicationSubmissionMode: "automatic" }); state.uncertain = true;
    state.actions.push({ action: "review", controlId: "submit", summary: "Ready" });
    const created = await startPortal("application"); await run(created.id);
    expect((await row(created.id)).status).toBe("UNCERTAIN");
    await recoverBrowserRuns();
    await expect(queueBrowser(created.id)).rejects.toThrow("current state");
    expect(state.calls.filter((call) => call.command === "submit")).toHaveLength(1);
  });
  it("reviews and sends a browser email without requiring a Google API account", async () => {
    const created = await startMailRun({ applicationId: "application", kind: "application-email", to: "hr@example.org", subject: "Application", body: "Hello", artifactIds: ["package"] });
    await run(created.id);
    expect((await row(created.id)).status).toBe("WAITING_FOR_REVIEW");
    expect(await db().googleAccount.count()).toBe(0);
    await approveBrowserRun(created.id, 1); await run(created.id);
    expect((await row(created.id)).status).toBe("SUBMITTED");
    expect(await db().emailMessage.findFirst()).toMatchObject({ direction: "OUTGOING", mailbox: "jane@gmail.com", browserThreadUrl: "https://mail.google.com/mail/u/0/#all/thread" });
    expect(state.calls.filter((call) => call.command === "gmail-send")).toHaveLength(1);
  });
  it("exports the audit history and restores it without executable approvals or active sessions", async () => {
    state.actions.push({ action: "review", controlId: "submit", summary: "Ready" });
    const created = await startPortal("application"); await run(created.id);
    const file = await buildExport(db());
    expect(file.browserRuns[0].events.length).toBeGreaterThan(0);
    const parsed = parseExport(JSON.stringify(file)); expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await importExport(db(), parsed.data);
    expect(await row(created.id)).toMatchObject({ status: "CANCELLED", activeKey: null, approvedHash: null, jobId: null });
    await expect(queueBrowser(created.id)).rejects.toThrow("current state");
  });
});
