import { expect, it, vi } from "vitest";
import { demoProfile } from "@/lib/demo-profile";
import { assessRequirements } from "./requirements";
const profile = demoProfile();
vi.mock("@/lib/profile-data", () => ({ loadProfile: async () => profile }));
it("classifies only profile-supported skills and distinguishes gaps from partial coverage", async () => {
  const skill = profile.skills[0];
  const result = await assessRequirements([skill.name, "Unsupported requirement"], async (schema) => schema.parse({ matches: [{ requirement: 0, skill: skill.name, language: null, kind: "skill", years: null }, { requirement: 1, skill: "Invented skill", language: null, kind: "skill", years: null }] }));
  expect(result.items[0].result).toBe(profile.experience.some((entry) => entry.skillIds.includes(skill.id)) ? "covered" : "partial");
  expect(result.items[1]).toMatchObject({ result: "gap", skill: null, experienceIds: [] });
});
it("handles no requirements without asking the model and validates malformed input", async () => {
  const generate = vi.fn();
  expect(await assessRequirements([], generate)).toEqual({ items: [] });
  expect(generate).not.toHaveBeenCalled();
  await expect(assessRequirements(null, generate)).rejects.toThrow();
});

it("checks experience duration rather than treating a years requirement as a covered skill", async () => {
  const { experienceMonths } = await import("@/lib/profile");
  const years = Math.floor(experienceMonths(profile, new Date()) / 12) + 1;
  const result = await assessRequirements([`${years} years of ${profile.skills[0].name}`], async (schema) => schema.parse({ matches: [{ requirement: 0, skill: profile.skills[0].name, language: null, kind: "years", years }] }));
  expect(result.items[0].result).toBe("gap");
});
it("rejects incomplete requirement mappings rather than publishing an incomplete assessment", async () => {
  await expect(assessRequirements(["Python", "Rust"], async (schema) => schema.parse({ matches: [{ requirement: 0, skill: null, language: null, kind: "skill", years: null }] }))).rejects.toThrow();
});
