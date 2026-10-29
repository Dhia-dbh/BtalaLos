import "server-only";
import { unzipSync, zipSync, strToU8, type Zippable } from "fflate";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { ActionError } from "@/lib/action";
import type { DossierExport } from "@/lib/data-export";
import { IMPORT_MAX_BYTES } from "@/lib/import-limits";
import { preparationDirectory, storedPath, verifiedBytes } from "./storage";
import { checksum } from "./worker";

export async function buildArchive(data: DossierExport): Promise<Buffer> {
  const files: Zippable = { "data.json": strToU8(JSON.stringify(data)) };
  const assets = [
    ...data.supportingDocuments.flatMap((document) => document.versions),
    ...data.artifacts,
  ];
  let size = (files["data.json"] as Uint8Array).byteLength;
  for (const asset of assets) {
    const bytes = await verifiedBytes(asset);
    size += bytes.byteLength;
    if (size > IMPORT_MAX_BYTES)
      throw new ActionError(
        "Saved data exceeds the 200 MiB archive limit. Preserve a filesystem/database backup before reducing history.",
      );
    files[`files/${asset.path}`] = [bytes, { level: 0 }];
  }
  return Buffer.from(zipSync(files));
}
export function readArchive(bytes: Uint8Array): {
  text: string;
  files: Record<string, Uint8Array>;
} {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    return { text: new TextDecoder().decode(bytes), files: {} };
  let size = 0;
  const files = unzipSync(bytes, {
    filter: (file) => {
      size += file.originalSize;
      if (
        size > IMPORT_MAX_BYTES ||
        (file.name !== "data.json" &&
          !/^files\/[a-f0-9-]+\.(pdf|txt|json)$/.test(file.name))
      )
        throw new ActionError(
          "Archive is oversized or contains an unexpected path.",
        );
      return true;
    },
  });
  if (!files["data.json"])
    throw new ActionError("Archive has no data.json manifest.");
  return { text: new TextDecoder().decode(files["data.json"]), files };
}
export async function restoreArchiveFiles(
  data: DossierExport,
  files: Record<string, Uint8Array>,
) {
  const assets = [
    ...data.supportingDocuments.flatMap((document) => document.versions),
    ...data.artifacts,
  ];
  if (assets.length === 0) return async () => {};
  for (const asset of assets) {
    storedPath(asset.path);
    if (
      !files[`files/${asset.path}`] ||
      checksum(files[`files/${asset.path}`]) !== asset.checksum
    )
      throw new ActionError(
        "Archive is missing a document or its checksum does not match.",
      );
  }
  await mkdir(preparationDirectory(), { recursive: true, mode: 0o700 });
  const created: string[] = [];
  const rollback = async () => {
    await Promise.all(created.map((file) => unlink(file)));
  };
  try {
    for (const asset of assets) {
      const file = storedPath(asset.path);
      const existing = await readFile(file).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (existing) {
        if (checksum(existing) !== asset.checksum)
          throw new ActionError(
            "An existing document has different bytes. Import was stopped.",
          );
      } else {
        await writeFile(file, files[`files/${asset.path}`], {
          flag: "wx",
          mode: 0o600,
        });
        created.push(file);
      }
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return rollback;
}
