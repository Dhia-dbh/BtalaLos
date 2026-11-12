"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formAnswersSchema, type FormAnswer } from "@/lib/application-type";
import { preparationRequest } from "./client";

export function JobFormAnswers({ applicationId }: { applicationId: string }) {
  const [answers, setAnswers] = useState<FormAnswer[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [customId, setCustomId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  useEffect(() => {
    let current = true;
    fetch(`/api/preparation/application?applicationId=${applicationId}`, { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (current) { setAnswers(formAnswersSchema.parse(data.formAnswers)); setLoaded(true); }
    }).catch((failure) => { if (current) setError(failure.message); });
    return () => { current = false; };
  }, [applicationId]);
  const update = (id: string, values: Partial<FormAnswer>) => {
    setSaved(false); setAnswers((current) => current.map((entry) => entry.id === id ? { ...entry, ...values } : entry));
  };
  const rewrite = async (entry: FormAnswer, operation: "grammar" | "reword" | "custom") => {
    setBusy(true); setError("");
    try {
      const result = await preparationRequest<{ answer: string }>("rewrite-answer", { applicationId, question: entry.question, answer: entry.answer, operation, instruction: operation === "custom" ? instruction : "" });
      update(entry.id, { answer: result.answer }); setCustomId(null); setInstruction("");
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  };
  return <section aria-label="Application form answers" className="grid gap-4 rounded-control border border-line p-4">
    <h3 className="font-medium">Application form answers</h3>
    <p className="text-sm text-muted">Save your questions and answers here. Review AI edits, then save changes.</p>
    {error && <p role="alert">{error}</p>}
    {saved && <p role="status">Answers saved.</p>}
    {answers.map((entry, index) => <fieldset key={entry.id} disabled={busy} className="grid gap-3 border-b border-line pb-4">
      <legend className="mb-2 text-sm font-medium">Question {index + 1}</legend>
      <Textarea label={`Question ${index + 1}`} value={entry.question} maxLength={4000} onChange={(event) => update(entry.id, { question: event.target.value })} />
      <Textarea label={`Answer ${index + 1}`} value={entry.answer} maxLength={20000} onChange={(event) => update(entry.id, { answer: event.target.value })} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!entry.answer} onClick={() => void rewrite(entry, "grammar")}>Correct grammatically</Button>
        <Button variant="secondary" disabled={!entry.answer} onClick={() => void rewrite(entry, "reword")}>Reword and improve</Button>
        <Button variant="secondary" disabled={!entry.answer} onClick={() => { setCustomId(entry.id); setInstruction(""); }}>Custom instruction</Button>
        <Button variant="text" onClick={() => { setAnswers((current) => current.filter((answer) => answer.id !== entry.id)); setSaved(false); }}>Remove question {index + 1}</Button>
      </div>
      {customId === entry.id && <div className="grid gap-2"><Textarea label={`Instruction for answer ${index + 1}`} value={instruction} maxLength={4000} onChange={(event) => setInstruction(event.target.value)} /><Button disabled={!instruction.trim()} onClick={() => void rewrite(entry, "custom")}>Apply instruction</Button><Button variant="text" onClick={() => setCustomId(null)}>Cancel instruction</Button></div>}
    </fieldset>)}
    <div className="flex flex-wrap gap-3">
      <Button disabled={busy || !loaded || answers.length >= 100} variant="secondary" onClick={() => { setAnswers((current) => [...current, { id: crypto.randomUUID(), question: "", answer: "" }]); setSaved(false); }}>Add question</Button>
      <Button disabled={busy || !loaded} onClick={async () => {
        setBusy(true); setError("");
        try { await preparationRequest("form-answers", { applicationId, answers }); setSaved(true); }
        catch (failure) { setError((failure as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "Working…" : "Save answers"}</Button>
    </div>
  </section>;
}
