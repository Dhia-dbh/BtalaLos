import { describe, expect, it } from "vitest";
import { matchingMailFilters } from "./mail-filters";

describe("email exclusions", () => {
  it("matches any literal phrase only in the selected field, ignoring case", () => {
    const rules = [{ id: "linkedin", target: "subject" as const, phrases: ["jobs for you", "new roles"] }, { id: "newsletter", target: "body" as const, phrases: ["unsubscribe"] }, { id: "literal", target: "both" as const, phrases: ["[weekly]"] }];
    expect(matchingMailFilters("New ROLES for you", "hello", rules)).toEqual(["linkedin"]);
    expect(matchingMailFilters("unsubscribe", "Jobs for you", rules)).toEqual([]);
    expect(matchingMailFilters("[weekly]", "UNSUBSCRIBE", rules)).toEqual(["newsletter", "literal"]);
    expect(matchingMailFilters("weekly", "hello", rules)).toEqual([]);
  });
});
