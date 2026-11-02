import { AsyncLocalStorage } from "node:async_hooks";

export type TokenUsage = { input: number; output: number; cachedInput?: number };
export type GenerationCall = {
  id?: string;
  provider: string;
  model: string;
  effort: string | null;
  usage: TokenUsage | null;
  startedAt: string;
  finishedAt: string;
};
export type GenerationStage = {
  name: string;
  startedAt: string;
  finishedAt?: string;
  status: "RUNNING" | "DONE" | "FAILED" | "CANCELLED";
  calls: GenerationCall[];
};
const scope = new AsyncLocalStorage<{ id?: string; record: (call: GenerationCall) => Promise<void> }>();
export const withGenerationTelemetry = <T>(record: (call: GenerationCall) => Promise<void>, work: () => Promise<T>, id?: string) => scope.run({ id, record }, work);
export async function recordGenerationCall(call: GenerationCall) {
  await scope.getStore()?.record(call);
}

export const generationTraceId = () => scope.getStore()?.id;
