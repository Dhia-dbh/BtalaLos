import "server-only";
import { prisma } from "@/lib/prisma";
import { EMPTY_PROJECT, projectSchema, type Project } from "./types";

export async function loadProject(): Promise<Project> {
  const row = await prisma.setting.findUnique({
    where: { key: "latexProject" },
  });
  return row ? projectSchema.parse(JSON.parse(row.value)) : EMPTY_PROJECT;
}
export async function preparationLibrary() {
  const [profiles, documents, project] = await Promise.all([
    prisma.applicationProfile.findMany({ orderBy: { name: "asc" } }),
    prisma.supportingDocument.findMany({
      where: { deletedAt: null },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { name: "asc" },
    }),
    loadProject(),
  ]);
  return { profiles, documents, project };
}
