import { expect, it } from "vitest";
import { emailDraftDecision, type EmailDraftMode, type SubmissionMethod } from "./email-drafting";

it.each(["EMAIL", "PORTAL", "EMAIL_OR_PORTAL", "OTHER", "UNKNOWN"] as SubmissionMethod[])("applies all three policies to %s", (method) => {
  expect(emailDraftDecision("ENABLE", method).draft).toBe(true);
  expect(emailDraftDecision("DISABLE", method).draft).toBe(false);
  expect(emailDraftDecision("AUTO", method).draft).toBe(["EMAIL", "EMAIL_OR_PORTAL"].includes(method));
});
it.each(["AUTO", "DISABLE", "ENABLE"] as EmailDraftMode[])("explains the decision for %s", (mode) => {
  expect(emailDraftDecision(mode, "PORTAL").reason).not.toBe("");
});
