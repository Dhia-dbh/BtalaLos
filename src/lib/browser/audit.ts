import { checksum } from "@/lib/preparation/worker";
import type { Observation, RunSnapshot } from "./types";

export function pageHash(page: Observation) {
  return checksum(JSON.stringify({ url: page.url, fields: page.fields.map(({ label, type, required, value, options, pageUrl }) => ({ label, type, required, value, options, pageUrl })), controls: page.controls.map(({ label, final }) => ({ label, final })) }));
}
export function reviewHash(snapshot: RunSnapshot) {
  return checksum(JSON.stringify({ fields: snapshot.fields, artifacts: snapshot.artifacts, answers: snapshot.answers, mail: snapshot.mail, page: snapshot.observation ? pageHash(snapshot.observation) : null }));
}
const escape = (value: unknown) => String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
export function markdownReport(run: { id: string; kind: string; status: string; createdAt: Date | string; snapshot: unknown; events: { kind: string; data: unknown; createdAt: Date | string }[] }) {
  const snapshot = run.snapshot as RunSnapshot;
  const lines = [`# Application automation report`, ``, `Run: ${run.id}`, `Kind: ${run.kind}`, `Status: ${run.status}`, `Created: ${new Date(run.createdAt).toISOString()}`, `Role: ${snapshot.role} — ${snapshot.company}`, `AI: ${snapshot.ai.provider} / ${snapshot.ai.model} / ${snapshot.ai.effort}`, `Submission mode: ${snapshot.mode}`, ``, `## Fields`, ``, `| Page | Field | Required | Proposed | Actual | State | Source |`, `| --- | --- | --- | --- | --- | --- | --- |`];
  for (const field of snapshot.fields) lines.push(`| ${[field.pageUrl, field.label, field.required ? "yes" : "no", field.proposedValue, field.actualValue || "(empty)", field.state, field.source].map(escape).join(" | ")} |`);
  lines.push("", "## Documents", "", "| Role | Filename | Version | SHA-256 |", "| --- | --- | --- | --- |");
  for (const file of snapshot.artifacts) lines.push(`| ${[file.role, file.fileName, file.version, file.checksum].map(escape).join(" | ")} |`);
  if (snapshot.mail) lines.push("", "## Email", "", `From: ${snapshot.mail.from}`, `To: ${snapshot.mail.to}`, `Subject: ${snapshot.mail.subject}`, "", snapshot.mail.body);
  lines.push("", "## Events", "");
  for (const event of run.events) lines.push(`- ${new Date(event.createdAt).toISOString()} **${event.kind}** ${JSON.stringify(event.data)}`);
  return lines.join("\n");
}
