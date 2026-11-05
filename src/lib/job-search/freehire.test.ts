import { afterEach, describe, expect, it, vi } from "vitest";

import { json, stubFetch } from "@/lib/ai/test-http";

import { freehire } from "./freehire";
import { postingDetails, searchPostings, testSource } from "./index";
import { clearJobSearchCache } from "./cache";
import { EMPTY_QUERY } from "./search";

const query = { ...EMPTY_QUERY, keywords: "engineer", country: "de" };
const job = {
  public_slug: "engineer-acme-123", title: "Engineer &amp; Researcher", company: "Acme", location: "Berlin",
  description: "<p>Full description</p>", url: "https://careers.example/123", source: "greenhouse",
  countries: ["DE"], work_mode: "remote", posted_at: "2026-11-01T00:00:00Z",
  enrichment: { salary_min: 60000, salary_max: 80000, salary_currency: "EUR", salary_period: "year" },
};
const page = { data: [job], meta: { total: 41, limit: 20, offset: 0 } };

afterEach(() => { vi.unstubAllGlobals(); clearJobSearchCache(); });

describe("Freehire", () => {
  it("uses the full-description endpoint and supported filters, without authentication", async () => {
    const requests = stubFetch(() => json(page));
    await freehire.search({ ...query, remoteOnly: true, postedWithin: "3days" }, { key: null }, null);
    expect(requests[0].url.origin + requests[0].url.pathname).toBe("https://freehire.me/api/v1/agent/jobs/search");
    expect(Object.fromEntries(requests[0].url.searchParams)).toEqual({
      q: "engineer", description_format: "text", limit: "20", offset: "0", countries: "DE", work_mode: "remote", posted_within_days: "3",
    });
    expect(requests[0].headers.has("authorization")).toBe(false);
  });

  it("maps complete postings through the provider registry and uses the description without fetching again", async () => {
    const requests = stubFetch(() => json(page));
    const result = await searchPostings("FREEHIRE", { key: "fh_key" }, query);
    expect(requests[0].headers.get("authorization")).toBe("Bearer fh_key");
    expect(result).toEqual({ next: "offset:20", postings: [{
      source: "FREEHIRE", externalId: job.public_slug, title: "Engineer & Researcher", company: "Acme", place: "Berlin",
      description: "Full description", url: job.url, via: "greenhouse", remote: true, salary: "EUR 60,000–80,000 per year",
      postedAt: "2026-11-01T00:00:00.000Z", complete: true,
    }] });
    expect(await postingDetails("FREEHIRE", { key: "fh_key" }, result.postings[0])).toBe("Full description");
    expect(requests).toHaveLength(1);
  });

  it("searches by city and enforces country locally rather than widening geography with OR", async () => {
    const requests = stubFetch(() => json({ ...page, data: [job, { ...job, public_slug: "us", countries: ["US"] }, job, { title: "invalid" }] }));
    const result = await freehire.search({ ...query, place: "Berlin" }, { key: null }, null);
    expect(requests[0].url.searchParams.get("cities")).toBe("Berlin");
    expect(requests[0].url.searchParams.has("countries")).toBe(false);
    expect(result.postings.map((item) => item.externalId)).toEqual([job.public_slug]);
  });

  it("paginates even when country filtering empties a page and stops at the total or deep-page bound", async () => {
    const requests = stubFetch(() => json({ ...page, data: [{ ...job, countries: ["US"] }] }));
    expect(await freehire.search({ ...query, place: "Berlin" }, { key: null }, "offset:20")).toEqual({ postings: [], next: "offset:40" });
    expect(requests[0].url.searchParams.get("offset")).toBe("20");
    expect((await freehire.search(query, { key: null }, "offset:40")).next).toBeNull();
    stubFetch(() => json({ ...page, meta: { total: 10001 } }));
    expect((await freehire.search(query, { key: null }, "offset:9980")).next).toBeNull();
    await expect(freehire.search(query, { key: null }, "offset:10000")).rejects.toMatchObject({ problem: "changed" });
  });

  it.each([[401, "key"], [429, "quota"], [503, "unavailable"]])("reports HTTP %s as %s", async (status, problem) => {
    stubFetch(() => json({ error: "upstream error" }, { status }));
    await expect(freehire.search(query, { key: null }, null)).rejects.toMatchObject({ problem });
  });

  it("rejects changed envelopes and ignored filters", async () => {
    for (const response of [{ jobs: [] }, { ...page, meta: { total: 1, ignored_params: ["countries"] } }]) {
      stubFetch(() => json(response));
      await expect(freehire.search(query, { key: null }, null)).rejects.toMatchObject({ problem: "changed" });
    }
  });

  it("tests the connection with a small search through the registry", async () => {
    const requests = stubFetch(() => json({ data: [], meta: { total: 0 } }));
    await testSource("FREEHIRE", { key: null }, { baseUrl: "http://127.0.0.1:3998/freehire" });
    expect(requests[0].url.pathname).toBe("/freehire/agent/jobs/search");
  });
});
