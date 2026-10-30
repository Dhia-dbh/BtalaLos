import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PreparationPanel } from "./panel";
import { preparationRequest } from "./client";
import { emailUnits } from "@/lib/application-email";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/browser/runs", () => ({ BrowserRuns: () => null }));
vi.mock("./client", () => ({ preparationRequest: vi.fn(async () => ({})) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/google/actions", () => ({ sendWithGmail: vi.fn() }));
const view = {
  id: "app1",
  cli: { provider: "codex", model: "fixture", effort: "medium" },
  documentMode: "LATEX",
  company: "Example",
  role: "Researcher",
  deadline: null,
  postingText: "Example posting",
  extracted: { keywords: ["Python"] },
  packageProfileId: "phd",
  emailThreadId: null,
  profiles: [{ id: "phd", name: "PhD" }],
  preparations: [
    {
      id: "run1",
      status: "READY",
      error: null,
      createdAt: "2026-10-29T00:00:00Z",
      steps: [
        {
          name: "Compile CV",
          status: "DONE",
          attempts: [
            {
              startedAt: "2026-10-29T00:00:00Z",
              finishedAt: "2026-10-29T00:00:02Z",
            },
          ],
        },
      ],
    },
  ],
  artifacts: [
    {
      id: "pack1",
      role: "package",
      version: 1,
      pages: 3,
      fileName: "BenHamouda_Dhia.pdf",
    },
  ],
  documents: [
    {
      units: emailUnits({
        to: "hr@example.org",
        subject: "Application",
        body: "Please find my package attached.",
      }),
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(view)),
  );
});
it("shows package readiness, durable downloads, source review and copy buttons without marking the application sent", async () => {
  render(<PreparationPanel applicationId="app1" latex />);
  await screen.findByRole("heading", { name: "Application package ready" });
  expect(
    screen.getByRole("link", { name: "Download BenHamouda_Dhia.pdf" }),
  ).toHaveAttribute("href", "/api/artifacts/pack1");
  expect(screen.getByTitle("package preview")).toHaveAttribute(
    "src",
    "/api/artifacts/pack1?inline=1",
  );
  expect(
    screen.getByRole("button", { name: "Copy the recipient" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Copy the subject" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Copy message" }),
  ).toBeInTheDocument();
  expect(preparationRequest).not.toHaveBeenCalled();
});
it("requests merge-only regeneration separately from AI document preparation", async () => {
  const user = userEvent.setup();
  render(<PreparationPanel applicationId="app1" />);
  await user.click(
    await screen.findByRole("button", { name: "Regenerate merged PDF" }),
  );
  await waitFor(() =>
    expect(preparationRequest).toHaveBeenCalledWith("bundle", {
      applicationId: "app1",
      profileId: "phd",
    }),
  );
});
it("shows portal instructions and a continuation link without an email composer", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    ...view,
    documents: [],
    extracted: {
      applicationMethod: "Online portal",
      applicationUrl: "https://careers.example.org/apply/42",
      applicationInstructions: "Apply here to submit your documents.",
      warnings: ["The extracted recruiter email was not present in the posting and was discarded."],
    },
  })));
  render(<PreparationPanel applicationId="app1" latex />);
  const link = await screen.findByRole("link", { name: "Continue application" });
  expect(link).toHaveAttribute("href", "https://careers.example.org/apply/42");
  expect(screen.getByText("Apply here to submit your documents.")).toBeInTheDocument();
  expect(screen.getByText(/email was not present/)).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Application email" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Download BenHamouda_Dhia.pdf" })).toBeInTheDocument();
});
it("records explicit email edits without sending", async () => {
  const user = userEvent.setup();
  render(<PreparationPanel applicationId="app1" latex />);
  await user.click(await screen.findByRole("button", { name: "Edit email" }));
  await user.clear(screen.getByLabelText("Subject"));
  await user.type(screen.getByLabelText("Subject"), "Revised subject");
  await user.click(screen.getByRole("button", { name: "Save email" }));
  await waitFor(() =>
    expect(preparationRequest).toHaveBeenCalledWith(
      "email",
      expect.objectContaining({
        applicationId: "app1",
        subject: "Revised subject",
      }),
    ),
  );
});
it("shows a failed step and offers explicit retry while preserving the previous package", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ...view,
        preparations: [
          {
            ...view.preparations[0],
            status: "FAILED",
            error: "Compiler failed",
            steps: [],
          },
        ],
      }),
    ),
  );
  const user = userEvent.setup();
  render(<PreparationPanel applicationId="app1" latex />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Compiler failed");
  expect(
    screen.getByRole("link", { name: "Download BenHamouda_Dhia.pdf" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry failed step" }));
  expect(preparationRequest).toHaveBeenCalledWith("retry", { runId: "run1" });
});
