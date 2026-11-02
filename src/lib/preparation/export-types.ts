import { z } from "zod";

export const exportSelectionSchema = z.object({
  applicationId: z.string().min(1),
  packageId: z.string().min(1),
  groups: z.array(z.array(z.number().int().nonnegative()).min(1).max(30)
    .refine((items) => new Set(items).size === items.length, "A group cannot contain the same document twice.")).min(1).max(30),
});
export const exportWriteSchema = exportSelectionSchema.extend({
  expected: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/).nullable()),
});
export type ExportSelection = z.infer<typeof exportSelectionSchema>;
export type ExportOptions = {
  version: number;
  documents: { index: number; name: string; pages: number | null }[];
  exports: { id: string; fileName: string }[];
};
export type ExportPreview = { fileNames: string[]; expected: Record<string, string | null> };
