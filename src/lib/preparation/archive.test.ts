import { expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readArchive, restoreArchiveFiles } from "./archive";
import { storedPath } from "./storage";
import type { DossierExport } from "@/lib/data-export";
vi.mock("@/lib/env", () => ({
  env: { DOSSIER_DATA_DIR: "/tmp/dossier-archive-test" },
}));
it("keeps older JSON readable and rejects unexpected archive paths", () => {
  expect(readArchive(strToU8('{"schemaVersion":5}'))).toEqual({
    text: '{"schemaVersion":5}',
    files: {},
  });
  expect(() =>
    readArchive(
      zipSync({ "data.json": strToU8("{}"), "../secret": strToU8("x") }),
    ),
  ).toThrow("unexpected path");
  expect(() => readArchive(zipSync({ "files/abc.pdf": strToU8("x") }))).toThrow(
    "no data.json",
  );
  expect(() => storedPath("../secret.pdf")).toThrow("Invalid stored artifact");
});
it("refuses missing or modified artifact bytes before restoring files", async () => {
  const data = {
    supportingDocuments: [],
    artifacts: [{ path: "abcd.pdf", checksum: "wrong" }],
  } as unknown as DossierExport;
  await expect(restoreArchiveFiles(data, {})).rejects.toThrow("checksum");
  await expect(
    restoreArchiveFiles(data, { "files/abcd.pdf": strToU8("PDF") }),
  ).rejects.toThrow("checksum");
});
