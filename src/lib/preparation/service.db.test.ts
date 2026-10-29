import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createTestClient, resetDatabase } from "@/test/db";
import { createWorker } from "../../../scripts/application-worker.mjs";
import { command } from "../../../scripts/application-worker/tools.mjs";
import { bundleSchema } from "./types";
import { checksum } from "./worker";
import { saveBytes, verifiedBytes } from "./storage";
import {
  latestPackage,
  queuePreparation,
  recoverPreparations,
} from "./service";
import { buildExport } from "@/lib/data-export";
import { importExport, parseExport } from "@/lib/data-import";
import { buildArchive, readArchive, restoreArchiveFiles } from "./archive";
import { storedApplicationPdf } from "./pdfs";

const db = createTestClient();
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
vi.mock("@/lib/pdf/render", () => ({ renderPdf: vi.fn(async () => basePdf) }));
vi.mock("@/lib/ai", () => ({
  getAiProvider: async () => ({
    complete: async () => ({
      contactName: null,
      contactEmail: "hr@example.org",
      greeting: "Dear hiring team,",
      paragraphs: ["Please find my application package attached."],
      signOff: "Kind regards,",
      subject: "Application",
      body: "Please find my application package attached.",
    }),
  }),
}));
let root: string, repo: string, basePdf: Buffer;
let worker: Awaited<ReturnType<typeof createWorker>>;
const tex =
  "\\documentclass{article}\n\\usepackage{hyperref}\n\\begin{document}Verified Python experience \\href{https://example.org}{Example}\\end{document}\n";
