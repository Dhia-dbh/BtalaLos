import { describe, expect, it } from "vitest";
import { generationTotals, progressSegments } from "./generation-progress";
import { withGenerationTelemetry, recordGenerationCall, type GenerationCall } from "./generation-telemetry";
import { MockProvider } from "./ai/providers/mock";
import { z } from "zod";

const call: GenerationCall = { provider: "codex", model: "fixture", effort: "medium", usage: { input: 10, output: 5 }, startedAt: "2026-11-02T00:00:00Z", finishedAt: "2026-11-02T00:00:01Z" };
describe("generation progress", () => {
  it("keeps the plan stable and explicitly resolves omitted email stages", () => {
    const segments = progressSegments("NATIVE", "prepare", "READY", [{ name: "Render native CV", status: "DONE", attempts: [] }, { name: "Render native letter", status: "DONE", attempts: [] }, { name: "Merge application PDF", status: "DONE", attempts: [] }, { name: "Export application folder", status: "DONE", attempts: [] }]);
    expect(segments.map((segment) => segment.status)).toEqual(["DONE", "DONE", "DONE", "SKIPPED"]);
    expect(progressSegments("LATEX", "bundle", "QUEUED", [])).toHaveLength(2);
  });
  it("distinguishes cancellation from an active or failed step", () => {
    const steps = [{ name: "Compile cv: round 0", status: "RUNNING" as const, attempts: [] }];
    expect(progressSegments("LATEX", "prepare", "CANCELLED", steps).find((segment) => segment.label === "Render PDFs")?.status).toBe("CANCELLED");
  });
  it("includes failed attempts and labels incomplete token coverage", () => {
    const totals = generationTotals([{ id: "trace", type: "prepare-application", stages: [{ name: "Generate", status: "FAILED", startedAt: call.startedAt, finishedAt: call.finishedAt, calls: [call, { ...call, usage: null }] }] }], Date.now());
    expect(totals).toMatchObject({ input: 10, output: 5, coverage: "partial", duration: 1000 });
    expect(generationTotals([], Date.now()).coverage).toBe("unavailable");
  });
  it("isolates concurrent telemetry scopes", async () => {
    const first: GenerationCall[] = [], second: GenerationCall[] = [];
    await Promise.all([
      withGenerationTelemetry(async (value) => { first.push(value); }, async () => { await Promise.resolve(); await recordGenerationCall(call); }),
      withGenerationTelemetry(async (value) => { second.push(value); }, async () => { await recordGenerationCall({ ...call, model: "other" }); }),
    ]);
    expect(first.map((value) => value.model)).toEqual(["fixture"]);
    expect(second.map((value) => value.model)).toEqual(["other"]);
  });
  it("records both JSON validation attempts, without inventing usage", async () => {
    const calls: GenerationCall[] = [];
    let attempt = 0;
    const provider = new MockProvider({ reply: () => ++attempt === 1 ? { value: false } : { value: "valid" } });
    await withGenerationTelemetry(async (value) => { calls.push(value); }, () => provider.complete({ system: "test", messages: [], schema: z.object({ value: z.string() }) }));
    expect(calls).toHaveLength(2);
    expect(calls.every((value) => value.usage === null)).toBe(true);
  });
});
