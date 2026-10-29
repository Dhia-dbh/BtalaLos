import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { PreparationLibrary } from "./library";
import { ProjectSettings } from "./project-settings";
import { NewLatex } from "./new-latex";
import { preparationRequest } from "./client";
import { EMPTY_PROJECT } from "@/lib/preparation/types";
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
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
      configured
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
  render(<NewLatex configured profiles={initial.profiles} />);
  await user.selectOptions(screen.getByLabelText("Document mode"), "NATIVE");
  expect(push).toHaveBeenCalledWith("/new?mode=NATIVE");
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
  render(<ProjectSettings initial={initial} initialMode="NATIVE" />);
  await user.click(
    screen.getByRole("button", { name: "Test CLI and load models" }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("Model").tagName).toBe("SELECT"),
  );
  await user.selectOptions(screen.getByLabelText("Model"), "test-model");
  expect(screen.getByLabelText("Thinking effort").children).toHaveLength(1);
});

it("persists LaTeX as the default document mode", async () => {
  const user = userEvent.setup();
  render(<ProjectSettings initial={initial} initialMode="NATIVE" />);
  await user.selectOptions(
    screen.getByLabelText("Default document mode"),
    "LATEX",
  );
  await waitFor(() =>
    expect(preparationRequest).toHaveBeenCalledWith("document-mode", {
      documentMode: "LATEX",
    }),
  );
});
it("directs an unconfigured LaTeX application to settings before it can start", () => {
  render(<NewLatex configured={false} profiles={initial.profiles} />);
  expect(
    screen.getByRole("button", { name: "Prepare application" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("link", { name: "Configure LaTeX project" }),
  ).toHaveAttribute("href", "/settings?section=latex");
});

it("browses another repository and populates the TeX selectors", async () => {
  const user = userEvent.setup();
  vi.mocked(preparationRequest).mockImplementation(async (action) => {
    if (action === "directories")
      return {
        directory: "/another/project",
        parent: "/another",
        isRepository: true,
        folders: [],
      };
    if (action === "repository")
      return {
        repository: "/another/project",
        files: ["cv.tex", "letter.tex", "sections/skills.tex"],
      };
    return { ok: true };
  });
  render(<ProjectSettings initial={initial} initialMode="LATEX" />);
  await user.click(screen.getByRole("button", { name: "Browse repositories" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Folder path")).toHaveValue(
      "/another/project",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Use this repository" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Git repository")).toHaveValue(
      "/another/project",
    ),
  );
  await user.selectOptions(
    screen.getByLabelText("CV entrypoint (.tex)"),
    "cv.tex",
  );
  await user.selectOptions(
    screen.getByLabelText("Cover-letter entrypoint (.tex)"),
    "letter.tex",
  );
  await user.selectOptions(screen.getByLabelText("Editable source files"), [
    "cv.tex",
    "letter.tex",
    "sections/skills.tex",
  ]);
  await user.click(
    screen.getByRole("button", { name: "Validate and save project" }),
  );
  expect(preparationRequest).toHaveBeenLastCalledWith(
    "config",
    expect.objectContaining({
      repository: "/another/project",
      cvPath: "cv.tex",
      letterPath: "letter.tex",
      editablePaths: ["cv.tex", "letter.tex", "sections/skills.tex"],
    }),
  );
});
