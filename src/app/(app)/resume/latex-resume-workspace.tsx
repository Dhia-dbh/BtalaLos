"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { preparationRequest } from "@/components/preparation/client";
import { Button, buttonClassName } from "@/components/ui/button";
import type { BaseResumeResult, Project } from "@/lib/preparation/types";

type Preview = { url: string; fileName: string; pages: number };

export function LatexResumeWorkspace({
  project,
}: {
  project: Pick<Project, "repository" | "baseRef" | "cvPath" | "engine">;
}) {
  const [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const configured = Boolean(project.repository && project.cvPath);
  const busy = configured && !preview && !error;

  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    let url: string | undefined;
    void preparationRequest<BaseResumeResult>("base-resume", {}, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        const bytes = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        setPreview({ url, fileName: result.fileName, pages: result.pages });
      })
      .catch((error: Error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [configured, revision]);

  const rebuild = () => {
    setPreview(null);
    setError("");
    setRevision((current) => current + 1);
  };

  return (
    <>
      <PageHeader
        title="Base resume"
        description="Compiled from your configured LaTeX project. New LaTeX applications tailor this CV to the job."
        actions={
          <>
            <Button variant="secondary" disabled={!configured || busy} onClick={rebuild}>
              {error ? "Retry" : "Rebuild"}
            </Button>
            {preview ? (
              <a href={preview.url} download={preview.fileName} className={buttonClassName()}>
                Download PDF
              </a>
            ) : (
              <Button disabled>Download PDF</Button>
            )}
          </>
        }
      />
      <section aria-label="LaTeX resume" aria-busy={busy} className="flex flex-1 flex-col gap-4 border-t border-line p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {configured ? (
            <p className="break-all text-sm text-muted">
              {project.cvPath} · {project.baseRef}
              {preview && ` · ${preview.pages} ${preview.pages === 1 ? "page" : "pages"}`}
            </p>
          ) : (
            <p role="note" className="text-sm text-muted">
              Configure your LaTeX project in Settings to preview its CV.
            </p>
          )}
          <Link href="/settings?section=latex" className="text-sm text-muted underline underline-offset-2">
            Project settings
          </Link>
        </div>
        {configured && (
          <>
            {busy && <p role="status" className="text-sm text-muted">Compiling CV…</p>}
            {error && <p role="alert" className="whitespace-pre-wrap text-sm text-danger">{error}</p>}
            {preview && (
              <iframe
                title="Base resume PDF"
                src={preview.url}
                className="h-[680px] w-full flex-1 rounded-control border border-line bg-white"
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
