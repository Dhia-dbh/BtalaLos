import { describe, expect, it } from "vitest";
import { matchesApplication, parseFieldFilters } from "./application-search";
describe("application search", () => {
  const fields = { company: "Institute", externalJobId: "W2935", postingText: "Battery impedance research", postingUrl: "https://jobs.example/W2935", sentAt: "2026-11-02", requirements: [{ text: "Python" }] };
  it("searches nested metadata, posting text, references and URLs without case sensitivity", () => {
    for (const query of ["PYTHON", "battery", "w2935", "https://jobs.example"]) expect(matchesApplication(fields, query, [])).toBe(true);
  });
  it("requires global search and all field filters to match", () => {
    expect(matchesApplication(fields, "research", [{ field: "company", value: "INSTITUTE" }, { field: "externalJobId", value: "w2935" }])).toBe(true);
    expect(matchesApplication(fields, "research", [{ field: "company", value: "battery" }])).toBe(false);
  });
  it("uses inclusive ranges and excludes missing applied dates", () => {
    const filters = [{ field: "sentAt" as const, value: "2026-11-02", to: "2026-11-02" }];
    expect(matchesApplication(fields, "", filters)).toBe(true);
    expect(matchesApplication({ ...fields, sentAt: "" }, "", filters)).toBe(false);
  });
  it("ignores malformed filters", () => {
    expect(parseFieldFilters("oops")).toEqual([]);
    expect(parseFieldFilters('[{"field":"unknown","value":"a"}]')).toEqual([]);
  });
});
