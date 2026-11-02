import { z } from "zod";

export const emailDraftModeSchema = z.enum(["AUTO", "DISABLE", "ENABLE"]);
export type EmailDraftMode = z.infer<typeof emailDraftModeSchema>;
export const submissionMethodSchema = z.enum(["EMAIL", "PORTAL", "EMAIL_OR_PORTAL", "OTHER", "UNKNOWN"]);
export type SubmissionMethod = z.infer<typeof submissionMethodSchema>;
export const SUBMISSION_CLASSIFICATION_RULE = "submissionMethod classifies the explicitly accepted application submission methods: EMAIL, PORTAL, EMAIL_OR_PORTAL, OTHER, or UNKNOWN. A contact or questions email is not an accepted email application route. Portal instructions count even when the destination URL is missing. Use UNKNOWN when the posting does not specify a submission method.";
export function emailDraftDecision(mode: EmailDraftMode, method: SubmissionMethod) {
  if (mode === "DISABLE") return { draft: false, reason: "Automatic email drafting is disabled." };
  if (mode === "ENABLE") return { draft: true, reason: "Automatic email drafting is enabled." };
  if (["EMAIL", "EMAIL_OR_PORTAL"].includes(method)) return { draft: true, reason: "The posting explicitly accepts applications by email." };
  return { draft: false, reason: method === "PORTAL" ? "The posting requires portal submission." : "The posting does not explicitly accept applications by email." };
}
