export const SEARCH_FIELDS = {
  title: "Title", company: "Institution", role: "Role", postingText: "Job description",
  postingUrl: "Posting URL", externalJobId: "Job reference", location: "Location", mode: "Work mode",
  salary: "Salary", recruiterName: "Recruiter", recruiterEmail: "Recruiter email", contactEmails: "Contact emails",
  applicationUrl: "Application URL", applicationMethod: "Application method", applicationInstructions: "Application instructions",
  keywords: "Keywords", requirements: "Requirements", language: "Language", status: "Status",
  sentAt: "Applied date", deadline: "Deadline", createdAt: "Created date", updatedAt: "Updated date",
} as const;
export type SearchField = keyof typeof SEARCH_FIELDS;
export type FieldFilter = { field: SearchField; value: string; to?: string };
export const dateField = (field: string) => ["sentAt", "deadline", "createdAt", "updatedAt"].includes(field);
export function parseFieldFilters(raw: string | undefined): FieldFilter[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is FieldFilter => item && Object.hasOwn(SEARCH_FIELDS, item.field) && typeof item.value === "string" && (item.to === undefined || typeof item.to === "string"));
  } catch { return []; }
}
export function searchableText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return Object.values(value).map(searchableText).join(" ");
  return String(value).toLocaleLowerCase();
}
export function matchesApplication(fields: Record<string, unknown>, query: string, filters: FieldFilter[]): boolean {
  return (!query || searchableText(fields).includes(query.toLocaleLowerCase())) && filters.every(({ field, value, to }) => {
    const text = searchableText(fields[field]);
    return dateField(field) ? Boolean(text) && (!value || text >= value) && (!to || text <= to) : text.includes(value.toLocaleLowerCase());
  });
}
