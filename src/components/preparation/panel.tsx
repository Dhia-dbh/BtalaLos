"use client";
import { ExportFiles } from "./export-files";
import { EmailDraftingSelect } from "./email-drafting-select";
import type { EmailDraftMode } from "@/lib/email-drafting";
import { GenerationProgress } from "./generation-progress";
import { progressSegments, type Trace } from "@/lib/generation-progress";
import Link from "next/link";
import { BrowserRuns } from "@/components/browser/runs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { toast } from "@/components/toast";
import { emailParts } from "@/lib/application-email";
import type { Unit } from "@/lib/application-data";
import { CliPicker } from "./cli-picker";
import type { CliOptions } from "@/lib/preparation/types";
import type { Step } from "@/lib/preparation/types";
import { EmailTab } from "@/app/(app)/applications/[id]/email-tab";
import type { GmailSender } from "@/app/(app)/applications/[id]/send-with-gmail";
import { preparationRequest } from "./client";

type View = {
  id: string;
  cli: CliOptions;
  documentMode: string;
  emailDraftMode?: EmailDraftMode | null;
  globalEmailDraftMode?: EmailDraftMode;
  company: string;
  role: string;
  deadline: string | null;
  postingText: string;
  extracted: {
    recruiterEmail?: string | null;
    applicationUrl?: string | null;
    applicationMethod?: string | null;
    submissionMethod?: string;
    emailDraftDecision?: { draft: boolean; reason: string };
    applicationInstructions?: string | null;
    warnings?: string[];
    keywords?: string[];
    manualMetadata?: { recruiterEmail?: string | null };
  } | null;
  packageProfileId: string | null;
  emailThreadId: string | null;
  profiles: { id: string; name: string }[];
  generationTraces?: Trace[];
  preparations: {
    kind?: string;
    jobId?: string;
    documentMode?: string;
    id: string;
    status: string;
    error: string | null;
    createdAt: string;
    finishedAt: string | null;
    steps: Step[];
  }[];
  artifacts: {
    id: string;
    role: string;
    pages: number | null;
    version: number;
    fileName?: string;
  }[];
  documents: { units: Unit[] }[];
};
export function PreparationPanel({
  applicationId,
  latex = false,
  gmail,
}: {
  applicationId: string;
  latex?: boolean;
  gmail?: GmailSender;
}) {
  const router = useRouter();
  const [cli, setCli] = useState<CliOptions | null>(null);
  const [data, setData] = useState<View | null>(null),
    [error, setError] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null),
    [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState("");
  const [manualCompose, setManualCompose] = useState(false);
  const [editEmail, setEditEmail] = useState(false),
    [parts, setParts] = useState({ to: "", subject: "", body: "" });
  const load = useCallback(async () => {
    const response = await fetch(
      `/api/preparation/application?applicationId=${applicationId}`,
      { cache: "no-store" },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setData(result);
    setError("");
  }, [applicationId]);
  useEffect(() => {
    const timer = setTimeout(
      () => void load().catch((failure) => setError(failure.message)),
      0,
    );
    return () => clearTimeout(timer);
  }, [load]);
  const active =
    data?.preparations.some((run) =>
      ["QUEUED", "RUNNING"].includes(run.status),
    ) || data?.generationTraces?.some((trace) => trace.stages.some((stage) => stage.status === "RUNNING")) || false;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(
      () => void load().catch((failure) => setError(failure.message)),
      2000,
    );
    return () => clearInterval(timer);
  }, [active, load]);
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) router.refresh();
    wasActive.current = active;
  }, [active, router]);
  const run = data?.preparations[0];
  const units = data?.documents[0]?.units ?? null;
  const email = units ? emailParts(units) : null;
  const work = async (action: string, input: unknown) => {
    if (busy) return;
    setBusy(true);
    try {
      await preparationRequest(action, input);
      await load();
      router.refresh();
      return true;
    } catch (failure) {
      toast((failure as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <div className="p-6">
        <p role="alert">{error}</p>
        <Button
          onClick={() =>
            void load().catch((failure) => setError(failure.message))
          }
        >
          Reload
        </Button>
      </div>
    );
  if (!data)
    return (
      <p className="p-6 text-muted" role="status">
        Loading preparation…
      </p>
    );
  const pack = data.artifacts.find((file) => file.role === "package");
  const file = data.artifacts.find((file) => file.id === preview) ?? pack;
  const selectedProfile = profileId ?? data.packageProfileId ?? "";
  const applicationUrl = /^https?:\/\//i.test(data.extracted?.applicationUrl ?? "")
    ? data.extracted!.applicationUrl
    : null;
  const recruiterEmail = data.extracted?.manualMetadata?.recruiterEmail ??
    data.extracted?.recruiterEmail;
  const portalOnly = Boolean(applicationUrl && !recruiterEmail && !email?.to);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto bg-canvas p-5 sm:p-8">
      <BrowserRuns applicationId={applicationId} />
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-serif text-section">
            {run?.status === "READY"
              ? "Application package ready"
              : "Application preparation"}
          </h2>
          <span className="text-sm text-muted" role="status">
            {run?.status.toLowerCase().replace("_", " ") ?? "Not prepared"}
          </span>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Select
            label="Application profile"
            className="min-w-48 flex-1"
            value={selectedProfile}
            disabled={active}
            onChange={(event) => setProfileId(event.target.value)}
          >
            <option value="">Select a profile</option>
            {data.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
          <Link href="/preparation" className="pb-3 text-sm underline">
            Manage profiles and documents
          </Link>
        </div>
        <EmailDraftingSelect value={data.emailDraftMode ?? null} globalMode={data.globalEmailDraftMode ?? "AUTO"} disabled={active || busy}
          onChange={(emailDraftMode) => void work("email-policy", { applicationId, emailDraftMode })} />
        <Link href="/settings?section=email" className="text-sm underline">Global email drafting settings</Link>
        {data.extracted?.emailDraftDecision && <p className="text-sm text-muted">{data.extracted.emailDraftDecision.draft ? "Last preparation, automatic email drafting: " : "Last preparation, email drafting skipped: "}{data.extracted.emailDraftDecision.reason}</p>}
        {latex && (
          <CliPicker
            value={cli ?? data.cli}
            onChange={setCli}
            disabled={active || busy}
          />
        )}
        {latex && (
          <Textarea
            label="AI revision instructions"
            rows={3}
            value={instructions}
            maxLength={4000}
            disabled={active}
            onChange={(event) => setInstructions(event.target.value)}
            hint="PDFs are checked against the one-page limit after each revision."
          />
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            disabled={busy || active || !selectedProfile}
            onClick={() =>
              void work("prepare", {
                applicationId,
                profileId: selectedProfile,
                instructions,
                ...(latex ? { cli: cli ?? data.cli } : {}),
              })
            }
          >
            {latex ? "Prepare with AI" : "Build document package"}
          </Button>
          <Button
            variant="secondary"
            disabled={busy || active || !pack || !selectedProfile}
            onClick={() =>
              void work("bundle", { applicationId, profileId: selectedProfile })
            }
          >
            Regenerate merged PDF
          </Button>
          {active && run && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void work("cancel", { runId: run.id })}
            >
              Cancel preparation
            </Button>
          )}
          {!active && run && ["FAILED", "CANCELLED"].includes(run.status) && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void work("retry", { runId: run.id })}
            >
              Retry failed step
            </Button>
          )}
        </div>
        <p className="text-meta text-muted">
          Regenerate merged PDF reuses the previous CV and letter PDFs with
          current supporting documents and profile order.
        </p>
        {run?.error && (
          <p role="alert" className="whitespace-pre-wrap text-sm text-danger">
            {run.error}
          </p>
        )}
        <GenerationProgress segments={run ? progressSegments(run.documentMode ?? data.documentMode, run.kind ?? "prepare", run.status, run.steps) : []} traces={data.generationTraces ?? []} active={active} currentCli={latex ? data.cli : undefined} incompleteHistory={data.preparations.some((preparation) => !data.generationTraces?.some((trace) => trace.id === preparation.jobId))} />
        {run && (
          <details>
          <summary className="cursor-pointer text-sm">Generation tasks</summary>
          <ol className="divide-y divide-line">
            {run.steps.map((step) => (
              <li key={step.name} className="py-3">
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="mr-3 text-muted">
                      {step.status.toLowerCase()}
                    </span>
                    {step.name}
                  </summary>
                  <div className="mt-2 flex flex-col gap-2 text-meta text-muted">
                    {step.attempts.map((attempt, index) => (
                      <div key={index}>
                        <time>
                          {new Date(attempt.startedAt).toLocaleString()}
                        </time>
                        {attempt.finishedAt
                          ? ` — ${((Date.parse(attempt.finishedAt) - Date.parse(attempt.startedAt)) / 1000).toFixed(1)}s`
                          : ` — ${((Date.now() - Date.parse(attempt.startedAt)) / 1000).toFixed(1)}s elapsed`}
                        {attempt.error && (
                          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-danger">
                            {attempt.error}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            ))}
          </ol>
          </details>
        )}
        {data.preparations.length > 1 && (
          <details>
            <summary className="cursor-pointer text-sm">
              Earlier preparations
            </summary>
            <ul className="mt-2 space-y-2 text-meta text-muted">
              {data.preparations.slice(1).map((earlier) => (
                <li key={earlier.id}>
                  {new Date(earlier.createdAt).toLocaleString()} ·{" "}
                  {earlier.status.toLowerCase()}
                  {earlier.error && (
                    <p className="text-danger">{earlier.error}</p>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      {pack && (
        <div className="flex flex-wrap items-center gap-3">
          <a
            className={buttonClassName("primary", "md")}
            href={`/api/artifacts/${pack.id}`}
          >
            Download {pack.fileName}
          </a>
          <Button
            variant="secondary"
            disabled={busy}
            aria-label="Open application folder"
            onClick={() => void work("reveal", { applicationId })}
          >
            <FolderOpen size={16} />
            Open folder
          </Button>
          <span className="text-meta text-muted">
            Version {pack.version} · {pack.pages} pages
          </span>
        </div>
      )}
      {pack && <ExportFiles applicationId={applicationId} packages={data.artifacts.filter((file) => file.role === "package").sort((a, b) => b.version - a.version)} disabled={active || busy} />}
      {data.artifacts.length > 0 && (
        <Card className="flex flex-col gap-4">
          <Select
            label="Review documents and source changes"
            value={file?.id ?? ""}
            onChange={(event) => setPreview(event.target.value)}
          >
            <option value="">Select an artifact</option>
            {data.artifacts.map((artifact) => (
              <option key={artifact.id} value={artifact.id}>
                {artifact.role} · version {artifact.version}
                {artifact.pages ? ` · ${artifact.pages} pages` : ""}
              </option>
            ))}
          </Select>
          {file && (
            <>
              <a
                href={`/api/artifacts/${file.id}`}
                className="text-sm underline"
              >
                Download selected artifact
              </a>
              <iframe
                title={`${file.role} preview`}
                src={`/api/artifacts/${file.id}?inline=1`}
                className="h-[680px] w-full rounded-control border border-line bg-white"
              />
            </>
          )}
        </Card>
      )}
      {latex && data.extracted?.warnings?.map((warning) => <p key={warning} role="status" className="text-sm text-muted">{warning}</p>)}
      {latex && applicationUrl && <Card className="flex flex-col gap-3">
        <a className={buttonClassName("primary", "md")} href={applicationUrl} target="_blank" rel="noopener noreferrer">Continue application</a>
        <p className="whitespace-pre-wrap text-sm">{data.extracted?.applicationInstructions}</p>
      </Card>}
      {latex && portalOnly && !email && !manualCompose && <Button variant="secondary" disabled={active} onClick={() => setManualCompose(true)}>Draft email manually</Button>}
      {latex && (!portalOnly || email || manualCompose) && (
        <section aria-label="Application email">
          <EmailTab
            applicationId={applicationId}
            units={units}
            renderUnit={({ children }) => <>{children}</>}
            history={null}
            writing={active}
            onWrite={() =>
              void work("compose", {
                applicationId,
                profileId: selectedProfile,
                cli: cli ?? data.cli,
              })
            }
            attachments={{
              resume: null,
              letter: null,
              profileRequired: true,
              ...(pack
                ? { package: { id: pack.id, fileName: pack.fileName! } }
                : {}),
            }}
            gmail={
              gmail
                ? { sender: gmail, sentBefore: data.emailThreadId !== null }
                : undefined
            }
          />
          {email && (
            <div className="px-4">
              <Button
                variant="secondary"
                onClick={() => {
                  setParts(email);
                  setEditEmail(!editEmail);
                }}
              >
                {editEmail ? "Close email editor" : "Edit email"}
              </Button>
              {editEmail && (
                <form
                  className="mt-4 flex flex-col gap-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void work("email", { applicationId, ...parts }).then(() =>
                      setEditEmail(false),
                    );
                  }}
                >
                  <Input
                    label="Recipient email"
                    type="email"
                    value={parts.to}
                    onChange={(event) =>
                      setParts({ ...parts, to: event.target.value })
                    }
                  />
                  <Input
                    label="Subject"
                    value={parts.subject}
                    onChange={(event) =>
                      setParts({ ...parts, subject: event.target.value })
                    }
                  />
                  <Textarea
                    label="Email body"
                    rows={10}
                    value={parts.body}
                    onChange={(event) =>
                      setParts({ ...parts, body: event.target.value })
                    }
                  />
                  <Button
                    type="submit"
                    className="self-start"
                    disabled={busy || active}
                  >
                    Save email
                  </Button>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
