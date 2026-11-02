import type { GenerationStage } from "./generation-telemetry";
import type { Step } from "./preparation/types";

export type Trace = { id: string; type: string; stages: GenerationStage[] };
export type Segment = { label: string; status: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "CANCELLED" | "SKIPPED" };
export function stageGroup(name: string): string {
  if (/context/i.test(name)) return "Read context";
  if (/posting|requirements|profile/i.test(name)) return "Analyze posting";
  if (/worktree/i.test(name)) return "Create workspace";
  if (/tailor|writing your cover|shorten/i.test(name)) return "Tailor documents";
  if (/compile|render native/i.test(name)) return "Render PDFs";
  if (/validate/i.test(name)) return "Validate PDFs";
  if (/merge/i.test(name)) return "Merge PDFs";
  if (/export/i.test(name)) return "Export files";
  if (/email/i.test(name)) return "Draft email";
  return name;
}
export function progressSegments(mode: string, kind: string, status: string, steps: Step[]): Segment[] {
  const labels = kind === "email" ? ["Draft email"] : kind === "bundle" ? ["Merge PDFs", "Export files"] : mode === "LATEX"
    ? ["Read context", "Analyze posting", "Create workspace", "Tailor documents", "Render PDFs", "Validate PDFs", "Merge PDFs", "Export files", "Draft email"]
    : ["Render PDFs", "Merge PDFs", "Export files", "Draft email"];
  return labels.map((label) => {
    const group = steps.filter((step) => stageGroup(step.name) === label);
    let state: Segment["status"] = "PENDING";
    if (group.some((step) => step.status === "RUNNING")) state = status === "CANCELLED" ? "CANCELLED" : status === "FAILED" ? "FAILED" : "RUNNING";
    else if (group.some((step) => step.status === "FAILED")) state = status === "CANCELLED" ? "CANCELLED" : "FAILED";
    else if (group.length) state = "DONE";
    else if (status === "READY") state = "SKIPPED";
    return { label, status: state };
  });
}
export function generationTotals(traces: Trace[], now: number) {
  const stages = traces.flatMap((trace) => trace.stages);
  const calls = stages.flatMap((stage) => stage.calls);
  const reported = calls.filter((call) => call.usage !== null);
  const latest = calls.at(-1);
  return {
    input: reported.reduce((sum, call) => sum + call.usage!.input, 0),
    output: reported.reduce((sum, call) => sum + call.usage!.output, 0),
    coverage: !calls.length || !reported.length ? "unavailable" : reported.length === calls.length ? "reported" : "partial",
    duration: stages.reduce((sum, stage) => sum + Math.max(0, (stage.finishedAt ? Date.parse(stage.finishedAt) : stage.status === "RUNNING" ? now : Date.parse(stage.startedAt)) - Date.parse(stage.startedAt)), 0),
    latest,
  };
}
