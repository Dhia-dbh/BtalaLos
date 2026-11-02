"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SEARCH_FIELDS } from "@/lib/application-search";
import { preparationRequest } from "./client";
import { Button } from "@/components/ui/button";
const columns = ["title", "company", "role", "location", "mode", "salary", "deadline", "postingUrl", "postingText", "language"];
function displayValue(value: unknown): string {
 if (value === null || value === undefined || value === "") return "Not given";
 if (typeof value === "boolean") return value ? "Yes" : "No";
 if (Array.isArray(value)) return value.map(displayValue).join("\n");
 if (typeof value === "object") return Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => `${key}: ${displayValue(item)}`).join("\n");
 return String(value);
}
const extra = ["externalJobId", "recruiterName", "recruiterEmail", "applicationUrl", "applicationMethod", "applicationInstructions", "keywords", "requirements"];
function ValueEditor({ value, onChange, label, native = false }: { native?: boolean; value: unknown; onChange: (value: unknown) => void; label: string }) {
  if (typeof value === "boolean") return <input aria-label={label} type="checkbox" checked={value} onChange={(event) => onChange(event.target.checked)} />;
  if (Array.isArray(value)) return <div className="grid gap-2">{value.map((entry, index) => <div className="flex gap-2" key={index}><ValueEditor native={native} label={`${label} ${index + 1}`} value={entry} onChange={(next) => onChange(value.map((old, i) => i === index ? next : old))} /><button type="button" aria-label={`Remove ${label} ${index + 1}`} onClick={() => onChange(value.filter((_, i) => i !== index))}>×</button></div>)}<button type="button" className="text-left underline" onClick={() => onChange([...value, label === "requirements" && native ? { text: "", kind: "other", skill: null, years: null, language: null } : ""])}>Add entry</button></div>;
  if (value && typeof value === "object") return <div className="grid gap-2">{Object.entries(value).map(([key, entry]) => <label key={key}>{key}<ValueEditor label={key} value={entry} onChange={(next) => onChange({ ...value, [key]: next })} /></label>)}</div>;
  if (label === "kind") return <select aria-label={label} value={String(value)} onChange={(event) => onChange(event.target.value)}>{["skill", "years", "language", "other"].map((kind) => <option key={kind}>{kind}</option>)}</select>;
  if (["deadline", "postingUrl", "applicationUrl", "recruiterEmail"].includes(label)) return <input aria-label={label} className="w-full rounded-control border border-line bg-input p-2" type={label === "deadline" ? "date" : label === "recruiterEmail" ? "email" : "url"} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
  return <textarea aria-label={label} className="w-full rounded-control border border-line bg-input p-2" rows={label === "postingText" ? 12 : 2} value={String(value ?? "")} onChange={(event) => onChange(label === "years" ? (event.target.value ? Number(event.target.value) : null) : event.target.value)} />;
}
export function Overview({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let cancelled = false; fetch(`/api/preparation/application?applicationId=${applicationId}`, { cache: "no-store" }).then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!cancelled) { const extracted = { ...data.extracted }; delete extracted.manualMetadata; setSaved({ ...Object.fromEntries([...columns, "sentAt", "createdAt"].map((key) => [key, data[key] ?? ""])), ...Object.fromEntries(extra.map((key) => [key, ["keywords", "requirements"].includes(key) ? [] : ""])), ...extracted, ...Object.fromEntries(columns.map((key) => [key, key === "deadline" ? data[key]?.slice(0, 10) ?? "" : data[key] ?? ""])), native: data.documentMode === "NATIVE", active: data.preparations.some((run: { status: string }) => ["QUEUED", "RUNNING"].includes(run.status)) }); } }).catch((failure) => { if (!cancelled) setError(failure.message); }); return () => { cancelled = true; }; }, [applicationId]);
  if (!saved) return <p role={error ? "alert" : "status"} className="p-6">{error || "Loading overview…"}</p>;
  const values = draft ?? saved;
  return <section className="mx-auto grid w-full max-w-3xl gap-4 p-6" aria-label="Job overview">
    <div className="flex justify-between"><h2 className="font-serif text-section">Overview</h2>{!draft && <Button disabled={Boolean(saved.active)} onClick={() => setDraft(structuredClone(saved))}>Edit details</Button>}</div>
    <p className="text-sm text-muted">Changes apply to subsequent generation. Existing documents remain as generated.</p>
    {Boolean(saved.active) && <p>Cancel preparation before editing its inputs.</p>}
    {error && <p role="alert">{error}</p>}
    <form className="grid gap-4" onSubmit={async (event) => { event.preventDefault(); setBusy(true); setError(""); try { await preparationRequest("overview", { applicationId, values: draft }); setSaved(draft); setDraft(null); router.refresh(); } catch (failure) { setError((failure as Error).message); } finally { setBusy(false); } }}>
      {Object.entries(values).filter(([key]) => !["active", "native", "manualMetadata"].includes(key)).map(([key, value]) => <div key={key} className="grid gap-1 border-b border-line pb-3"><label className="text-sm font-medium">{SEARCH_FIELDS[key as keyof typeof SEARCH_FIELDS] ?? key}</label>{draft && !["sentAt", "createdAt", "warnings", "channel"].includes(key) ? <ValueEditor native={Boolean(saved.native)} label={key} value={value} onChange={(next) => setDraft({ ...draft, [key]: next })} /> : <div className="whitespace-pre-wrap break-words text-sm">{["postingUrl", "applicationUrl"].includes(key) && typeof value === "string" && /^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer" className="underline">{value}</a> : displayValue(value)}</div>}</div>)}
      {draft && <div className="flex gap-3"><Button type="submit" disabled={busy}>Save changes</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => { setDraft(null); setError(""); }}>Cancel</Button></div>}
    </form>
  </section>;
}
