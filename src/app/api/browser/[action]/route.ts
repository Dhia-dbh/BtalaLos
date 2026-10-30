import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/route";
import { prisma } from "@/lib/prisma";
import { saveSettings } from "@/lib/settings-data";
import { encryptApiKey } from "@/lib/ai/api-key";
import { browserAiSchema, mailFilterSchema, submissionModeSchema } from "@/lib/browser/types";
import { browserModels } from "@/lib/browser/ai";
import { approveBrowserRun, draftOutreach, prepareOutreach, browserConnection, browserEvent, cancelBrowserRun, hostBrowser, queueBrowser, startPortal, updateBrowserAnswers } from "@/lib/browser/service";
import { markdownReport } from "@/lib/browser/audit";

const settingsInput = z.strictObject({
  browserEnabled: z.boolean(), browserAi: browserAiSchema, applicationSubmissionMode: submissionModeSchema,
  replySubmissionMode: submissionModeSchema, gmailBackend: z.enum(["api", "browser"]),
  gmailReadingMode: z.enum(["manual", "scheduled"]), gmailAutoDraft: z.boolean(), gmailRead: z.boolean(),
  gmailScope: z.enum(["known", "all"]), gmailInterval: z.number().int().min(5).max(120),
  gmailFilters: z.array(mailFilterSchema).max(100), apiKey: z.string().max(4000).optional(), clearKey: z.boolean().optional(),
});
export const GET = route<RouteContext<"/api/browser/[action]">>(async (request, { params }) => {
  const { action } = await params;
  if (action === "runs") {
    const applicationId = request.nextUrl.searchParams.get("applicationId");
    const runs = await prisma.browserRun.findMany({ where: applicationId ? { applicationId } : {}, include: { events: { select: { id: true, kind: true, createdAt: true }, orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" }, take: 30 });
    return NextResponse.json(runs);
  }
  if (action === "report") {
    const run = await prisma.browserRun.findUniqueOrThrow({ where: { id: z.string().min(1).parse(request.nextUrl.searchParams.get("id")) }, include: { events: { orderBy: { createdAt: "asc" } } } });
    return new Response(markdownReport(run), { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="application-run-${run.id}.md"` } });
  }
  if (action === "connection") {
    try { return NextResponse.json(await browserConnection(z.enum(["gmail", "portals"]).parse(request.nextUrl.searchParams.get("profile")))); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Cannot reach the browser host." }, { status: 422 }); }
  }
  return NextResponse.json({ error: "Unknown browser route." }, { status: 404 });
});
export const POST = route<RouteContext<"/api/browser/[action]">>(async (request, { params }) => {
  try {
    const { action } = await params;
    const input = await request.json();
    if (action === "settings") {
      const { apiKey, clearKey, ...settings } = settingsInput.parse(input);
      if (settings.browserAi.model) {
        const model = (await browserModels(settings.browserAi, apiKey || (clearKey ? "" : undefined))).find((model) => model.id === settings.browserAi.model);
        if (!model || settings.browserAi.effort !== "default" && !model.efforts.includes(settings.browserAi.effort)) throw new Error("Choose an available browser model and a supported thinking setting.");
      }
      await saveSettings({ ...settings, ...(apiKey?.trim() ? { browserAiKeyEnc: encryptApiKey(apiKey.trim()) } : clearKey ? { browserAiKeyEnc: null } : {}) });
      return NextResponse.json({ saved: true });
    }
    if (action === "models") {
      const { apiKey, ...ai } = z.object({ ...browserAiSchema.shape, apiKey: z.string().max(4000).optional() }).parse(input);
      return NextResponse.json(await browserModels(ai, apiKey));
    }
    if (action === "open" || action === "connect") {
      const profile = z.enum(["gmail", "portals"]).parse(input.profile);
      const result = await hostBrowser<{ connected: boolean; email?: string }>(action, { profile });
      if (action === "connect" && profile === "gmail" && result.connected && result.email) await saveSettings({ gmailBrowserEmail: result.email, gmailBrowserProblem: null });
      return NextResponse.json(result);
    }
    if (action === "start") return NextResponse.json(await startPortal(z.string().min(1).parse(input.applicationId)));
    if (action === "outreach-draft") return NextResponse.json(await draftOutreach(z.string().min(1).parse(input.applicationId)));
    if (action === "outreach-send") {
      const data = z.object({ id: z.string(), to: z.string(), subject: z.string(), body: z.string(), artifactIds: z.array(z.string()) }).parse(input);
      await prepareOutreach(data.id, data, data.artifactIds);
      return NextResponse.json({ ok: true });
    }
    const { id } = z.object({ id: z.string().min(1) }).parse(input);
    if (action === "approve") await approveBrowserRun(id, z.number().int().parse(input.revision));
    else if (action === "resume") await queueBrowser(id);
    else if (action === "cancel") await cancelBrowserRun(id);
    else if (action === "answers") {
      const data = z.object({ revision: z.number().int(), answers: z.array(z.object({ question: z.string().min(1).max(3000), answer: z.string().max(30_000) })).max(200), url: z.url().optional(), mail: z.object({ to: z.string().max(500), subject: z.string().max(500), body: z.string().max(30_000) }).optional() }).parse(input);
      await updateBrowserAnswers(id, data.revision, data.answers, data.url, data.mail);
    } else if (action === "reconcile") {
      const { outcome, evidence } = z.object({ outcome: z.enum(["submitted", "not-submitted"]), evidence: z.string().trim().min(10).max(5000) }).parse(input);
      const run = await prisma.browserRun.findUniqueOrThrow({ where: { id } });
      if (run.status !== "UNCERTAIN") throw new Error("Only uncertain submissions can be reconciled.");
      await browserEvent(id, "user_reconciled", { outcome, evidence });
      await prisma.browserRun.update({ where: { id }, data: { status: outcome === "submitted" ? "SUBMITTED" : "CANCELLED", activeKey: null, finishedAt: new Date(), error: null } });
      const snapshot = run.snapshot as unknown as import("@/lib/browser/types").RunSnapshot;
      if (outcome === "submitted" && snapshot.mail?.emailId) await prisma.emailMessage.update({ where: { id: snapshot.mail.emailId }, data: { handledAt: new Date(), replyDraft: "", replyGaps: [] } });
      if (snapshot.mail?.transport !== "api") { try { await hostBrowser("close", { sessionId: snapshot.sessionId }); } catch { /* The remote session may already be closed. */ } }
      if (outcome === "submitted" && run.applicationId && ["portal", "application-email"].includes(run.kind)) {
        const { applyStatusChange } = await import("@/lib/status-changes");
        const app = await prisma.application.findUniqueOrThrow({ where: { id: run.applicationId } });
        if (app.status === "DRAFT") await applyStatusChange(prisma, run.applicationId, "SENT");
      }
    } else return NextResponse.json({ error: "Unknown browser action." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? z.prettifyError(error) : error instanceof Error ? error.message : "Browser operation failed." }, { status: 422 });
  }
});
