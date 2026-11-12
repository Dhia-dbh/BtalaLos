import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Overview } from "./overview";
import { preparationRequest } from "./client";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./client", () => ({ preparationRequest: vi.fn() }));
it("reloads the assessment after saving changed requirements", async () => {
  const record = { documentMode: "LATEX", preparations: [], extracted: { requirements: ["Python"] }, match: { items: [{ requirement: "Python", result: "covered", skill: "Python", experienceIds: [], note: "Profile evidence" }] } as unknown };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(record)));
  vi.mocked(preparationRequest).mockImplementation(async () => {
    record.extracted.requirements = ["Rust"];
    record.match = null;
    return { ok: true };
  });
  const user = userEvent.setup();
  render(<Overview applicationId="app1" />);
  await screen.findByText("covered");
  await user.click(screen.getByRole("button", { name: "Edit details" }));
  await user.clear(screen.getByLabelText("requirements 1"));
  await user.type(screen.getByLabelText("requirements 1"), "Rust");
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  expect(await screen.findByText("Not assessed. This does not indicate a gap.")).toBeInTheDocument();
  expect(screen.queryByText("covered")).not.toBeInTheDocument();
});
