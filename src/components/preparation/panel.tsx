"use client";
import Link from "next/link";
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
  company: string;
  role: string;
  deadline: string | null;
  postingText: string;
  extracted: {
    recruiterEmail?: string | null;
    applicationUrl?: string | null;
    applicationMethod?: string | null;
    applicationInstructions?: string | null;
    warnings?: string[];
    keywords?: string[];
    manualMetadata?: { recruiterEmail?: string | null };
  } | null;
  packageProfileId: string | null;
  emailThreadId: string | null;
  profiles: { id: string; name: string }[];
  preparations: {
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
  const [editEmail, setEditEmail] = useState(false),
    [parts, setParts] = useState({ to: "", subject: "", body: "" });
  const [editMetadata, setEditMetadata] = useState(false),
    [metadata, setMetadata] = useState({
      company: "",
      role: "",
      deadline: "",
      recruiterEmail: "",
      postingText: "",
    });
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
    ) ?? false;
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
  const showMetadata = () => {
    setMetadata({
      company: data.company,
      role: data.role,
      deadline: data.deadline?.slice(0, 10) ?? "",
      recruiterEmail:
        data.extracted?.manualMetadata?.recruiterEmail ??
        data.extracted?.recruiterEmail ??
        "",
      postingText: data.postingText,
    });
    setEditMetadata(!editMetadata);
  };
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto bg-canvas p-5 sm:p-8">
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
        {run && (
          <ol className="divide-y divide-line">
            {run.steps.map((step) => (
              <li key={step.name} className="py-3">
                <details open={step.status !== "DONE"}>
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
      {latex && (
        <Card className="flex flex-col gap-4">
          <div className="flex flex-wrap justify-between gap-3">
            <h2 className="font-serif text-section">Job details</h2>
            <Button variant="text" disabled={active} onClick={showMetadata}>
              {editMetadata ? "Close editing" : "Edit details"}
            </Button>
          </div>
          {data.extracted?.keywords?.length ? (
            <p className="text-sm text-muted">
              Keywords: {data.extracted.keywords.join(", ")}
            </p>
          ) : null}
          {data.extracted?.applicationMethod && (
            <p className="text-sm">
              Application method: {data.extracted.applicationMethod}
            </p>
          )}
          {data.extracted?.applicationInstructions && (
            <p className="whitespace-pre-wrap text-sm">
              {data.extracted.applicationInstructions}
            </p>
          )}
          {applicationUrl && (
            <div className="flex flex-col items-start gap-2">
              <a
                className={buttonClassName("primary", "md")}
                href={applicationUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Continue application
              </a>
              <p className="break-all text-meta text-muted">{applicationUrl}</p>
              {portalOnly && (
                <p className="text-sm text-muted">
                  Submit your prepared documents through this link.
                </p>
              )}
            </div>
          )}
          {data.extracted?.warnings?.map((warning) => (
            <p key={warning} role="status" className="text-sm text-muted">
              {warning}
            </p>
          ))}
          {editMetadata ? (
            <form
              className="grid gap-3 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void work("metadata", { applicationId, ...metadata }).then(() =>
                  setEditMetadata(false),
                );
              }}
            >
              {(["company", "role", "deadline", "recruiterEmail"] as const).map(
                (key) => (
                  <Input
                    key={key}
                    label={
                      {
                        company: "Company",
                        role: "Role",
                        deadline: "Deadline",
                        recruiterEmail: "Recruiter email",
                      }[key]
                    }
                    type={
                      key === "deadline"
                        ? "date"
                        : key === "recruiterEmail"
                          ? "email"
                          : "text"
                    }
                    value={metadata[key]}
                    onChange={(event) =>
                      setMetadata({ ...metadata, [key]: event.target.value })
                    }
                  />
                ),
              )}
              <Textarea
                className="sm:col-span-2"
                label="Original posting"
                rows={7}
                value={metadata.postingText}
                onChange={(event) =>
                  setMetadata({ ...metadata, postingText: event.target.value })
                }
              />
              <Button type="submit" disabled={busy}>
                Save job details
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted">
              {data.role || "Role not extracted"} ·{" "}
              {data.company || "Company not extracted"}
              {data.deadline ? ` · Deadline ${data.deadline.slice(0, 10)}` : ""}
            </p>
          )}
        </Card>
      )}
      {latex && !portalOnly && (
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
