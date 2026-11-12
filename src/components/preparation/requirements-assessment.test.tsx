import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { RequirementsAssessment } from "./requirements-assessment";
import { preparationRequest } from "./client";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./client", () => ({ preparationRequest: vi.fn() }));
it("distinguishes missing assessment from gaps and displays a saved assessment after running it", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ match: null })));
  vi.mocked(preparationRequest).mockResolvedValue({ match: { items: [{ requirement: "Rust", result: "gap", skill: null, experienceIds: [], note: "Not in your profile" }] } });
  render(<RequirementsAssessment applicationId="app1" />);
  expect(await screen.findByText("Not assessed. This does not indicate a gap.")).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: "Assess requirements" }));
  expect(preparationRequest).toHaveBeenCalledWith("match", { applicationId: "app1" });
  expect(await screen.findByText("gap")).toBeInTheDocument();
  expect(screen.getByText("Not in your profile")).toBeInTheDocument();
});
