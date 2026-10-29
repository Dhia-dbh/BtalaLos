import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PreparationLibrary } from "./library";
import { NewLatex } from "./new-latex";
import { preparationRequest } from "./client";
import { EMPTY_PROJECT } from "@/lib/preparation/types";
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("./client", () => ({
  preparationRequest: vi.fn(async () => ({ id: "app1" })),
}));
vi.mock("@/components/toast", () => ({ toast: vi.fn() }));
const initial = {
  project: EMPTY_PROJECT,
  profiles: [
    {
      id: "phd",
      name: "PhD",
      version: 1,
      items: [{ role: "cv" }, { role: "letter" }],
    },
  ],
  documents: [
    {
      id: "diploma",
      name: "Diploma",
      versions: [{ id: "v1", version: 1, pages: 2 }],
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(initial)),
  );
});
it("edits an ordered profile without altering its documents", async () => {
  const user = userEvent.setup();
  render(<PreparationLibrary initial={initial} />);
  await user.selectOptions(screen.getByLabelText("Edit a profile"), "phd");
  await user.click(screen.getByRole("button", { name: "Add document" }));
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Document 3" }),
    "diploma",
  );
  await user.click(screen.getByRole("button", { name: "Move document 3 up" }));
  await user.click(screen.getByRole("button", { name: "Save profile" }));
  expect(preparationRequest).toHaveBeenCalledWith("profile", {
    id: "phd",
    name: "PhD",
    version: 1,
    items: [
      { role: "cv" },
      { role: "supporting", documentId: "diploma" },
      { role: "letter" },
    ],
  });
});
it("requires a profile before starting automatic LaTeX preparation and preserves the posting", async () => {
  const user = userEvent.setup();
  render(
    <NewLatex
      profiles={initial.profiles}
      initialPosting="Researcher at Example"
    />,
  );
  await user.selectOptions(screen.getByLabelText("Application profile"), "phd");
  await user.type(
    screen.getByLabelText("Tailoring instructions (optional)"),
    "Emphasize Python",
  );
  await user.click(screen.getByRole("button", { name: "Prepare application" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/applications/app1"));
  expect(preparationRequest).toHaveBeenCalledWith(
    "create",
    expect.objectContaining({
      posting: "Researcher at Example",
      profileId: "phd",
      instructions: "Emphasize Python",
    }),
  );
});
it("keeps native document mode accessible without creating an application", async () => {
  const user = userEvent.setup();
  render(<NewLatex profiles={initial.profiles} />);
  await user.selectOptions(screen.getByLabelText("Document mode"), "NATIVE");
  expect(push).toHaveBeenCalledWith("/new");
  expect(preparationRequest).not.toHaveBeenCalled();
});
it("loads CLI models and limits effort choices to the selected model", async () => {
  const user = userEvent.setup();
  vi.mocked(preparationRequest).mockResolvedValueOnce({
    models: [
      {
        id: "test-model",
        display_name: "Test model",
        reasoning_efforts: ["medium"],
      },
    ],
  });
  render(<PreparationLibrary initial={initial} />);
  await user.click(
    screen.getByRole("button", { name: "Test CLI and load models" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Model").tagName).toBe("SELECT"),
  );
  await user.selectOptions(screen.getByLabelText("Model"), "test-model");
  expect(screen.getByLabelText("Thinking effort").children).toHaveLength(1);
});
