import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { unlink, writeFile } from "node:fs/promises";
import { saveBytes, storedPath } from "@/lib/preparation/storage";
import { emailParts } from "@/lib/application-email";
import { unitsSchema } from "@/lib/application-data";
import { MockProvider } from "@/lib/ai/providers/mock";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import type { ReadMail } from "./gmail";
import { createTestClient, resetDatabase } from "@/test/db";

// The inbox check and Send with Gmail (E15-2, E15-3) against a test
// database, with Google's APIs answered by a fake fetch.

const db = vi.hoisted(() => ({ client: undefined as ReturnType<typeof createTestClient> | undefined }));
vi.mock("@/lib/prisma", async () => {
  const { createTestClient } = await import("@/test/db");
  db.client = createTestClient();
  return { prisma: db.client };
});
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_SECRET: "s".repeat(40), DOSSIER_GOOGLE_CLIENT_ID: "client", DOSSIER_GOOGLE_CLIENT_SECRET: "secret", DOSSIER_DATA_DIR: "/tmp" },
}));
const provider = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("@/lib/ai", () => ({ getAiProvider: async () => provider.current }));
vi.mock("@/lib/ai/config", () => ({ isAiConfigured: async () => true }));
vi.mock("@/lib/ai/task-options", () => ({ loadTaskOptions: async () => ({ creativity: "BALANCED", strict: true, language: null }) }));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: async () => new Uint8Array([37, 80, 68, 70]) }));
vi.mock("@/lib/time-zone", () => ({ userTimeZone: async () => "Europe/Berlin", lastKnownTimeZone: async () => "Europe/Berlin" }));
vi.mock("@/lib/jobs/runner", () => ({ defineJob: <T,>(job: T) => job, startJob: async () => "queued-mail-job", cancelJob: async () => {} }));
const browserInbox = vi.hoisted(() => ({ mails: [] as (ReadMail & { browserMessageId: string; browserThreadUrl: string })[] }));
vi.mock("./transport", () => ({ readBrowserMailbox: async () => browserInbox.mails }));

import { encryptSecret, GOOGLE_TOKEN } from "@/lib/secrets";

import { sendApplicationEmail, sendReply } from "./send";
import { syncInbox } from "./sync";

const prisma = () => db.client!;
const b64 = (text: string) => Buffer.from(text).toString("base64url");

/** `history`: when Gmail added it; before the mailbox's 200 unless given. `deleted`: listed, but gone when fetched. */
type Mail = { id: string; threadId: string; from: string; subject: string; text: string; labels?: string[]; date?: string; history?: number; deleted?: boolean };
const gmailMessage = ({ id, threadId, from, subject, text, labels = ["INBOX"], date = "2026-10-17T13:02:00Z" }: Mail) => ({
  id,
  threadId,
  labelIds: labels,
  internalDate: String(new Date(date).getTime()),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "To", value: "jane@gmail.com" },
      { name: "Subject", value: subject },
      { name: "Message-ID", value: `<${id}@mail.example>` },
    ],
    parts: [{ mimeType: "text/plain", body: { data: b64(text) } }],
  },
});

let mailbox: Mail[] = [];
let sent: { raw: string; threadId?: string }[] = [];

function fakeGoogle(url: string, init?: RequestInit): Response {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const path = new URL(url).pathname;
  if (url.startsWith("https://oauth2.googleapis.com/token")) return json({ access_token: "access", expires_in: 3600, scope: "" });
  if (path.endsWith("/profile")) return json({ historyId: "200" });
  if (path.endsWith("/messages") && (init?.method ?? "GET") === "GET") return json({ messages: mailbox.map((mail) => ({ id: mail.id })) });
  if (path.endsWith("/history")) {
    const start = Number(new URL(url).searchParams.get("startHistoryId"));
    const added = mailbox.filter((mail) => (mail.history ?? 150) > start);
    return json({ history: [{ messagesAdded: added.map((mail) => ({ message: { id: mail.id } })) }], historyId: "300" });
  }
  if (path.endsWith("/messages/send")) {
    const body = JSON.parse(String(init?.body)) as { raw: string; threadId?: string };
    sent.push(body);
    return json({ id: `sent-${sent.length}`, threadId: body.threadId ?? "thread-new" });
  }
  const id = /messages\/([^/?]+)/.exec(path)?.[1];
  const mail = mailbox.find((entry) => entry.id === id);
  if (mail && !mail.deleted) return json(gmailMessage(mail));
  return new Response("not found", { status: 404 });
}

const scopes = "openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly";

