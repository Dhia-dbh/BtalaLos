import type { MailFilter } from "./types";

export function matchingMailFilters(subject: string, body: string, filters: MailFilter[]): string[] {
  return filters.filter((rule) => {
    const text = (rule.target === "subject" ? subject : rule.target === "body" ? body : `${subject}\n${body}`).toLocaleLowerCase();
    return rule.phrases.some((phrase) => text.includes(phrase.toLocaleLowerCase()));
  }).map((rule) => rule.id);
}
