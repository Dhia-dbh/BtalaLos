import { describe, expect, it } from "vitest";
import { z } from "zod";

import { demoProfile } from "@/lib/demo-profile";

import sample from "../../../prisma/seed/prototype-sample.json";
import { OpenAICompatibleProvider } from "./providers/openai-compatible";
import { extractPosting, matchRequirements, refineChat, tailorResume, writeCoverLetter } from "./tasks";

const enabled = (process.env.AI_LIVE ?? "").split(",").includes("codex");
const model = process.env.CODEX_BRIDGE_TEST_MODEL ?? "gpt-6.1-sol";

function provider() {
  const token = process.env.CODEX_BRIDGE_TEST_TOKEN;
  if (!token) throw new Error("Set CODEX_BRIDGE_TEST_TOKEN for the opt-in Codex bridge tests.");
  return new OpenAICompatibleProvider("OPENAI", process.env.CODEX_BRIDGE_URL ?? "http://host.docker.internal:8787/v1", token, model, 300_000);
}

describe.runIf(enabled)("live: Codex bridge", { timeout: 900_000 }, () => {
  it("lists the configured model and passes Dossier's connection test", async () => {
    const ai = provider();
    expect(await ai.listModels()).toContain(model);
    expect(await ai.test()).toMatchObject({ model, latencyMs: expect.any(Number) });
  });

  it("uses a second catalog model with an explicit thinking effort", async () => {
    const ai = provider();
    const models = await ai.listModelOptions();
    expect(models.find((entry) => entry.id === model)?.thinkingEfforts).toContain("high");
    const other = models.find((entry) => entry.id !== model && entry.thinkingEfforts.includes("low"));
    expect(other).toBeDefined();
    const selected = new OpenAICompatibleProvider("OPENAI", process.env.CODEX_BRIDGE_URL ?? "http://host.docker.internal:8787/v1", process.env.CODEX_BRIDGE_TEST_TOKEN!, other!.id, 300_000, "low");
    expect(await selected.complete({ system: "Answer with exactly OK.", messages: [{ role: "user", content: "Check the selected model and thinking level." }] })).toBe("OK");
  });

  it("returns a strict schema with nullable fields", async () => {
    const result = await provider().complete({
      system: "Extract the company and city. Use null for a missing deadline.",
      messages: [{ role: "user", content: "Ledgerly is hiring in Amsterdam." }],
      schema: z.object({ company: z.string(), city: z.string(), deadline: z.string().nullable() }),
      schemaName: "codex_bridge_check",
    });
    expect(result).toEqual({ company: "Ledgerly", city: "Amsterdam", deadline: null });
  });

  it("extracts a posting, matches it, writes documents and refines the summary", async () => {
    const ai = provider();
    const profile = demoProfile();
    const posting = sample.ledgerly.posting;
    const options = { creativity: "BALANCED" as const, strict: true, language: "English" };
    const { data: extracted } = await extractPosting(ai, { posting }, options);
    expect(extracted.company).toMatch(/ledgerly/i);
    expect(extracted.requirements.length).toBeGreaterThanOrEqual(4);
    const { data: match } = await matchRequirements(ai, { requirements: extracted.requirements, profile }, options);
    expect(match.items).toHaveLength(extracted.requirements.length);
    const { data: resume } = await tailorResume(ai, { profile, extracted, match, facts: [], posting }, options);
    expect(resume.find((unit) => unit.id === "summary")?.text.length).toBeGreaterThan(20);
    const { data: letter } = await writeCoverLetter(ai, { profile, extracted, match, facts: [], posting, tone: "WARM" }, options);
    expect(letter.at(-1)).toMatchObject({ id: "sign-off", text: "Warm regards," });
    expect(letter.length).toBeGreaterThanOrEqual(3);
    const { data: refinement } = await refineChat(ai, {
      profile, extracted, posting, resume, letter, facts: [], tone: "WARM", target: "summary", viewing: "RESUME",
      history: [{ role: "user", text: "Please focus on product design." }, { role: "assistant", text: "I can help refine the wording." }],
      request: "Rewrite the resume summary as one concise sentence. Keep its existing facts.",
    }, options);
    expect(refinement.declined).toBe(false);
    expect(refinement.reply.length).toBeGreaterThan(0);
    expect(refinement.edits.some((edit) => edit.document === "RESUME" && edit.unitId === "summary")).toBe(true);
  });
});
