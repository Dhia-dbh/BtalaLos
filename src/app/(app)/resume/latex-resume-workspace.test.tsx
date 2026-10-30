import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { BaseResumeResult } from "@/lib/preparation/types";
import { LatexResumeWorkspace } from "./latex-resume-workspace";

const project = { repository: "/project", baseRef: "main", cvPath: "sources/cv.tex", engine: "pdflatex" as const };
const result: BaseResumeResult = {
  data: btoa("%PDF-1.7\nBase CV"),
  checksum: "checksum",
  pages: 2,
  commit: "a".repeat(40),
  fileName: "cv.pdf",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(result)));
  let count = 0;
  URL.createObjectURL = vi.fn(() => `blob:cv-${++count}`);
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

it("builds on opening and downloads the exact PDF used by the preview", async () => {
  const { unmount } = render(<LatexResumeWorkspace project={project} />);
  expect(screen.getByRole("status")).toHaveTextContent("Compiling CV…");
  expect(screen.getByRole("button", { name: "Rebuild" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  const download = await screen.findByRole("link", { name: "Download PDF" });
  expect(fetch).toHaveBeenCalledWith("/api/preparation/base-resume", expect.objectContaining({
    method: "POST", body: "{}", signal: expect.any(AbortSignal),
  }));
  expect(screen.getByTitle("Base resume PDF")).toHaveAttribute("src", "blob:cv-1");
  expect(download).toHaveAttribute("href", "blob:cv-1");
  expect(download).toHaveAttribute("download", "cv.pdf");
  expect(screen.getByText("sources/cv.tex · main · 2 pages")).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Themes" })).not.toBeInTheDocument();
  const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
  expect(blob.type).toBe("application/pdf");
  const text = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });
  expect(text).toBe(atob(result.data));
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cv-1");
});

it("clears an old preview during rebuilding and offers an explicit retry after failure", async () => {
  render(<LatexResumeWorkspace project={project} />);
  await screen.findByRole("link", { name: "Download PDF" });
  let rejectBuild!: (error: Error) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectBuild = reject; }));
  await userEvent.click(screen.getByRole("button", { name: "Rebuild" }));
  expect(screen.queryByTitle("Base resume PDF")).not.toBeInTheDocument();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cv-1");
  expect(screen.getByRole("button", { name: "Rebuild" })).toBeDisabled();
  await act(async () => rejectBuild(new Error("Worker unavailable.")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Worker unavailable.");
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByRole("link", { name: "Download PDF" });
  expect(screen.getByTitle("Base resume PDF")).toHaveAttribute("src", "blob:cv-2");
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("shows server errors without retrying automatically", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "latexmk failed." }, { status: 422 }));
  render(<LatexResumeWorkspace project={project} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("latexmk failed.");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("points an unconfigured project to Settings without starting compilation", () => {
  render(<LatexResumeWorkspace project={{ ...project, repository: "", cvPath: "" }} />);
  expect(screen.getByRole("note")).toHaveTextContent("Configure your LaTeX project");
  expect(screen.getByRole("link", { name: "Project settings" })).toHaveAttribute("href", "/settings?section=latex");
  expect(screen.getByRole("button", { name: "Rebuild" })).toBeDisabled();
  expect(fetch).not.toHaveBeenCalled();
});

it("aborts a pending request and ignores its result after leaving the page", async () => {
  let finishBuild!: (response: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((resolve) => { finishBuild = resolve; }));
  const { unmount } = render(<LatexResumeWorkspace project={project} />);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const signal = vi.mocked(fetch).mock.calls[0][1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  await act(async () => finishBuild(Response.json(result)));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