beforeEach(async () => {
  await resetDatabase(prisma());
  mailbox = [];
  sent = [];
  browserInbox.mails = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => fakeGoogle(String(url), init)));
  await prisma().googleAccount.create({ data: { email: "jane@gmail.com", refreshTokenEnc: encryptSecret(GOOGLE_TOKEN, "refresh", "s".repeat(40)), scopes } });
  await prisma().profileField.create({ data: { key: "name", value: "Jane Doe" } });
  await prisma().application.create({
    data: {
      id: "nw",
      company: "Northwind Logistics",
      role: "Product Designer",
      status: "DRAFT",
      postingText: "Apply to careers@northwind.example.",
      documents: {
        create: [
          { kind: "EMAIL", units: [{ id: "to", label: "Recipient", text: "careers@northwind.example" }, { id: "subject", label: "Subject", text: "Application: Product Designer" }, { id: "body", label: "Message", text: "Dear team,\n\nI'm applying.\n\nJane" }] },
          { kind: "RESUME", units: [] },
        ],
      },
    },
  });
  provider.current = new MockProvider({
    reply: () => ({ kind: "INTERVIEW", summary: "Invites you to a call.", questions: ["What is your notice period?"], confirmedTime: null }),
  });
});

describe("mail backend additions", () => {
  const browserMail = (id = "m1") => ({ id: `browser:${id}`, threadId: "browser:thread", from: "HR <hr@northwind.example>", to: "jane@gmail.com", subject: "Your application", text: "Can you confirm your interest?", messageId: `<${id}@mail.example>`, references: "", date: new Date("2026-10-30T10:00:00Z"), labels: ["INBOX"], browserMessageId: `<${id}@mail.example>`, browserThreadUrl: "https://mail.google.com/mail/u/0/#all/thread" });

  it("applies scoped exclusion rules before importing or classifying even a known-company message", async () => {
    await saveSettings({ gmailFilters: [{ id: "news", target: "subject", phrases: ["Jobs for you"] }] });
    mailbox = [
      { id: "filtered", threadId: "news", from: "HR <hr@northwind.example>", subject: "JOBS FOR YOU", text: "Newsletter" },
      { id: "kept", threadId: "real", from: "HR <hr@northwind.example>", subject: "Interview", text: "Could we talk?" },
    ];
    expect(await syncInbox()).toMatchObject({ kept: 1, read: 1 });
    expect(await prisma().emailMessage.findUnique({ where: { gmailId: "filtered" } })).toBeNull();
    expect((await loadSettings()).gmailLastSkipped).toEqual([{ rules: ["news"], count: 1 }]);
    expect(mailbox).toHaveLength(2);
  });
  it("reads through the browser without an API account and keeps filters active", async () => {
    await prisma().googleAccount.deleteMany();
    await saveSettings({ gmailBackend: "browser", gmailBrowserEmail: "jane@gmail.com", gmailFilters: [{ id: "newsletter", target: "body", phrases: ["unsubscribe"] }] });
    browserInbox.mails = [browserMail(), { ...browserMail("newsletter"), text: "Please UNSUBSCRIBE here" }];
    expect(await syncInbox()).toMatchObject({ kept: 1, read: 1 });
    expect(await prisma().emailMessage.count()).toBe(1);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(0);
  });
  it("reconciles RFC identities in both directions when changing mail backends", async () => {
    mailbox = [{ id: "m1", threadId: "api-thread", from: "HR <hr@northwind.example>", subject: "Your application", text: "Can you confirm your interest?" }];
    await syncInbox();
    await saveSettings({ gmailBackend: "browser", gmailBrowserEmail: "jane@gmail.com" });
    browserInbox.mails = [browserMail()];
    expect(await syncInbox()).toMatchObject({ kept: 0 });
    expect(await prisma().emailMessage.findUnique({ where: { gmailId: "m1" } })).toMatchObject({ browserThreadUrl: browserMail().browserThreadUrl });
    browserInbox.mails.push(browserMail("m2"));
    await syncInbox();
    await saveSettings({ gmailBackend: "api" });
    mailbox.push({ id: "m2", threadId: "api-thread-two", from: "HR <hr@northwind.example>", subject: "Your application", text: "Can you confirm your interest?", history: 250 });
    await syncInbox();
    expect(await prisma().emailMessage.count({ where: { direction: "INCOMING" } })).toBe(2);
    expect(await prisma().emailMessage.findUnique({ where: { gmailId: "m2" } })).toMatchObject({ threadId: "api-thread-two", browserThreadUrl: browserMail().browserThreadUrl });
  });
  it("automatically drafts questions for review without sending or answering acknowledgements", async () => {
    await saveSettings({ gmailAutoDraft: true, replySubmissionMode: "review" });
    const calls: string[] = [];
    provider.current = new MockProvider({ reply: (call) => {
      calls.push(call.json?.name ?? "");
      if (call.json?.name === "classified_reply") return { kind: call.messages[0].content.includes("received your application") ? "ACKNOWLEDGEMENT" : "QUESTION", summary: "Employer response", questions: [], confirmedTime: null };
      return { greeting: "Hello", paragraphs: ["Thank you."], signOff: "Regards", gaps: [] };
    } });
    mailbox = [
      { id: "question", threadId: "tq", from: "HR <hr@northwind.example>", subject: "Question", text: "Are you interested?" },
      { id: "ack", threadId: "ta", from: "HR <hr@northwind.example>", subject: "Confirmation", text: "We received your application" },
    ];
    await syncInbox();
    expect((await prisma().emailMessage.findUniqueOrThrow({ where: { gmailId: "question" } })).replyDraft).toContain("Thank you.");
    expect((await prisma().emailMessage.findUniqueOrThrow({ where: { gmailId: "ack" } })).replyDraft).toBe("");
    expect(calls.filter((name) => name === "reply_draft")).toHaveLength(1);
    expect(sent).toHaveLength(0);
  });
  it("records an automatic API reply run before the send and handles it only after confirmation", async () => {
    await saveSettings({ gmailAutoDraft: true, replySubmissionMode: "automatic" });
    provider.current = new MockProvider({ reply: (call) => call.json?.name === "classified_reply" ? { kind: "QUESTION", summary: "Asks for a reply", questions: [], confirmedTime: null } : { greeting: "Hello", paragraphs: ["Thank you."], signOff: "Regards", gaps: [] } });
    mailbox = [{ id: "automatic", threadId: "api-auto", from: "HR <hr@northwind.example>", subject: "Question", text: "Are you interested?" }];
    await syncInbox();
    const run = await prisma().browserRun.findFirstOrThrow({ where: { kind: "reply" } });
    expect(run.status).toBe("QUEUED"); expect(sent).toHaveLength(0);
    const { browserJob } = await import("@/lib/browser/service");
    await browserJob.run({ runId: run.id }, { id: "auto-reply-test", step: async () => {}, signal: new AbortController().signal });
    expect((await prisma().browserRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("SUBMITTED");
    expect(sent).toHaveLength(1);
    expect((await prisma().emailMessage.findUniqueOrThrow({ where: { gmailId: "automatic" } })).handledAt).not.toBeNull();
  });
});

afterEach(() => vi.unstubAllGlobals());
afterAll(async () => prisma().$disconnect());

describe("Send with Gmail (E15-2)", () => {
  it("sends with the PDFs, keeps the thread and moves the draft to Sent", async () => {
    const result = await sendApplicationEmail("nw");
    expect(result.eventId).not.toBeNull();
    expect(result.attachments).toHaveLength(1);
    const raw = Buffer.from(sent[0].raw, "base64url").toString("utf8");
    expect(raw).toContain("From: Jane Doe <jane@gmail.com>");
    expect(raw).toContain("To: careers@northwind.example");
    expect(raw).toContain("application/pdf");
    const application = await prisma().application.findUniqueOrThrow({ where: { id: "nw" } });
    expect(application).toMatchObject({ status: "SENT", emailThreadId: "thread-new" });
    expect(await prisma().emailMessage.count({ where: { applicationId: "nw", direction: "OUTGOING" } })).toBe(1);
  });
});

describe("merged-package Gmail attachments", () => {
  async function packageForSend() {
    const profile = await prisma().applicationProfile.create({ data: { name: "PhD", items: [{ role: "cv" }, { role: "letter" }] } });
    await prisma().application.update({ where: { id: "nw" }, data: { packageProfileId: profile.id } });
    const run = await prisma().preparationRun.create({ data: { applicationId: "nw", kind: "prepare", status: "READY", snapshot: {} } });
    const bytes = Buffer.from("%PDF-verified-merged-package");
    const file = await prisma().applicationArtifact.create({ data: { applicationId: "nw", runId: run.id, role: "package", version: 1, ...await saveBytes(bytes), pages: 3, manifest: { fileName: "BenHamouda_Dhia.pdf" } } });
    const email = emailParts(unitsSchema.parse((await prisma().document.findUniqueOrThrow({ where: { applicationId_kind: { applicationId: "nw", kind: "EMAIL" } } })).units));
    return { file, bytes, reviewed: { packageId: file.id, email } };
  }
  it("sends the reviewed merged bytes as one attachment and rejects changed email revisions", async () => {
    const { file, bytes, reviewed } = await packageForSend();
    try {
      await expect(sendApplicationEmail("nw", { ...reviewed, email: { ...reviewed.email, subject: "Changed" } })).rejects.toThrow("changed");
      expect(sent).toHaveLength(0);
      const result = await sendApplicationEmail("nw", reviewed);
      expect(result.attachments).toEqual(["BenHamouda_Dhia.pdf"]);
      const raw = Buffer.from(sent[0].raw, "base64url").toString("utf8");
      expect(raw).toContain(bytes.toString("base64"));
    } finally { await unlink(storedPath(file.path)); }
  });
  it("rejects changed package bytes and missing review without sending", async () => {
    const { file, reviewed } = await packageForSend();
    try {
      await expect(sendApplicationEmail("nw")).rejects.toThrow("review");
      await writeFile(storedPath(file.path), "changed");
      await expect(sendApplicationEmail("nw", reviewed)).rejects.toThrow("checksum");
      expect(sent).toHaveLength(0);
    } finally { await unlink(storedPath(file.path)); }
  });
});

describe("the inbox check (E15-3)", () => {
  it("links replies in a known thread or from the company's domain, and has the AI read them", async () => {
    await sendApplicationEmail("nw");
    mailbox = [
      { id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Could we talk next week?\n\nOn Mon, Jane wrote:\n> I'm applying" },
      { id: "m2", threadId: "t2", from: "HR <hr@northwind.example>", subject: "Your application", text: "Thanks!" },
      { id: "m3", threadId: "t3", from: "Friend <friend@gmail.com>", subject: "Lunch?", text: "Tomorrow?" },
      { id: "m4", threadId: "t4", from: "Deals <deals@shop.example>", subject: "Sale", text: "50% off", labels: ["INBOX", "CATEGORY_PROMOTIONS"] },
    ];
    const result = await syncInbox();
    expect(result).toEqual({ fetched: 4, kept: 2, read: 2 });

    const kept = await prisma().emailMessage.findMany({ where: { direction: "INCOMING" }, orderBy: { gmailId: "asc" } });
    expect(kept.map((email) => [email.gmailId, email.applicationId, email.kind, email.suggestedStatus])).toEqual([
      ["m1", "nw", "INTERVIEW", "INTERVIEW"],
      ["m2", "nw", "INTERVIEW", "INTERVIEW"],
    ]);
    expect(kept[0].body).toBe("Could we talk next week?");
    expect(kept[0].questions).toEqual(["What is your notice period?"]);
    const account = await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } });
    expect(account).toMatchObject({ historyId: "200", syncProblem: null });

    // The next check carries on from the history: only what's new since.
    mailbox.push({ id: "m6", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Wednesday 14:00 works.", history: 250 });
    expect(await syncInbox()).toEqual({ fetched: 1, kept: 1, read: 1 });
    expect((await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).historyId).toBe("300");
  });

  it("skips mail deleted since Gmail listed it, and carries on from the history", async () => {
    await sendApplicationEmail("nw");
    await syncInbox();
    mailbox = [
      { id: "spam", threadId: "t8", from: "Spam <win@prize.example>", subject: "You won", text: "Click", labels: ["SPAM"], history: 250, deleted: true },
      { id: "m7", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Thursday?", history: 250 },
    ];
    expect(await syncInbox()).toEqual({ fetched: 2, kept: 1, read: 1 });
    expect(await prisma().googleAccount.findUniqueOrThrow({ where: { id: "google" } })).toMatchObject({ historyId: "300", syncProblem: null });
  });

  it("keeps unmatched inbox mail for a look when set to read everything", async () => {
    await prisma().setting.create({ data: { key: "gmailScope", value: "all" } });
    mailbox = [{ id: "m5", threadId: "t5", from: "Recruiter <talent@acme-hr.example>", subject: "Senior Designer role", text: "Interested?" }];
    await syncInbox();
    expect(await prisma().emailMessage.findFirst({ where: { gmailId: "m5" } })).toMatchObject({ applicationId: null });
  });

  it("answers in the thread and marks the reply as answered", async () => {
    await sendApplicationEmail("nw");
    mailbox = [{ id: "m1", threadId: "thread-new", from: "Anna Keller <a.keller@northwind.example>", subject: "Re: Application", text: "Notice period?" }];
    await syncInbox();
    const reply = await prisma().emailMessage.findFirstOrThrow({ where: { gmailId: "m1" } });

    await expect(sendReply(reply.id, "Hi Anna, it's […].")).rejects.toThrow("Fill in the parts marked […] first.");
    await sendReply(reply.id, "Hi Anna,\n\nThree months.\n\nJane");
    const raw = Buffer.from(sent.at(-1)!.raw, "base64url").toString("utf8");
    expect(sent.at(-1)!.threadId).toBe("thread-new");
    expect(raw).toContain("Subject: Re: Application");
    expect(raw).toContain("In-Reply-To: <m1@mail.example>");
    expect(await prisma().emailMessage.findUniqueOrThrow({ where: { id: reply.id } })).toMatchObject({ handledAt: expect.any(Date) });
  });
});
