import "server-only";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { ActionError } from "@/lib/action";
import { checksum } from "./worker";

export const preparationDirectory = () =>
  path.join(env.DOSSIER_DATA_DIR, "preparation");
export function storedPath(relative: string) {
  if (!/^[a-f0-9-]+\.(pdf|json|txt)$/.test(relative))
    throw new ActionError("Invalid stored artifact path.");
  return path.join(preparationDirectory(), relative);
}
export async function saveBytes(data: Uint8Array, extension = "pdf") {
  await mkdir(preparationDirectory(), { recursive: true, mode: 0o700 });
  const relative = `${randomUUID()}.${extension}`;
  await writeFile(storedPath(relative), data, { mode: 0o600, flag: "wx" });
  return { path: relative, checksum: checksum(data) };
}
export async function verifiedBytes(file: { path: string; checksum: string }) {
  const data = await readFile(storedPath(file.path));
  if (checksum(data) !== file.checksum)
    throw new ActionError("Stored file differs from its recorded checksum.");
  return data;
}
export async function deletePreparationFiles() {
  await rm(preparationDirectory(), { recursive: true, force: true });
}
