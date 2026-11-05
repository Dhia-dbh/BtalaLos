import "server-only";

import { z } from "zod";

import type { JobSourceAdapter, RequestContext, SourceCredentials } from "./adapter";
import { jobSearchError } from "./errors";
import { requestJson } from "./http";
import { EMPTY_QUERY, POSTED_WITHIN, safeLink, type FoundPosting, type SearchPage, type SearchQuery } from "./search";
import { plainText } from "./text";

const BASE = "https://freehire.me/api/v1";
const PAGE_SIZE = 20;
const maybeText = z.string().nullish();
const resultSchema = z.object({
  public_slug: z.string().min(1),
  title: maybeText,
  company: maybeText,
  location: maybeText,
  description: maybeText,
  url: maybeText,
  source: maybeText,
  countries: z.array(z.string()),
  work_mode: maybeText,
  posted_at: maybeText,
  enrichment: z.object({
    salary_min: z.number().nullish(),
    salary_max: z.number().nullish(),
    salary_currency: maybeText,
    salary_period: maybeText,
  }).nullish(),
});
const responseSchema = z.object({
  data: z.array(z.unknown()),
  meta: z.object({ total: z.number().int().nonnegative(), ignored_params: z.array(z.unknown()).optional() }),
});

function postingFromResult(result: z.output<typeof resultSchema>): FoundPosting {
  const salary = result.enrichment;
  const amounts = [salary?.salary_min, salary?.salary_max].filter((value): value is number => value != null);
  const range = [...new Set(amounts)].map((value) => value.toLocaleString("en-US")).join("–");
  const posted = result.posted_at ? Date.parse(result.posted_at) : NaN;
  return {
    source: "FREEHIRE",
    externalId: result.public_slug.slice(0, 500),
    title: plainText(result.title).slice(0, 500),
    company: plainText(result.company).slice(0, 300),
    place: plainText(result.location).slice(0, 300),
    remote: result.work_mode ? result.work_mode === "remote" : null,
    salary: range ? [salary?.salary_currency, range, salary?.salary_period ? `per ${salary.salary_period}` : ""].filter(Boolean).join(" ").slice(0, 200) : "",
    postedAt: Number.isNaN(posted) ? null : new Date(posted).toISOString(),
    url: safeLink(result.url).slice(0, 2000),
    via: plainText(result.source).slice(0, 100),
    description: plainText(result.description).slice(0, 100_000),
    complete: true,
  };
}

async function searchPage(query: SearchQuery, { key }: SourceCredentials["FREEHIRE"], next: string | null, context: RequestContext = {}): Promise<SearchPage> {
  const offset = next === null ? 0 : Number(next.replace(/^offset:/, ""));
  if (!Number.isInteger(offset) || offset < 0 || offset + PAGE_SIZE > 10_000) throw jobSearchError("changed", "FREEHIRE");
  const url = new URL(`${context.baseUrl ?? BASE}/agent/jobs/search`);
  url.searchParams.set("q", query.keywords);
  url.searchParams.set("description_format", "text");
  url.searchParams.set("limit", String(PAGE_SIZE));
  url.searchParams.set("offset", String(offset));
  // Freehire ORs geography facets. Search the city alone, then enforce the country below.
  if (query.place) url.searchParams.set("cities", query.place);
  else if (query.country) url.searchParams.set("countries", query.country.toUpperCase());
  if (query.remoteOnly) url.searchParams.set("work_mode", "remote");
  const days = POSTED_WITHIN.find((option) => option.value === query.postedWithin)?.days;
  if (days) url.searchParams.set("posted_within_days", String(days));
  const answer = responseSchema.safeParse(await requestJson("FREEHIRE", url, {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    signal: context.signal,
  }));
  if (!answer.success || answer.data.meta.ignored_params?.length) {
    throw jobSearchError("changed", "FREEHIRE", { detail: `${url.pathname}: unexpected answer or ignored filters` });
  }
  const seen = new Set<string>();
  const postings: FoundPosting[] = [];
  for (const item of answer.data.data) {
    const parsed = resultSchema.safeParse(item);
    if (!parsed.success) continue;
    const result = parsed.data;
    if (seen.has(result.public_slug)) continue;
    seen.add(result.public_slug);
    if (query.place && query.country && !result.countries.some((country) => country.toLowerCase() === query.country)) continue;
    postings.push(postingFromResult(result));
  }
  const following = offset + PAGE_SIZE;
  return {
    postings,
    next: answer.data.data.length > 0 && following < answer.data.meta.total && following + PAGE_SIZE <= 10_000 ? `offset:${following}` : null,
  };
}

export const freehire: JobSourceAdapter<"FREEHIRE"> = {
  source: "FREEHIRE",
  search: searchPage,
  details: async (posting) => posting.description || null,
  test: async (credentials, context) => {
    await searchPage({ ...EMPTY_QUERY, keywords: "developer" }, credentials, null, context);
  },
};
