"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/toast";
import type { RunSnapshot } from "@/lib/browser/types";
import { browserRequest } from "./client";

type Run = { id: string; kind: string; status: string; revision: number; error: string | null; createdAt: string; snapshot: RunSnapshot; events: { id: string; kind: string; createdAt: string; data: unknown }[] };
export function BrowserRuns({ applicationId }: { applicationId?: string }) {
  const [runs, setRuns] = useState<Run[]>([]), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [outreach, setOutreach] = useState<{ id: string; to: string; subject: string; body: string; artifacts: RunSnapshot["artifacts"] } | null>(null), [selected, setSelected] = useState<string[]>([]);
  const router = useRouter();
  const load = useCallback(async () => {
    const response = await fetch(`/api/browser/runs${applicationId ? `?applicationId=${encodeURIComponent(applicationId)}` : ""}`, { cache: "no-store" });
    const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!Array.isArray(data)) throw new Error("Invalid browser-run response."); setRuns(data); setError("");
  }, [applicationId]);
  useEffect(() => { const timer = setTimeout(() => void load().catch((error) => setError(error.message)), 0); return () => clearTimeout(timer); }, [load]);
  const active = runs.some((run) => ["QUEUED", "RUNNING", "SUBMITTING", "APPROVED"].includes(run.status));
  useEffect(() => { const timer = setInterval(() => void load().catch((error) => setError(error.message)), active ? 2000 : 10000); return () => clearInterval(timer); }, [active, load]);
  const wasActive = useRef(false);
  useEffect(() => { if (wasActive.current && !active) router.refresh(); wasActive.current = active; }, [active, router]);
  const work = async (action: string, input: unknown) => { setBusy(true); try { await browserRequest(action, input); await load(); router.refresh(); } catch (error) { toast((error as Error).message); } finally { setBusy(false); } };
  return <div className="flex min-w-0 flex-col gap-4">
    <Card className="flex flex-col gap-3"><h2 className="font-serif text-section">Application automation</h2><p className="text-sm text-muted">Follow browser progress, answer missing questions, and review the final details before submission.</p><div className="flex flex-wrap gap-3">
      {applicationId && <><Button variant="secondary" disabled={busy || active} onClick={() => void work("start", { applicationId })}>Apply through portal</Button><Button variant="secondary" disabled={busy} onClick={() => { setBusy(true); void browserRequest<NonNullable<typeof outreach>>("outreach-draft", { applicationId }).then((draft) => { setOutreach(draft); setSelected([]); }).catch((error) => toast(error.message)).finally(() => setBusy(false)); }}>Draft recruiter outreach</Button></>}
      <Button variant="secondary" disabled={busy} onClick={() => void load().catch((error) => setError(error.message))}>Refresh runs</Button><Link href="/settings?section=browser" className="self-center text-sm underline">Browser and email settings</Link>
    </div>{error && <p role="alert" className="text-sm text-error">{error}</p>}</Card>
    {outreach && <Card className="flex flex-col gap-3"><h3 className="font-medium">Recruiter outreach draft</h3><Input label="Outreach recipient" value={outreach.to} onChange={(event) => setOutreach({ ...outreach, to: event.target.value })} /><Input label="Outreach subject" value={outreach.subject} onChange={(event) => setOutreach({ ...outreach, subject: event.target.value })} /><Textarea label="Outreach message" rows={8} value={outreach.body} onChange={(event) => setOutreach({ ...outreach, body: event.target.value })} />{outreach.artifacts.map((file) => <Checkbox key={file.id} label={`Attach ${file.fileName}`} checked={selected.includes(file.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, file.id] : selected.filter((id) => id !== file.id))} />)}<Button disabled={busy} onClick={() => void work("outreach-send", { id: outreach.id, to: outreach.to, subject: outreach.subject, body: outreach.body, artifactIds: selected })}>Prepare outreach for review</Button><Button variant="secondary" onClick={() => setOutreach(null)}>Close draft</Button></Card>}
    {runs.map((run) => <RunCard key={`${run.id}-${run.revision}`} run={run} busy={busy} work={work} />)}
  </div>;
}
function RunCard({ run, busy, work }: { run: Run; busy: boolean; work: (action: string, input: unknown) => Promise<void> }) {
  const [answer, setAnswer] = useState(""), [url, setUrl] = useState(""), [evidence, setEvidence] = useState("");
  const [mail, setMail] = useState(run.snapshot.mail);
  const paused = ["WAITING_FOR_INPUT", "WAITING_FOR_REVIEW"].includes(run.status);
  return <Card className="flex min-w-0 flex-col gap-4">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium">{run.kind.replaceAll("-", " ")}</h3><span role="status" className="text-sm text-muted">{run.status.toLowerCase().replaceAll("_", " ")}</span></div>
    <p className="text-meta text-muted">{new Date(run.createdAt).toLocaleString()} · revision {run.revision} · {run.snapshot.mode} submission</p>
    {run.error && <p role="alert" className="text-sm text-error">{run.error}</p>}
    {run.snapshot.mail && <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm"><dt>From</dt><dd>{run.snapshot.mail.from}</dd><dt>To</dt><dd>{run.snapshot.mail.to}</dd><dt>Subject</dt><dd>{run.snapshot.mail.subject}</dd><dt>Message</dt><dd className="whitespace-pre-wrap">{run.snapshot.mail.body}</dd></dl>}
    {run.snapshot.fields.length > 0 && <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="mb-3 text-left font-medium">Observed fields, including optional fields left empty</caption><thead><tr className="border-b border-line"><th className="p-2">Field</th><th className="p-2">Required</th><th className="p-2">Actual value</th><th className="p-2">Source / state</th></tr></thead><tbody>{run.snapshot.fields.map((field, index) => <tr key={`${field.id}-${index}`} className="border-b border-line"><td className="p-2">{field.label}<span className="block max-w-64 truncate text-meta text-muted" title={field.pageUrl}>{field.pageUrl}</span></td><td className="p-2">{field.required ? "Yes" : "No"}</td><td className="max-w-96 whitespace-pre-wrap p-2 [overflow-wrap:anywhere]">{field.actualValue || <span className="text-muted">Left empty</span>}</td><td className="p-2">{field.source}<span className="block text-meta text-muted">{field.state}</span></td></tr>)}</tbody></table></div>}
    <div className="text-sm"><h4 className="mb-2 font-medium">{run.status === "DRAFT" ? "Available documents" : "Documents"}</h4>{run.snapshot.artifacts.length ? run.snapshot.artifacts.map((file) => <p key={file.id} className="[overflow-wrap:anywhere]">{file.fileName} · {file.role} · version {file.version}<span className="block text-meta text-muted">SHA-256 {file.checksum}</span></p>) : <p className="text-muted">No attachments</p>}</div>
    {paused && <div className="flex flex-col gap-3">{mail ? <><Input label="Reviewed email recipient" value={mail.to} onChange={(event) => setMail({ ...mail, to: event.target.value })} /><Input label="Reviewed email subject" value={mail.subject} onChange={(event) => setMail({ ...mail, subject: event.target.value })} /><Textarea label="Reviewed email body" rows={8} value={mail.body} onChange={(event) => setMail({ ...mail, body: event.target.value })} /><Button variant="secondary" disabled={busy} onClick={() => void work("answers", { id: run.id, revision: run.revision, answers: [], mail: { to: mail.to, subject: mail.subject, body: mail.body } })}>Save email changes and invalidate approval</Button></> : <><Textarea label="Answer or correction" value={answer} rows={3} onChange={(event) => setAnswer(event.target.value)} /><Input label="Posting or portal URL (only when needed)" value={url} onChange={(event) => setUrl(event.target.value)} /><Button variant="secondary" disabled={busy || !answer.trim() && !url.trim()} onClick={() => void work("answers", { id: run.id, revision: run.revision, answers: answer.trim() ? [{ question: run.error || "Correction to the reviewed application", answer }] : [], ...(url.trim() ? { url: url.trim() } : {}) })}>Save answers and invalidate approval</Button></>}</div>}
    {run.status === "UNCERTAIN" && <div className="flex flex-col gap-3"><p className="text-sm">Check the portal or Gmail Sent first. Record what you verified before resolving this run.</p><Textarea label="Verified outcome evidence" value={evidence} onChange={(event) => setEvidence(event.target.value)} /><div className="flex flex-wrap gap-3"><Button disabled={busy || evidence.trim().length < 10} onClick={() => void work("reconcile", { id: run.id, outcome: "submitted", evidence })}>Confirm it was submitted</Button><Button variant="secondary" disabled={busy || evidence.trim().length < 10} onClick={() => void work("reconcile", { id: run.id, outcome: "not-submitted", evidence })}>Confirm it was not submitted</Button></div></div>}
    <div className="flex flex-wrap gap-3">{run.status === "WAITING_FOR_REVIEW" && <Button disabled={busy || Boolean(answer.trim() || url.trim()) || JSON.stringify(mail) !== JSON.stringify(run.snapshot.mail)} onClick={() => void work("approve", { id: run.id, revision: run.revision })}>Approve and submit</Button>}{run.status === "WAITING_FOR_INPUT" && <Button disabled={busy} onClick={() => void work("resume", { id: run.id })}>Resume automation</Button>}{!["SUBMITTING", "SUBMITTED", "UNCERTAIN", "CANCELLED"].includes(run.status) && <Button variant="secondary" disabled={busy} onClick={() => void work("cancel", { id: run.id })}>Cancel run</Button>}<a href={`/api/browser/report?id=${run.id}`} className="self-center text-sm underline">Download Markdown report</a></div>
    <details><summary className="cursor-pointer text-sm">Activity ({run.events.length})</summary><ol className="mt-3 flex flex-col gap-2 text-meta text-muted">{run.events.map((event) => <li key={event.id}>{new Date(event.createdAt).toLocaleTimeString()} · {event.kind.replaceAll("_", " ")}</li>)}</ol></details>
  </Card>;
}
