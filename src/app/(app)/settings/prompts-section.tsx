"use client";

import { useState } from "react";

import { SavedIndicator } from "@/components/saved-indicator";
import { useTrackSave } from "@/components/save-tracker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Textarea } from "@/components/ui/textarea";
import { useAutosave } from "@/hooks/use-autosave";
import { DEFAULT_GENERATION_PROMPTS, MAX_PROMPT_LENGTH, type GenerationPromptKey, type GenerationPrompts } from "@/lib/generation-prompts";

import { saveGenerationPrompt } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

const EDITORS = [
  { label: "CV prompt", native: "cvPrompt", latex: "latexCvPrompt" },
  { label: "Motivation letter prompt", native: "letterPrompt", latex: "latexLetterPrompt" },
  { label: "Email draft prompt", native: "emailPrompt", latex: "latexEmailPrompt" },
] as const;

export function PromptsSection({ initial, initialMode, nativeRules, latexRules }: {
  initial: GenerationPrompts;
  initialMode: "NATIVE" | "LATEX";
  nativeRules: string;
  latexRules: string;
}) {
  const [mode, setMode] = useState(initialMode);
  const [prompts, setPrompts] = useState(initial);

  return (
    <>
      <SettingsSectionIntro title="Generation prompts">
        Read and edit the instructions for your CV, motivation letter and email draft. Changes save automatically and apply to future generation. Existing documents stay as they are.
      </SettingsSectionIntro>
      <SegmentedControl
        aria-label="Document mode"
        options={[{ value: "NATIVE", label: "Built-in editor" }, { value: "LATEX", label: "LaTeX preparation" }]}
        value={mode}
        onValueChange={setMode}
      />
      <p className="text-sm text-muted">
        Profile information, job details and application notes are supplied automatically. Other relevant information from your profile is used when it helps with the job.
        {mode === "LATEX" && " LaTeX preparation also receives your source files and selected context documents. CV and letter instructions are sent together, each labelled for its document."}
      </p>
      {EDITORS.map((editor) => {
        const promptKey = mode === "NATIVE" ? editor.native : editor.latex;
        return (
          <PromptEditor
            key={promptKey}
            promptKey={promptKey}
            label={editor.label}
            value={prompts[promptKey]}
            onChange={(text) => setPrompts((current) => ({ ...current, [promptKey]: text }))}
          />
        );
      })}
      <details className="rounded-panel border border-line bg-card p-5 text-sm">
        <summary className="cursor-pointer font-medium">Rules added automatically</summary>
        <p className="mt-3 text-muted">These rules and the required output format are added separately to the editable instructions.</p>
        <pre className="mt-3 whitespace-pre-wrap font-sans leading-relaxed text-muted">{mode === "NATIVE" ? nativeRules : latexRules}</pre>
      </details>
    </>
  );
}

function PromptEditor({ promptKey, label, value, onChange }: {
  promptKey: GenerationPromptKey;
  label: string;
  value: string;
  onChange: (text: string) => void;
}) {
  const track = useTrackSave();
  const { status, savedAt, flush } = useAutosave(value, (text) => track(saveGenerationPrompt({ key: promptKey, text })));

  return (
    <Card className="flex flex-col gap-3">
      <Textarea
        label={label}
        rows={12}
        maxLength={MAX_PROMPT_LENGTH}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={flush}
        hint="Describe the content, tone, length and emphasis you want. Keep the output fields required by the default prompt."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" size="sm" disabled={value === DEFAULT_GENERATION_PROMPTS[promptKey]} onClick={() => onChange(DEFAULT_GENERATION_PROMPTS[promptKey])}>
          Restore default
        </Button>
        <SavedIndicator status={status} savedAt={savedAt} />
      </div>
    </Card>
  );
}
