"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { generationTotals, stageGroup, type Segment, type Trace } from "@/lib/generation-progress";

export function GenerationProgress({ segments, traces, active, currentCli, incompleteHistory = false }: {
  segments: Segment[];
  traces: Trace[];
  active: boolean;
  currentCli?: { model: string; effort: string };
  incompleteHistory?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const totals = generationTotals(traces, now);
  const currentModel = active ? currentCli?.model : undefined;
  const currentEffort = active ? currentCli?.effort : undefined;
  const initialStages = traces
    .filter((trace) => ["read-posting", "write-documents", "agent-draft", "connector-draft"].includes(trace.type))
    .flatMap((trace) => trace.stages);
  const initialLabels = [...new Set(initialStages.map((stage) => stageGroup(stage.name)))];
  const displaySegments = [
    ...initialLabels.map((label): Segment => ({
      label,
      status: initialStages.filter((stage) => stageGroup(stage.name) === label).at(-1)!.status,
    })),
    ...segments,
  ];
  const resolved = displaySegments.filter((segment) => ["DONE", "SKIPPED"].includes(segment.status)).length;
  const current = displaySegments.find((segment) => ["RUNNING", "FAILED", "CANCELLED"].includes(segment.status));
  const skipped = displaySegments.filter((segment) => segment.status === "SKIPPED");
  const tokenLabel = totals.coverage === "unavailable" ? "unavailable"
    : `${totals.input.toLocaleString()} input / ${totals.output.toLocaleString()} output${totals.coverage === "partial" || incompleteHistory ? " (partially reported)" : ""}`;

  return (
    <div className="flex flex-col gap-3">
      {displaySegments.length > 0 && (
        <>
          <div
            role="progressbar"
            aria-label="Application generation"
            aria-valuemin={0}
            aria-valuemax={displaySegments.length}
            aria-valuenow={resolved}
            aria-valuetext={`${resolved} of ${displaySegments.length} stages resolved${current ? `, ${current.label}: ${current.status.toLowerCase()}` : ""}`}
            className="flex h-2 gap-1"
          >
            {displaySegments.map((segment) => (
              <span
                key={segment.label}
                title={`${segment.label}: ${segment.status.toLowerCase()}`}
                className={cn(
                  "flex-1 rounded-full",
                  ["PENDING", "SKIPPED"].includes(segment.status) && "bg-track",
                  segment.status === "DONE" && "bg-success",
                  segment.status === "RUNNING" && "bg-primary motion-safe:animate-pulse",
                  ["FAILED", "CANCELLED"].includes(segment.status) && "bg-danger",
                  segment.status === "SKIPPED" && "border border-line-strong",
                )}
              />
            ))}
          </div>
          <p role="status" className="text-sm">
            {current
              ? `${current.label}${current.status !== "RUNNING" ? ` (${current.status.toLowerCase()})` : "…"}`
              : `${resolved} of ${displaySegments.length} stages resolved`}
          </p>
        </>
      )}
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-meta text-muted" aria-label="Application generation usage">
        <span>Tokens: {tokenLabel}</span>
        <span>Processing time: {traces.length ? `${(totals.duration / 1000).toFixed(1)}s${incompleteHistory ? " (recorded stages only)" : ""}` : "unavailable"}</span>
        <span>Effort: {currentEffort ?? totals.latest?.effort ?? "not reported"}</span>
        {(currentModel || totals.latest) && <span>{currentModel ?? totals.latest?.model}</span>}
      </div>
      {skipped.length > 0 && <p className="text-meta text-muted">Skipped: {skipped.map((segment) => segment.label).join(", ")}</p>}
      {traces.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm">Generation usage details</summary>
          <ul className="mt-2 space-y-3 text-meta text-muted">
            {traces.map((trace) => (
              <li key={trace.id}>
                {trace.type}
                <ul className="ml-4 space-y-1">
                  {trace.stages.map((stage, index) => (
                    <li key={index}>
                      {stage.name} ({stage.status.toLowerCase()})
                      {stage.calls.map((call, position) => (
                        <p key={position}>
                          {call.model} · effort {call.effort ?? "not reported"} · {call.usage ? `${call.usage.input} input / ${call.usage.output} output tokens` : "tokens unavailable"} · {((Date.parse(call.finishedAt) - Date.parse(call.startedAt)) / 1000).toFixed(1)}s
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
