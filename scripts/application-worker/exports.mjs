import { readFile, writeFile, rename, link, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { privateDirectory, inside, id, digest, requireValue, MAX_PACKAGE } from "./tools.mjs";
import { revealExport } from "./host-actions.mjs";
import { hostOperation } from "./host-client.mjs";

export async function exportFiles(config, input, signal, operationId) {
  requireValue(["preview", "write", "reveal"].includes(input.mode), "Invalid export action.");
  requireValue(Number.isSafeInteger(input.version) && input.version > 0, "Invalid package version.");
  requireValue(Array.isArray(input.files) && input.files.length > 0 && input.files.length <= 30, "Select up to 30 output files.");
  const root = await privateDirectory(config.exports);
  const folder = await inside(root, `${id(input.folder)}/v${input.version}`, false);
  const files = [];
  let size = 0;
  for (const file of input.files) {
    requireValue(typeof file.fileName === "string" && /^BenHamouda_Dhia-[^/\\\x00-\x1f\x7f]+\.pdf$/.test(file.fileName) && Buffer.byteLength(file.fileName) <= 255, "Invalid export filename.");
    requireValue(!files.some((prior) => prior.fileName.toLowerCase() === file.fileName.toLowerCase()), "Duplicate export filenames.");
    const target = await inside(root, `${id(input.folder)}/v${input.version}/${file.fileName}`, false);
    const previous = await readFile(target).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    const current = previous ? digest(previous) : null;
    if (input.mode !== "preview") requireValue(file.expectedChecksum === current, "Export files changed. Preview them again before replacing anything.");
    let bytes;
    if (input.mode === "write") {
      bytes = Buffer.from(file.data, "base64");
      size += bytes.length;
      requireValue(size <= MAX_PACKAGE && bytes.length > 0 && digest(bytes) === file.checksum, "Export size or checksum mismatch.");
    }
    files.push({ ...file, target, current, bytes });
  }
  if (input.mode === "preview") return Object.fromEntries(files.map((file) => [file.fileName, file.current]));
  if (input.mode === "reveal") {
    requireValue(files[0].current !== null, "Export the files before opening this folder.");
    const request = { kind: "reveal", folder: input.folder, versionDirectory: input.version, fileName: files[0].fileName, checksum: files[0].current };
    return config.hostUrl ? hostOperation(config, request, signal, operationId) : revealExport(config, request, signal);
  }
  await privateDirectory(folder);
  for (const file of files) {
    signal?.throwIfAborted();
    const temporary = await inside(folder, `.export-${randomUUID()}.tmp`, false);
    try {
      await writeFile(temporary, file.bytes, { mode: 0o600, flag: "wx" });
      if (file.current === null) await link(temporary, file.target);
      else {
        requireValue(digest(await readFile(file.target)) === file.expectedChecksum, "An export changed. Preview again before replacing it.");
        await rename(temporary, file.target);
      }
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return { folder: `${input.folder}/v${input.version}`, fileNames: files.map((file) => file.fileName) };
}
