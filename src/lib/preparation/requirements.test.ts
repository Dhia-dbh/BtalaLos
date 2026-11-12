import { expect, it, vi } from "vitest";
import { demoProfile } from "@/lib/demo-profile";
import { assessRequirements } from "./requirements";
const profile = demoProfile();
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => profile }));
it("classifies only profile-supported skills and distinguishes gaps from partial coverage", async () => {
  const skill = profile.skills[0];
  const result = await assessRequirements([skill.name, "Unsupported requirement"], async (schema) => schema.parse({ matches: [{ requirement: 0, skill: skill.name, language: null }, { requirement: 1, skill: "Invented skill", language: null }] }));
  expect(result.items[0].result).toBe(profile.experience.some((entry) => entry.skillIds.includes(skill.id)) ? "covered" : "partial");
  expect(result.items[1]).toMatchObject({ result: "gap", skill: null, experienceIds: [] });
});
it("handles no requirements without asking the model and validates malformed input", async () => {
  const generate = vi.fn();
  expect(await assessRequirements([], generate)).toEqual({ items: [] });
  expect(generate).not.toHaveBeenCalled();
  await expect(assessRequirements(null, generate)).rejects.toThrow();
});
