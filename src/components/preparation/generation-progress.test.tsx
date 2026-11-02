import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { GenerationProgress } from "./generation-progress";

it("shows accessible stage progress and keeps usage details collapsed", () => {
  render(<GenerationProgress active={false} segments={[{ label: "Merge PDFs", status: "DONE" }, { label: "Draft email", status: "SKIPPED" }]} traces={[{ id: "trace", type: "prepare-application", stages: [{ name: "Analyze posting", status: "DONE", startedAt: "2026-11-02T00:00:00Z", finishedAt: "2026-11-02T00:00:02Z", calls: [{ provider: "codex", model: "fixture", effort: "high", usage: { input: 40, output: 10 }, startedAt: "2026-11-02T00:00:00Z", finishedAt: "2026-11-02T00:00:02Z" }] }] }]} />);
  expect(screen.getByTitle("Merge PDFs: done")).toHaveClass("bg-success");
  expect(screen.getByTitle("Merge PDFs: done")).not.toHaveClass("bg-track");
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
  expect(screen.getByText("Tokens: 40 input / 10 output")).toBeInTheDocument();
  expect(screen.getByText("Processing time: 2.0s")).toBeInTheDocument();
  expect(screen.getByText("Effort: high")).toBeInTheDocument();
  expect(screen.getByText("Generation usage details").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Skipped: Draft email")).toBeInTheDocument();
});
