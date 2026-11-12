import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { loadDocumentMode, loadProject } from "@/lib/preparation/data";
import { EMPTY_PROJECT } from "@/lib/preparation/types";
import { demoProfile } from "@/lib/demo-profile";
import { loadProfile } from "@/lib/profile-data";
import { settingsFromRows } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { loadThemes, loadThemeUsage } from "@/lib/theme-data";
import { BUILT_IN_THEMES } from "@/lib/themes";

import BaseResumePage from "./page";
import { LatexResumeWorkspace } from "./latex-resume-workspace";
import { ResumeWorkspace } from "./resume-workspace";

vi.mock("@/lib/preparation/data", () => ({ loadDocumentMode: vi.fn(), loadProject: vi.fn() }));
vi.mock("@/lib/profile-data", () => ({ loadProfile: vi.fn() }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: vi.fn() }));
vi.mock("@/lib/theme-data", () => ({ loadThemes: vi.fn(), loadThemeUsage: vi.fn() }));
vi.mock("./resume-workspace", () => ({ ResumeWorkspace: vi.fn(() => <p>Profile resume</p>) }));
vi.mock("./latex-resume-workspace", () => ({ LatexResumeWorkspace: vi.fn(() => <p>LaTeX resume</p>) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadDocumentMode).mockResolvedValue("NATIVE");
  vi.mocked(loadProject).mockResolvedValue({ ...EMPTY_PROJECT, repository: "/project", cvPath: "cv.tex" });
  vi.mocked(loadProfile).mockResolvedValue(demoProfile());
  vi.mocked(loadThemes).mockResolvedValue(BUILT_IN_THEMES);
  vi.mocked(loadThemeUsage).mockResolvedValue({});
  vi.mocked(loadSettings).mockResolvedValue(settingsFromRows([]));
});

it("keeps the profile preview and its settings in Btalalos mode", async () => {
  render(await BaseResumePage());
  expect(screen.getByText("Profile resume")).toBeInTheDocument();
  expect(ResumeWorkspace).toHaveBeenCalledWith(expect.objectContaining({
    profile: demoProfile(),
    paper: "A4",
    language: null,
  }), undefined);
  expect(loadProject).not.toHaveBeenCalled();
});

it("loads only the configured project in LaTeX mode", async () => {
  vi.mocked(loadDocumentMode).mockResolvedValue("LATEX");
  render(await BaseResumePage());
  expect(screen.getByText("LaTeX resume")).toBeInTheDocument();
  expect(LatexResumeWorkspace).toHaveBeenCalledWith(expect.objectContaining({
    project: { repository: "/project", cvPath: "cv.tex", baseRef: "master", engine: "pdflatex" },
  }), undefined);
  expect(loadProfile).not.toHaveBeenCalled();
  expect(loadThemes).not.toHaveBeenCalled();
  expect(loadSettings).not.toHaveBeenCalled();
  expect(loadThemeUsage).not.toHaveBeenCalled();
});

it("follows the saved mode when the page is opened again", async () => {
  const first = render(await BaseResumePage());
  expect(screen.getByText("Profile resume")).toBeInTheDocument();
  first.unmount();
  vi.mocked(loadDocumentMode).mockResolvedValue("LATEX");
  const second = render(await BaseResumePage());
  expect(screen.getByText("LaTeX resume")).toBeInTheDocument();
  second.unmount();
  vi.mocked(loadDocumentMode).mockResolvedValue("NATIVE");
  render(await BaseResumePage());
  expect(screen.getByText("Profile resume")).toBeInTheDocument();
});
