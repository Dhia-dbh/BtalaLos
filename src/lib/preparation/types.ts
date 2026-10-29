import { z } from "zod";

export const documentModeSchema = z.enum(["NATIVE", "LATEX"]);
export type DocumentMode = z.infer<typeof documentModeSchema>;

export const projectSchema = z.object({
  repository: z.string().min(1),
  baseRef: z.string().min(1),
  cvPath: z.string().min(1),
  letterPath: z.string().min(1),
  editablePaths: z
    .array(z.string().min(1))
    .min(2)
    .max(30)
    .refine(
      (files) => new Set(files).size === files.length,
      "Editable paths must be unique.",
    ),
  engine: z.enum(["pdflatex", "xelatex", "lualatex"]),
  provider: z.enum(["codex", "claude"]),
  model: z.string().min(1),
  effort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]),
  contextDocumentIds: z.array(z.string()).max(30),
  fileName: z
    .string()
    .regex(/^[^/\\\x00-\x1f]+\.pdf$/)
    .refine((name) => !name.startsWith(".")),
});
export type Project = z.infer<typeof projectSchema>;
export const EMPTY_PROJECT: Project = {
  repository: "",
  baseRef: "HEAD",
  cvPath: "",
  letterPath: "",
  editablePaths: [],
  engine: "pdflatex",
  provider: "codex",
  model: "",
  effort: "medium",
  contextDocumentIds: [],
  fileName: "BenHamouda_Dhia.pdf",
};
export const bundleItemSchema = z.discriminatedUnion("role", [
  z.object({ role: z.literal("cv") }),
  z.object({ role: z.literal("letter") }),
  z.object({ role: z.literal("supporting"), documentId: z.string().min(1) }),
]);
export const bundleSchema = z
  .array(bundleItemSchema)
  .min(2)
  .max(30)
  .refine(
    (items) =>
      items.filter((item) => item.role === "cv").length === 1 &&
      items.filter((item) => item.role === "letter").length === 1,
    "Include one CV and one cover letter.",
  );
export type BundleItem = z.infer<typeof bundleItemSchema>;
export type PdfResult = {
  data: string;
  checksum: string;
  pages: number;
  text?: string;
  log?: string;
};
export type Step = {
  name: string;
  attempts: { startedAt: string; finishedAt?: string; error?: string }[];
  status: "RUNNING" | "DONE" | "FAILED";
  result?: unknown;
  request?: {
    prompt: string;
    schema: Record<string, unknown>;
    provider: string;
    model: string;
    effort: string;
  };
};
export const analysisSchema = z.object({
  title: z.string().nullable(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  location: z.string().nullable(),
  mode: z.string().nullable(),
  salary: z.string().nullable(),
  deadline: z.iso.date().nullable(),
  externalJobId: z.string().nullable(),
  recruiterName: z.string().nullable(),
  recruiterEmail: z.email().nullable(),
  applicationMethod: z.string().nullable(),
  applicationUrl: z.string().nullable(),
  keywords: z.array(z.string()).max(100),
  requirements: z.array(z.string()).max(100),
});
export const replacementsSchema = z.object({
  files: z
    .array(z.object({ path: z.string(), content: z.string().max(1_048_576) }))
    .min(1)
    .max(30),
});
export const draftSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(20_000),
});

export const cliOptionsSchema = projectSchema.pick({
  provider: true,
  model: true,
  effort: true,
});
export type CliOptions = z.infer<typeof cliOptionsSchema>;