const posting =
  "Researcher at Example. Python required. Apply by 2026-12-31 to hr@example.org.";

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "dossier-preparation-db-"));
  repo = path.join(root, "repository");
  vi.stubEnv("DOSSIER_DATA_DIR", path.join(root, "appdata"));
  vi.stubEnv(
    "DOSSIER_PASSWORD",
    "argon2id:m=19456,t=2,p=1:wk-0a22NLDwpNVDMxLY9rw:x4bAXEh9EtlaTIqLiHwF_omyDOpcPtwPrV0_SJx_y2c",
  );
  vi.stubEnv("DOSSIER_SECRET", "test-secret-test-secret-test-secret");
  process.env.DOSSIER_WORKER_TOKEN = "test".repeat(12);
  await command("git", ["init", repo]);
  await writeFile(path.join(repo, "cv.tex"), tex);
  await writeFile(path.join(repo, "letter.tex"), tex);
  await command("git", ["-C", repo, "add", "."]);
  await command("git", [
    "-C",
    repo,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.org",
    "commit",
    "-m",
    "Base",
  ]);
  await command(
    "pdflatex",
    ["-interaction=nonstopmode", "-halt-on-error", "cv.tex"],
    { cwd: repo },
  );
  basePdf = await readFile(path.join(repo, "cv.pdf"));
  const agent = path.resolve("scripts/application-worker/fixtures/agent.mjs");
  worker = await createWorker({
    repository: repo,
    data: path.join(root, "worker"),
    exports: path.join(root, "exports"),
    token: process.env.DOSSIER_WORKER_TOKEN,
    codex: agent,
    claude: agent,
  });
  await new Promise<void>((resolve) =>
    worker.server.listen(0, "127.0.0.1", resolve),
  );
  const address = worker.server.address();
  if (!address || typeof address === "string")
    throw new Error("No worker address");
  process.env.DOSSIER_WORKER_URL = `http://127.0.0.1:${address.port}`;
}, 20_000);
beforeEach(async () => {
  await resetDatabase(db);
  await db.setting.create({
    data: {
      key: "latexProject",
      value: JSON.stringify({
        repository: repo,
        baseRef: "HEAD",
        cvPath: "cv.tex",
        letterPath: "letter.tex",
        editablePaths: ["cv.tex", "letter.tex"],
        provider: "codex",
        model: "fixture",
        effort: "medium",
        engine: "pdflatex",
        contextDocumentIds: [],
        fileName: "BenHamouda_Dhia.pdf",
      }),
    },
  });
});
afterAll(async () => {
  await worker?.close();
  await db.$disconnect();
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
async function createApplication(mode: "LATEX" | "NATIVE" = "LATEX") {
  const document = await db.supportingDocument.create({
    data: {
      name: "Diploma",
      versions: {
        create: { version: 1, ...(await saveBytes(basePdf)), pages: 1 },
      },
    },
  });
  const profile = await db.applicationProfile.create({
    data: {
      name: "PhD",
      items: bundleSchema.parse([
        { role: "supporting", documentId: document.id },
        { role: "letter" },
        { role: "cv" },
      ]),
    },
  });
  const application = await db.application.create({
    data: {
      documentMode: mode,
      packageProfileId: profile.id,
      postingText: posting,
      documents:
        mode === "NATIVE"
          ? {
              create: [
                {
                  kind: "RESUME",
                  units: [{ id: "summary", label: "Summary", text: "Python" }],
                },
                {
                  kind: "COVER_LETTER",
                  units: [
                    {
                      id: "paragraph:1",
                      label: "Letter",
                      text: "Verified facts",
                    },
                  ],
                },
              ],
            }
          : undefined,
    },
  });
  return { application, document, profile };
}
async function finished(id: string) {
  await vi.waitFor(
    async () => {
      const run = await db.preparationRun.findUniqueOrThrow({ where: { id } });
      expect(["READY", "FAILED", "CANCELLED"]).toContain(run.status);
    },
    { timeout: 40_000, interval: 200 },
  );
  return db.preparationRun.findUniqueOrThrow({ where: { id } });
}

describe("application preparation integration", () => {
  it("prepares isolated one-page LaTeX documents, ordered PDFs, source diffs and an unsent email", async () => {
    const { application } = await createApplication();
    const run = await finished(await queuePreparation(application.id));
    expect(run.error).toBeNull();
    expect(run.status).toBe("READY");
    const pack = await latestPackage(application.id);
    expect(pack?.pages).toBe(3);
    expect(
      (await storedApplicationPdf(application.id, "cv")).pdf
        .subarray(0, 5)
        .toString(),
    ).toBe("%PDF-");
    expect(
      (pack?.manifest as { items: { role: string }[] }).items.map(
        (item) => item.role,
      ),
    ).toEqual(["supporting", "letter", "cv"]);
    expect(await readFile(path.join(repo, "cv.tex"), "utf8")).toBe(tex);
    expect(
      await db.applicationArtifact.count({
        where: { applicationId: application.id, role: "diff" },
      }),
    ).toBe(1);
    const saved = await db.application.findUniqueOrThrow({
      where: { id: application.id },
      include: { documents: true },
    });
    expect(saved.status).toBe("DRAFT");
    expect(saved.deadline?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    expect(saved.documents.find((doc) => doc.kind === "EMAIL")?.units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "to", text: "hr@example.org" }),
      ]),
    );
  }, 50_000);
  it("shortens overflow, preserves manual metadata, and regenerates only the merge with updated supporting PDFs", async () => {
    const { application, document } = await createApplication();
    await db.application.update({
      where: { id: application.id },
      data: { extracted: { manualMetadata: { company: "Manual company" } } },
    });
    const first = await finished(
      await queuePreparation(application.id, "prepare", "FORCE_OVERFLOW"),
    );
    expect(first.status, first.error ?? "").toBe("READY");
    expect(
      (first.steps as { name: string }[]).some(
        (step) => step.name === "Shorten: round 1: generate",
      ),
    ).toBe(true);
    const original = await latestPackage(application.id);
    await db.supportingDocumentVersion.create({
      data: {
        documentId: document.id,
        version: 2,
        ...(await saveBytes(basePdf)),
        pages: 1,
      },
    });
    const merged = await finished(
      await queuePreparation(application.id, "bundle"),
    );
    expect(merged.status, merged.error ?? "").toBe("READY");
    expect(
      (merged.steps as { name: string }[]).map((step) => step.name),
    ).toEqual(["Merge application PDF", "Export application folder"]);
    const pack = await latestPackage(application.id);
    expect(pack?.version).toBe(2);
    expect((pack?.manifest as { cv: string }).cv).toBe(
      (original?.manifest as { cv: string }).cv,
    );
    expect(
      (pack?.manifest as { items: { version?: number }[] }).items[0].version,
    ).toBe(2);
    expect(checksum(await verifiedBytes(original!))).toBe(original!.checksum);
    expect(
      (
        await db.application.findUniqueOrThrow({
          where: { id: application.id },
        })
      ).company,
    ).toBe("Manual company");
  }, 50_000);
  it("stops after two unsuccessful shortening rounds without publishing a package or email", async () => {
    const { application } = await createApplication();
    const run = await finished(
      await queuePreparation(
        application.id,
        "prepare",
        "FORCE_OVERFLOW NEVER_FIT",
      ),
    );
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("two shortening rounds");
    expect(await latestPackage(application.id)).toBeNull();
    expect(
      await db.document.count({
        where: { applicationId: application.id, kind: "EMAIL" },
      }),
    ).toBe(0);
  }, 50_000);
  it("packages native documents and restores all durable records and exact artifact bytes from an archive", async () => {
    const { application } = await createApplication("NATIVE");
    const run = await finished(await queuePreparation(application.id));
    expect(run.status, run.error ?? "").toBe("READY");
    const pack = (await latestPackage(application.id))!;
    const exported = await buildExport(db);
    const archive = readArchive(await buildArchive(exported));
    const parsed = parseExport(archive.text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.error);
    await restoreArchiveFiles(parsed.data, archive.files);
    await importExport(db, parsed.data);
    expect((await latestPackage(application.id))?.checksum).toBe(pack.checksum);
    expect(checksum(await verifiedBytes(pack))).toBe(pack.checksum);
    expect(await db.applicationProfile.count()).toBe(1);
    const receipt = await db.preparationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(receipt.activeKey).toBeNull();
    expect(receipt.jobId).toBeNull();
  }, 50_000);
  it("marks interrupted preparations as failed while keeping their completed step history", async () => {
    const { application } = await createApplication();
    const run = await db.preparationRun.create({
      data: {
        applicationId: application.id,
        kind: "prepare",
        status: "RUNNING",
        activeKey: application.id,
        snapshot: {},
        steps: [{ name: "Completed", status: "DONE", attempts: [] }],
      },
    });
    await recoverPreparations();
    const recovered = await db.preparationRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(recovered.status).toBe("FAILED");
    expect(recovered.activeKey).toBeNull();
    expect(recovered.steps).toEqual(run.steps);
  });
});
