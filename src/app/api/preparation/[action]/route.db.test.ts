import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createTestClient, resetDatabase } from "@/test/db";
import { getSession } from "@/lib/auth/session";
import { workerOperation } from "@/lib/preparation/worker";
import { EMPTY_PROJECT } from "@/lib/preparation/types";
import { saveBytes } from "@/lib/preparation/storage";
import { GET, POST } from "./route";

const db = createTestClient();
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return db;
  },
}));
vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/jobs/runner", () => ({
  defineJob: <T>(value: T) => value,
  startJob: vi.fn(async () => "job1"),
  cancelJob: vi.fn(),
}));
vi.mock("@/lib/preparation/worker", async (original) => ({
  ...(await original<typeof import("@/lib/preparation/worker")>()),
  workerOperation: vi.fn(async () => ({
    commit: "a".repeat(40),
    files: { "cv.tex": "CV", "letter.tex": "Letter" },
    pages: 1,
  })),
}));
let directory: string;
const project = {
  ...EMPTY_PROJECT,
  repository: "/allowed/repository",
  cvPath: "cv.tex",
  letterPath: "letter.tex",
  editablePaths: ["cv.tex", "letter.tex"],
  model: "fixture",
};
function request(
  action: string,
  input: unknown,
  origin = "http://localhost:3000",
) {
  return POST(
    new NextRequest(`http://localhost:3000/api/preparation/${action}`, {
      method: "POST",
      headers: {
        origin,
        host: "localhost:3000",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
    { params: Promise.resolve({ action }) },
  );
}
beforeEach(async () => {
  await resetDatabase(db);
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "dossier-preparation-route-"));
  vi.stubEnv("DOSSIER_DATA_DIR", directory);
  vi.stubEnv(
    "DOSSIER_PASSWORD",
    "argon2id:m=19456,t=2,p=1:wk-0a22NLDwpNVDMxLY9rw:x4bAXEh9EtlaTIqLiHwF_omyDOpcPtwPrV0_SJx_y2c",
  );
  vi.stubEnv("DOSSIER_SECRET", "test-secret-test-secret-test-secret");
  vi.mocked(getSession).mockResolvedValue({
    persistent: false,
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
});
afterAll(async () => {
  await db.$disconnect();
  vi.unstubAllEnvs();
});

it("requires an owner session and refuses cross-site mutations", async () => {
  expect(
    (await request("config", project, "https://untrusted.example")).status,
  ).toBe(403);
  vi.mocked(getSession).mockResolvedValueOnce(null);
  expect((await request("config", project)).status).toBe(401);
  expect(workerOperation).not.toHaveBeenCalled();
});
it("validates project paths through the worker and stores the selected CLI settings", async () => {
  expect((await request("config", project)).status).toBe(200);
  expect(workerOperation).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      kind: "inspect",
      repository: project.repository,
    }),
  );
  expect(
    JSON.parse(
      (await db.setting.findUniqueOrThrow({ where: { key: "latexProject" } }))
        .value,
    ),
  ).toEqual(project);
  expect(
    (await request("config", { ...project, editablePaths: [] })).status,
  ).toBe(422);
});
it("validates profile order, preserves versions, and blocks deletion of documents in use", async () => {
  const document = await db.supportingDocument.create({
    data: {
      name: "Diploma",
      versions: {
        create: { version: 1, path: "abc.pdf", checksum: "a", pages: 1 },
      },
    },
  });
  expect(
    (
      await request("profile", {
        name: "PhD",
        items: [{ role: "cv" }, { role: "cv" }],
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request("profile", {
        name: "PhD",
        items: [
          { role: "cv" },
          { role: "letter" },
          { role: "supporting", documentId: document.id },
        ],
      })
    ).status,
  ).toBe(200);
  const profile = await db.applicationProfile.findFirstOrThrow();
  expect((await request("delete-document", { id: document.id })).status).toBe(
    422,
  );
  expect(
    (
      await request("profile", {
        id: profile.id,
        version: 100,
        name: "PhD",
        items: [{ role: "cv" }, { role: "letter" }],
      })
    ).status,
  ).toBe(422);
  expect(
    (
      await request("profile", {
        id: profile.id,
        version: 1,
        name: "PhD",
        items: [{ role: "letter" }, { role: "cv" }],
      })
    ).status,
  ).toBe(200);
  expect((await request("delete-document", { id: document.id })).status).toBe(
    200,
  );
  expect(
    (
      await db.supportingDocument.findUniqueOrThrow({
        where: { id: document.id },
      })
    ).deletedAt,
  ).not.toBeNull();
  expect((await request("delete-profile", { id: profile.id })).status).toBe(
    200,
  );
});
it("saves the posting before queueing and retains a visible configuration failure", async () => {
  const profile = await db.applicationProfile.create({
    data: { name: "PhD", items: [{ role: "cv" }, { role: "letter" }] },
  });
  const result = await request("create", {
    posting: "Original posting data",
    profileId: profile.id,
    instructions: "",
  });
  expect(result.status).toBe(200);
  const { id } = await result.json();
  expect(
    (await db.application.findUniqueOrThrow({ where: { id } })).postingText,
  ).toBe("Original posting data");
  expect(
    (await db.preparationRun.findFirstOrThrow({ where: { applicationId: id } }))
      .status,
  ).toBe("FAILED");
});
it("returns sanitized progress, records metadata overrides, and supports explicit retry and cancellation", async () => {
  const profile = await db.applicationProfile.create({
    data: { name: "PhD", items: [{ role: "cv" }, { role: "letter" }] },
  });
  const application = await db.application.create({
    data: {
      documentMode: "LATEX",
      packageProfileId: profile.id,
      postingText: "Original data",
    },
  });
  expect(
    (
      await request("metadata", {
        applicationId: application.id,
        company: "Correct company",
        role: "Researcher",
        deadline: "2026-12-31",
        recruiterEmail: "",
        postingText: "Corrected posting",
      })
    ).status,
  ).toBe(200);
  const run = await db.preparationRun.create({
    data: {
      applicationId: application.id,
      kind: "prepare",
      status: "FAILED",
      snapshot: { items: [], private: "not returned" },
      steps: [
        {
          name: "Compile CV",
          status: "FAILED",
          attempts: [],
          result: { private: true },
        },
      ],
    },
  });
  const response = await GET(
    new NextRequest(
      `http://localhost:3000/api/preparation/application?applicationId=${application.id}`,
    ),
    { params: Promise.resolve({ action: "application" }) },
  );
  const data = await response.json();
  expect(data.preparations[0]).not.toHaveProperty("snapshot");
  expect(data.preparations[0].steps[0]).not.toHaveProperty("result");
  expect((await request("retry", { runId: run.id })).status).toBe(200);
  expect(
    (
      await request("metadata", {
        applicationId: application.id,
        company: "Changed",
        role: "Researcher",
        deadline: "",
        recruiterEmail: "",
        postingText: "data",
      })
    ).status,
  ).toBe(422);
  expect((await request("cancel", { runId: run.id })).status).toBe(200);
  expect(
    (await db.preparationRun.findUniqueOrThrow({ where: { id: run.id } }))
      .activeKey,
  ).toBeNull();
});
it("exports the verified merged package for the folder action and keeps the filename", async () => {
  const application = await db.application.create({
    data: { documentMode: "LATEX" },
  });
  const run = await db.preparationRun.create({
    data: {
      applicationId: application.id,
      kind: "prepare",
      status: "READY",
      snapshot: {},
    },
  });
  await db.applicationArtifact.create({
    data: {
      applicationId: application.id,
      runId: run.id,
      role: "package",
      version: 1,
      pages: 2,
      manifest: { fileName: "BenHamouda_Dhia.pdf" },
      ...(await saveBytes(Buffer.from("%PDF-example"))),
    },
  });
  expect(
    (await request("reveal", { applicationId: application.id })).status,
  ).toBe(200);
  expect(workerOperation).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      kind: "reveal",
      folder: `dossier-${application.id}`,
      fileName: "BenHamouda_Dhia.pdf",
    }),
  );
  await rm(directory, { recursive: true, force: true });
});
