"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { matchSchema, type Match } from "@/lib/application-data";
import { preparationRequest } from "./client";

export function RequirementsAssessment({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [match, setMatch] = useState<Match | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let current = true;
    fetch(`/api/preparation/application?applicationId=${applicationId}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (current) setMatch(data.match ? matchSchema.parse(data.match) : null);
    }).catch((failure) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [applicationId]);
  return <section aria-label="Requirements assessment" className="grid gap-3 rounded-control border border-line p-4">
    <h3 className="font-medium">Requirements assessment</h3>
    {match ? match.items.length ? <ul className="grid gap-3">{match.items.map((item, index) => <li key={index}><p>{item.requirement} · <strong>{item.result}</strong></p><p className="text-sm text-muted">{item.note}</p></li>)}</ul> : <p>No requirements were extracted.</p> : <p>Not assessed. This does not indicate a gap.</p>}
    {error && <p role="alert">{error}</p>}
    <Button disabled={busy} variant="secondary" onClick={async () => {
      setBusy(true); setError("");
      try { const result = await preparationRequest<{ match: Match }>("match", { applicationId }); setMatch(result.match); router.refresh(); }
      catch (failure) { setError((failure as Error).message); }
      finally { setBusy(false); }
    }}>{busy ? "Assessing…" : match ? "Reassess requirements" : "Assess requirements"}</Button>
  </section>;
}
