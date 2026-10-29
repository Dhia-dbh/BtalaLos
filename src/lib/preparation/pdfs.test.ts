import { beforeEach, expect, it, vi } from "vitest";
import { storedApplicationPdf } from "./pdfs";
import { prisma } from "@/lib/prisma";
vi.mock("@/lib/prisma", () => ({
  prisma: { applicationArtifact: { findFirst: vi.fn() } },
}));
vi.mock("./storage", () => ({
  verifiedBytes: async () => Buffer.from("%PDF-saved"),
}));
const pack = {
  id: "pack1",
  manifest: {
    cv: "approved-cv",
    letter: "approved-letter",
    fileName: "Application.pdf",
  },
};
beforeEach(() => vi.clearAllMocks());
it("uses documents pinned to the successful package rather than a later failed preparation", async () => {
  vi.mocked(prisma.applicationArtifact.findFirst)
    .mockResolvedValueOnce(pack as never)
    .mockResolvedValueOnce({ id: "approved-cv" } as never);
  expect((await storedApplicationPdf("app1", "cv")).pdf.toString()).toBe(
    "%PDF-saved",
  );
  expect(prisma.applicationArtifact.findFirst).toHaveBeenLastCalledWith({
    where: { id: "approved-cv", applicationId: "app1", role: "cv" },
  });
});
it("downloads the package directly and rejects absent packages or missing linked documents", async () => {
  vi.mocked(prisma.applicationArtifact.findFirst).mockResolvedValueOnce(
    pack as never,
  );
  expect((await storedApplicationPdf("app1", "package")).fileName).toBe(
    "Application.pdf",
  );
  vi.mocked(prisma.applicationArtifact.findFirst).mockResolvedValueOnce(null);
  await expect(storedApplicationPdf("app1", "cv")).rejects.toThrow(
    "Prepare an application package",
  );
  vi.mocked(prisma.applicationArtifact.findFirst)
    .mockResolvedValueOnce(pack as never)
    .mockResolvedValueOnce(null);
  await expect(storedApplicationPdf("app1", "letter")).rejects.toThrow(
    "missing its generated document",
  );
});
