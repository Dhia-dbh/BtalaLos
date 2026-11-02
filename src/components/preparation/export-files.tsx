"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "@/components/toast";
import type { ExportOptions, ExportPreview, ExportSelection } from "@/lib/preparation/export-types";
import { preparationRequest } from "./client";

type Pending = { input: ExportSelection; preview: ExportPreview };
export function ExportFiles({ applicationId, packages, disabled }: {
  applicationId: string;
  packages: { id: string; version: number }[];
  disabled: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const packageId = selected ?? packages[0]?.id;
  const [loaded, setLoaded] = useState<{ packageId: string; options: ExportOptions } | null>(null);
  const [groups, setGroups] = useState<number[][]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    if (!packageId) return;
    let cancelled = false;
    void preparationRequest<ExportOptions>("export-options", { applicationId, packageId }).then((options) => {
      if (cancelled) return;
      setLoaded({ packageId, options });
      setGroups(options.documents.map((document) => [document.index]));
      setError("");
    }).catch((failure: Error) => { if (!cancelled) setError(failure.message); });
    return () => { cancelled = true; };
  }, [applicationId, packageId]);
  const options = loaded?.packageId === packageId ? loaded.options : null;
  const locked = busy || disabled || pending !== null;
  const updateGroup = (index: number, group: number[]) => setGroups((current) => current.map((value, position) => position === index ? group : value));
  const write = async ({ input, preview }: Pending) => {
    setBusy(true);
    try {
      const options = await preparationRequest<ExportOptions>("export-files", { ...input, expected: preview.expected });
      setLoaded({ packageId: input.packageId, options });
      toast(`Files exported to v${options.version}.`);
      setError("");
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const preview = async () => {
    if (!packageId || !groups.length || locked) return;
    setBusy(true);
    setError("");
    try {
      const input = { applicationId, packageId, groups: groups.map((group) => [...group]) };
      const preview = await preparationRequest<ExportPreview>("export-preview", input);
      if (Object.values(preview.expected).some((checksum) => checksum !== null)) setPending({ input, preview });
      else await write({ input, preview });
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-serif text-section">Separate and grouped PDFs</h2>
      <p className="text-sm text-muted">Choose the documents and their order in each output file. Exports reuse this package's saved PDFs without AI generation. Files are saved in its application folder under v{options?.version ?? "N"}.</p>
      <Select label="Package version to export" value={packageId ?? ""} disabled={locked} onChange={(event) => setSelected(event.target.value)}>
        {packages.map((pack) => <option key={pack.id} value={pack.id}>Version {pack.version}</option>)}
      </Select>
      {error && <p role="alert" className="text-sm text-danger whitespace-pre-wrap">{error}</p>}
      {!options ? <p role="status" className="text-sm text-muted">Loading export documents…</p> : <>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={locked} onClick={() => setGroups(options.documents.map((document) => [document.index]))}>All separate</Button>
          <Button variant="secondary" disabled={locked} onClick={() => setGroups([options.documents.map((document) => document.index)])}>Single bundle</Button>
        </div>
        <ol className="flex flex-col gap-4">
          {groups.map((group, groupIndex) => (
            <li key={groupIndex} className="flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-sm break-all">BenHamouda_Dhia-{group.map((index) => options.documents[index].name).join("_")}.pdf</p>
              {group.map((documentIndex, position) => (
                <div key={position} className="flex flex-wrap items-end gap-2">
                  <Select label={`Output ${groupIndex + 1}, document ${position + 1}`} className="min-w-40 flex-1" value={documentIndex} disabled={locked}
                    onChange={(event) => updateGroup(groupIndex, group.map((value, index) => index === position ? Number(event.target.value) : value))}>
                    {options.documents.map((document) => <option key={document.index} value={document.index} disabled={group.includes(document.index) && document.index !== documentIndex}>{document.name}{document.pages ? ` (${document.pages} pages)` : ""}</option>)}
                  </Select>
                  <Button variant="secondary" size="sm" disabled={locked || position === 0} aria-label={`Move output ${groupIndex + 1} document ${position + 1} up`} onClick={() => {
                    const next = [...group];
                    [next[position - 1], next[position]] = [next[position], next[position - 1]];
                    updateGroup(groupIndex, next);
                  }}>↑</Button>
                  <Button variant="secondary" size="sm" disabled={locked || position === group.length - 1} aria-label={`Move output ${groupIndex + 1} document ${position + 1} down`} onClick={() => {
                    const next = [...group];
                    [next[position + 1], next[position]] = [next[position], next[position + 1]];
                    updateGroup(groupIndex, next);
                  }}>↓</Button>
                  <Button variant="text" size="sm" disabled={locked || group.length === 1} onClick={() => updateGroup(groupIndex, group.filter((_, index) => index !== position))}>Remove document</Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled={locked || group.length === options.documents.length} onClick={() => {
                  const document = options.documents.find((document) => !group.includes(document.index));
                  if (document) updateGroup(groupIndex, [...group, document.index]);
                }}>Add document to group</Button>
                <Button variant="text" size="sm" disabled={locked} onClick={() => setGroups(groups.filter((_, index) => index !== groupIndex))}>Remove output</Button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={locked || groups.length >= 30} onClick={() => setGroups([...groups, [0]])}>Add output group</Button>
          <Button disabled={locked || !groups.length} onClick={() => void preview()}>{busy ? "Exporting…" : "Export files"}</Button>
          <Button variant="secondary" disabled={locked || !options.exports.length} onClick={() => {
            void preparationRequest("reveal-export", { applicationId, packageId }).catch((failure: Error) => toast(failure.message));
          }}>Open version folder</Button>
        </div>
        {options.exports.length > 0 && <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Exported files in v{options.version}</h3>
          {options.exports.map((file) => <a key={file.id} href={`/api/artifacts/${file.id}`} className="text-sm underline break-all">{file.fileName}</a>)}
        </div>}
      </>}
      <ConfirmDialog open={pending !== null} onOpenChange={(open) => { if (!open) setPending(null); }} title="Replace existing export files?"
        description={<span className="whitespace-pre-wrap">{`These files already exist in this version's folder and will be replaced:\n${pending?.preview.fileNames.filter((name) => pending.preview.expected[name] !== null).join("\n") ?? ""}\nOther files will be kept.`}</span>}
        confirmLabel="Replace listed files" onConfirm={() => {
          if (!pending) return;
          const confirmed = pending;
          setPending(null);
          void write(confirmed);
        }} />
    </Card>
  );
}
