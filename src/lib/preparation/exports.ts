import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { documentNameSchema, type PdfResult } from "./types";
import { checksum, workerOperation } from "./worker";
import { saveBytes, verifiedBytes } from "./storage";
import type { ExportSelection, ExportOptions, ExportPreview } from "./export-types";

type Item = { role: "cv" | "letter" | "supporting"; id: string; name?: string; checksum: string; version?: number };
async function packageSources(applicationId: string, packageId: string) {
  const pack = await prisma.applicationArtifact.findFirstOrThrow({ where: { id: packageId, applicationId, role: "package" }, include: { application: { select: { documentMode: true } } } });
  const manifest = pack.manifest as { items?: Item[] };
  if (!manifest.items?.length) throw new ActionError("This package has no saved document list. Regenerate its merged PDF first.");
  const documents = await Promise.all(manifest.items.map(async (item) => {
    const file = item.role === "supporting"
      ? await prisma.supportingDocumentVersion.findUniqueOrThrow({ where: { id: item.id } })
      : await prisma.applicationArtifact.findFirstOrThrow({ where: { id: item.id, applicationId, role: item.role } });
    if (file.checksum !== item.checksum) throw new ActionError("A package document no longer matches its recorded checksum.");
    const name = item.role === "cv" ? item.name ?? "CV" : item.role === "letter" ? item.name ?? "Cover letter" : item.name;
    if (!name) throw new ActionError("A saved document has no name. Regenerate the merged PDF before exporting.");
    return { file, name, role: item.role };
  }));
  return { pack, documents, folder: `${pack.application.documentMode === "LATEX" ? "dossier" : "native"}-${applicationId}` };
}
export async function exportOptions(applicationId: string, packageId: string): Promise<ExportOptions> {
  const { pack, documents } = await packageSources(applicationId, packageId);
  const files = await prisma.applicationArtifact.findMany({ where: { applicationId, role: "export" }, orderBy: { version: "desc" } });
  const exports = new Map<string, string>();
  for (const file of files) {
    const manifest = file.manifest as { packageId: string; fileName: string };
    if (manifest.packageId === packageId && !exports.has(manifest.fileName)) exports.set(manifest.fileName, file.id);
  }
  return { version: pack.version, documents: documents.map((document, index) => ({ index, name: document.name, pages: document.file.pages })), exports: [...exports].map(([fileName, id]) => ({ fileName, id })) };
}
async function selection(input: ExportSelection) {
  const source = await packageSources(input.applicationId, input.packageId);
  const files = input.groups.map((group) => {
    const documents = group.map((index) => {
      const document = source.documents[index];
      if (!document) throw new ActionError("A selected document does not belong to this package.");
      documentNameSchema.parse(document.name);
      return document;
    });
    const fileName = `BenHamouda_Dhia-${documents.map((document) => document.name).join("_")}.pdf`;
    if (Buffer.byteLength(fileName) > 255) throw new ActionError("An export filename exceeds 255 bytes. Use shorter names in the profile and regenerate the merged PDF.");
    return { fileName, documents };
  });
  if (new Set(files.map((file) => file.fileName.toLowerCase())).size !== files.length)
    throw new ActionError("Two groups produce the same filename. Change the selection or the document names.");
  return { ...source, files };
}
export async function previewExports(input: ExportSelection): Promise<ExportPreview> {
  const { folder, pack, files } = await selection(input);
  const expected = await workerOperation<Record<string, string | null>>(`export-preview-${randomUUID()}`, {
    kind: "export-files", mode: "preview", folder, version: pack.version, files: files.map(({ fileName }) => ({ fileName })),
  });
  return { fileNames: files.map((file) => file.fileName), expected };
}
export async function writeExports(input: ExportSelection & { expected: Record<string, string | null> }) {
  const { folder, pack, files } = await selection(input);
  if (Object.keys(input.expected).length !== files.length || files.some((file) => !Object.hasOwn(input.expected, file.fileName)))
    throw new ActionError("Preview these files before exporting them.");
  const operationId = randomUUID();
  let totalBytes = 0;
  const outputs: {
    fileName: string;
    data: string;
    checksum: string;
    pages: number | null;
    documents: Awaited<ReturnType<typeof packageSources>>["documents"];
  }[] = [];
  for (const [index, file] of files.entries()) {
    const documents = [];
    for (const document of file.documents) {
      const data = await verifiedBytes(document.file);
      totalBytes += data.length;
      if (totalBytes > 200 * 1024 * 1024) throw new ActionError("Selected exports exceed 200 MiB. Export fewer groups at once.");
      documents.push({ data: data.toString("base64"), checksum: document.file.checksum });
    }
    const result = documents.length === 1
      ? { data: documents[0].data, checksum: documents[0].checksum, pages: file.documents[0].file.pages }
      : await workerOperation<PdfResult>(`export-merge-${operationId}-${index}`, { kind: "merge", documents });
    const bytes = Buffer.from(result.data, "base64");
    if (checksum(bytes) !== result.checksum) throw new ActionError("Export PDF checksum mismatch.");
    outputs.push({ fileName: file.fileName, data: result.data, checksum: result.checksum, pages: result.pages, documents: file.documents });
  }
  await workerOperation(`export-write-${operationId}`, {
    kind: "export-files", mode: "write", folder, version: pack.version,
    files: outputs.map(({ fileName, data, checksum }) => ({ fileName, data, checksum, expectedChecksum: input.expected[fileName] })),
  });
  const stored = await Promise.all(outputs.map((output) => saveBytes(Buffer.from(output.data, "base64"))));
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${input.applicationId} FOR NO KEY UPDATE`;
    const previous = await tx.applicationArtifact.findFirst({ where: { applicationId: input.applicationId, role: "export" }, orderBy: { version: "desc" } });
    for (const [index, output] of outputs.entries()) {
      await tx.applicationArtifact.create({ data: {
        applicationId: input.applicationId, runId: pack.runId, role: "export", version: (previous?.version ?? 0) + index + 1,
        ...stored[index], pages: output.pages,
        manifest: { packageId: pack.id, packageVersion: pack.version, fileName: output.fileName, items: output.documents.map((document) => ({ id: document.file.id, checksum: document.file.checksum, name: document.name, role: document.role })) } as Prisma.InputJsonValue,
      } });
    }
  });
  return exportOptions(input.applicationId, input.packageId);
}
export async function revealExports(applicationId: string, packageId: string) {
  const { pack, folder } = await packageSources(applicationId, packageId);
  const files = await prisma.applicationArtifact.findMany({ where: { applicationId, role: "export" }, orderBy: { version: "desc" } });
  const file = files.find((file) => (file.manifest as { packageId: string }).packageId === packageId);
  if (!file) throw new ActionError("Export files for this version before opening its folder.");
  await workerOperation(`export-reveal-${randomUUID()}`, { kind: "export-files", mode: "reveal", folder, version: pack.version, files: [{ fileName: (file.manifest as { fileName: string }).fileName, expectedChecksum: file.checksum }] });
}
