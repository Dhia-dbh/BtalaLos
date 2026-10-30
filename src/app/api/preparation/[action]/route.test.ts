import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

import { getSession } from "@/lib/auth/session";
import { loadDocumentMode, loadProject } from "@/lib/preparation/data";
import { EMPTY_PROJECT } from "@/lib/preparation/types";
import { checksum, workerOperation } from "@/lib/preparation/worker";
import { POST } from "./route";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/jobs/runner", () => ({ startJob: vi.fn(), cancelJob: vi.fn() }));
vi.mock("@/lib/preparation/service", () => ({ prepareApplicationJob: {}, queuePreparation: vi.fn(), latestPackage: vi.fn() }));
vi.mock("@/lib/preparation/data", () => ({ loadDocumentMode: vi.fn(), loadProject: vi.fn(), preparationLibrary: vi.fn() }));
vi.mock("@/lib/preparation/worker", async (original) => ({
  ...(await original<typeof import("@/lib/preparation/worker")>()),
  workerOperation: vi.fn(),
}));

const project = {
  ...EMPTY_PROJECT,
  repository: "/saved/project",
  cvPath: "sources/Base CV.tex",
  letterPath: "letter.tex",
  editablePaths: ["sources/Base CV.tex", "letter.tex"],
  baseRef: "saved-base",
  engine: "xelatex" as const,
  model: "fixture",
};
const bytes = Buffer.from("%PDF-1.7\nBase CV");
const result = {
  data: bytes.toString("base64"),
  checksum: checksum(bytes),
  pages: 2,
  commit: "a".repeat(40),
  log: "Compilation log",
  text: "Base CV",
};

const request = (input: unknown = {}, origin = "http://localhost:3000") => POST(
  new NextRequest("http://localhost:3000/api/preparation/base-resume", {
    method: "POST",
    headers: { origin, host: "localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(input),
  }),
  { params: Promise.resolve({ action: "base-resume" }) },
);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getSession).mockResolvedValue({ persistent: false, issuedAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
  vi.mocked(loadDocumentMode).mockResolvedValue("LATEX");
  vi.mocked(loadProject).mockResolvedValue(project);
  vi.mocked(workerOperation).mockResolvedValue(result);
});

it("compiles only the saved CV configuration and returns verified PDF bytes without application data", async () => {
  const response = await request();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    data: result.data, checksum: result.checksum, pages: 2, commit: result.commit, fileName: "Base CV.pdf",
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(workerOperation).toHaveBeenCalledWith(expect.any(String), {
    kind: "base-resume", repository: project.repository, baseRef: "saved-base", entrypoint: project.cvPath, engine: "xelatex",
  }, expect.any(AbortSignal));
  const firstKey = vi.mocked(workerOperation).mock.calls[0][0];
  expect((await request()).status).toBe(200);
  expect(vi.mocked(workerOperation).mock.calls[1][0]).not.toBe(firstKey);
});

it("rejects native mode, missing configuration, and client-supplied project overrides", async () => {
  vi.mocked(loadDocumentMode).mockResolvedValueOnce("NATIVE");
  expect((await request()).status).toBe(422);
  vi.mocked(loadProject).mockResolvedValueOnce(EMPTY_PROJECT);
  const missing = await request();
  expect(missing.status).toBe(422);
  expect(await missing.json()).toEqual({ error: "Configure your LaTeX project in Settings first." });
  expect((await request({ repository: "/unapproved/project" })).status).toBe(422);
  expect(workerOperation).not.toHaveBeenCalled();
});

it("returns worker failures and rejects corrupted PDF bytes", async () => {
  vi.mocked(workerOperation).mockRejectedValueOnce(new Error("Cannot reach the private application worker."));
  const offline = await request();
  expect(offline.status).toBe(422);
  expect(await offline.json()).toEqual({ error: "Cannot reach the private application worker." });
  vi.mocked(workerOperation).mockResolvedValueOnce({ ...result, checksum: "wrong" });
  const corrupted = await request();
  expect(corrupted.status).toBe(422);
  expect(await corrupted.json()).toEqual({ error: "Compiled PDF differs from its recorded checksum." });
});

it("requires a session and same-origin requests before reading project settings", async () => {
  expect((await request({}, "https://untrusted.example")).status).toBe(403);
  vi.mocked(getSession).mockResolvedValueOnce(null);
  expect((await request()).status).toBe(401);
  expect(loadProject).not.toHaveBeenCalled();
  expect(workerOperation).not.toHaveBeenCalled();
});
