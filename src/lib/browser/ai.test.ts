import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { json, stubFetch } from "@/lib/ai/test-http";
import type { BrowserAi } from "./types";

vi.mock("@/lib/env", () => ({ env: { DOSSIER_SECRET: "s".repeat(40) } }));
vi.mock("@/lib/settings-data", () => ({ loadSettings: async () => ({ browserAiKeyEnc: null, apiKeyEnc: "unrelated-document-key" }) }));
vi.mock("@/lib/preparation/worker", () => ({ workerOperation: vi.fn(async () => ({ value: "ok" })) }));
import { workerOperation } from "@/lib/preparation/worker";
import { browserGenerate, browserModels } from "./ai";
import { browserActionSchema } from "./types";
const schema = z.object({ value: z.string() });
const local: BrowserAi = { source: "provider", provider: "LOCAL", baseUrl: "http://browser-ollama.example:11434", model: "local-browser", effort: "on" };

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("independent browser AI", () => {
  it("sends action alternatives using the supported anyOf schema", async () => {
    vi.mocked(workerOperation).mockResolvedValueOnce({ next: { action: "input", question: "Phone?" } });
    await browserGenerate({ source: "cli", provider: "codex", baseUrl: "", model: "browser-model", effort: "medium" }, z.object({ next: browserActionSchema }), "Browser request", "schema-test");
    const wire = vi.mocked(workerOperation).mock.calls[0][1].schema as { properties: { next: { anyOf: unknown[] } } };
    expect(wire.properties.next.anyOf).toHaveLength(8);
    expect(JSON.stringify(wire)).not.toContain('"oneOf"');
  });
  it("uses the explicitly selected CLI model and thinking level", async () => {
    await expect(browserGenerate({ source: "cli", provider: "codex", baseUrl: "", model: "browser-model", effort: "high" }, schema, "Browser request", "test-key")).resolves.toEqual({ value: "ok" });
    expect(workerOperation).toHaveBeenCalledWith("test-key", expect.objectContaining({ kind: "generate", provider: "codex", model: "browser-model", effort: "high", prompt: "Browser request" }), undefined);
  });
  it("discovers Ollama controls and sends the browser's thinking choice without changing document defaults", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.pathname === "/api/version") return json({ version: "test" });
      if (url.pathname === "/api/tags") return json({ models: [{ name: "local-browser" }] });
      if (url.pathname === "/api/show") return json({ thinking: { values: [false, true], default: false } });
      if (url.pathname === "/api/chat") return json({ message: { role: "assistant", content: '{"value":"ok"}' }, done_reason: "stop" });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    expect(await browserModels(local)).toEqual([{ id: "local-browser", name: "local-browser", efforts: ["off", "on"] }]);
    await expect(browserGenerate(local, schema, "Fill the portal", "local")).resolves.toEqual({ value: "ok" });
    expect(calls.find((call) => call.url.pathname === "/api/chat")?.body).toMatchObject({ model: "local-browser", think: true });
  });
  it("rejects an unsupported local thinking choice before generation", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.pathname === "/api/version") return json({ version: "test" });
      if (url.pathname === "/api/tags") return json({ models: [{ name: "local-browser" }] });
      if (url.pathname === "/api/show") return json({ thinking: { values: [false], default: false } });
      throw new Error("Generation must not run");
    });
    await expect(browserGenerate(local, schema, "Fill", "unsupported")).rejects.toThrow("does not advertise");
    expect(calls.some((call) => call.url.pathname === "/api/chat")).toBe(false);
  });
  it("uses LM Studio's advertised native reasoning settings with no integrations or saved conversation", async () => {
    const calls = stubFetch(({ url }) => {
      if (url.pathname === "/api/v1/models") return json({ models: [{ type: "llm", key: "browser-local", display_name: "Browser Local", max_context_length: 32768, loaded_instances: [{ id: "loaded", config: { context_length: 16384 } }], reasoning: { allowed_options: ["off", "on"], default: "off" } }] });
      if (url.pathname === "/api/v1/chat") return json({ output: [{ type: "reasoning", content: "private reasoning" }, { type: "message", content: '{"value":"ok"}' }] });
      throw new Error(`Unexpected request: ${url.pathname}`);
    });
    const ai: BrowserAi = { source: "provider", provider: "LMSTUDIO", baseUrl: "http://lmstudio-browser.example:1234", model: "browser-local", effort: "on" };
    expect((await browserModels(ai))[0].efforts).toEqual(["off", "on"]);
    await expect(browserGenerate(ai, schema, "Fill", "lmstudio")).resolves.toEqual({ value: "ok" });
    expect(calls.find((call) => call.url.pathname === "/api/v1/chat")?.body).toMatchObject({ reasoning: "on", store: false, integrations: [], stream: false });
  });
  it("uses a newly entered browser key for discovery without inheriting the document key", async () => {
    const calls = stubFetch(() => json({ object: "list", data: [{ id: "browser", object: "model", owned_by: "codex", reasoning_efforts: ["low"], default_reasoning_effort: "low" }] }));
    const ai: BrowserAi = { source: "provider", provider: "OPENAI", baseUrl: "https://browser-provider.example/v1", model: "browser", effort: "low" };
    expect((await browserModels(ai, "browser-only-key"))[0].efforts).toEqual(["low"]);
    expect(calls[0].headers.get("authorization")).toBe("Bearer browser-only-key");
  });
});
