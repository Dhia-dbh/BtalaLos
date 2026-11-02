import "server-only";
import { emailDraftDecision, emailDraftModeSchema, submissionMethodSchema } from "./email-drafting";
import { prisma } from "./prisma";
import { loadSettings } from "./settings-data";
import { writeEmailJob } from "./jobs/write-email";
import { startJob } from "./jobs/runner";

export async function queueAutomaticEmail(applicationId: string) {
  const [application, settings] = await Promise.all([
    prisma.application.findUniqueOrThrow({ where: { id: applicationId } }), loadSettings(),
  ]);
  const mode = application.emailDraftMode ? emailDraftModeSchema.parse(application.emailDraftMode) : settings.emailDraftMode;
  const extracted = application.extracted as { submissionMethod?: string } | null;
  const method = submissionMethodSchema.parse(extracted?.submissionMethod ?? "UNKNOWN");
  const decision = emailDraftDecision(mode, method);
  await prisma.application.update({ where: { id: applicationId }, data: { extracted: { ...(application.extracted as object ?? {}), emailDraftDecision: decision } } });
  if (decision.draft) await startJob(writeEmailJob, { applicationId, automaticPolicy: mode }, { id: `automatic-email-${applicationId}`, key: `email:${applicationId}`, applicationId });
}
