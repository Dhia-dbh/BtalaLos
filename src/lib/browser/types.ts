import { z } from "zod";

export const submissionModeSchema = z.enum(["review", "automatic"]);
export const mailFilterSchema = z.object({
  id: z.string().min(1).max(100),
  target: z.enum(["subject", "body", "both"]),
  phrases: z.array(z.string().trim().min(1).max(300)).min(1).max(100),
});
export type MailFilter = z.infer<typeof mailFilterSchema>;
export const browserAiSchema = z.object({
  source: z.enum(["cli", "provider"]),
  provider: z.enum(["codex", "claude", "LOCAL", "OPENAI", "ANTHROPIC", "MISTRAL", "LMSTUDIO"]),
  baseUrl: z.string().max(2000),
  model: z.string().max(300),
  effort: z.enum(["default", "off", "on", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
});
export type BrowserAi = z.infer<typeof browserAiSchema>;
export const fieldSchema = z.object({
  id: z.string(), label: z.string(), type: z.string(), required: z.boolean(),
  value: z.string(), options: z.array(z.string()), pageUrl: z.string(),
  valid: z.boolean().optional(), context: z.string().optional(),
  choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
});
export type BrowserField = z.infer<typeof fieldSchema>;
export const observationSchema = z.object({
  url: z.string(), title: z.string(), text: z.string(),
  fields: z.array(fieldSchema),
  controls: z.array(z.object({ id: z.string(), label: z.string(), final: z.boolean() })),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  diagnostics: z.object({ frameCount: z.number(), shadowRootCount: z.number() }).optional(),
});
export type Observation = z.infer<typeof observationSchema>;
export const browserActionSchema = z.union([
  z.object({ action: z.literal("expand"), fieldId: z.string() }),
  z.object({ action: z.literal("fill"), fieldId: z.string(), value: z.string().max(30_000), source: z.string().min(1).max(3000) }),
  z.object({ action: z.literal("upload"), fieldId: z.string(), artifactId: z.string() }),
  z.object({ action: z.literal("advance"), controlId: z.string() }),
  z.object({ action: z.literal("navigate"), url: z.string() }),
  z.object({ action: z.literal("review"), controlId: z.string(), summary: z.string() }),
  z.object({ action: z.literal("input"), question: z.string() }),
  z.object({ action: z.literal("complete"), evidence: z.string() }),
]);
export type BrowserAction = z.infer<typeof browserActionSchema>;
export type FieldRecord = BrowserField & {
  proposedValue: string | null; actualValue: string; source: string;
  state: "observed" | "filled" | "empty" | "uploaded";
  artifactId?: string; checksum?: string; fileName?: string;
};
export type RunSnapshot = {
  mode: "review" | "automatic"; ai: BrowserAi; prompts: Record<string, string>;
  company: string; role: string; posting: string; postingUrl: string;
  applicant: unknown; facts: string[];
  artifacts: { id: string; role: string; fileName: string; checksum: string; version: number; text: string }[];
  answers: { question: string; answer: string }[];
  fields: FieldRecord[]; observation?: Observation; finalControlId?: string;
  sessionId: string; hops: string[];
  identityVerified?: boolean;
  mail?: { to: string; subject: string; body: string; threadUrl?: string; emailId?: string; from: string; transport?: "api" | "browser" };
};
export const RUN_TERMINAL = ["SUBMITTED", "CANCELLED", "FAILED", "UNCERTAIN"];
