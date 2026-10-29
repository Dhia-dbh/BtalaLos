export const THINKING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ThinkingEffort = (typeof THINKING_EFFORTS)[number];

export type ModelOption = {
  id: string;
  name: string;
  thinkingEfforts: ThinkingEffort[];
  defaultThinkingEffort: ThinkingEffort | null;
};

export const THINKING_LABELS: Record<ThinkingEffort, string> = {
  none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High",
  xhigh: "Extra high", max: "Maximum", ultra: "Ultra",
};
