"use client";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useTrackSave } from "@/components/save-tracker";
import { toastResult } from "@/components/toast";
import type { EmailDraftMode } from "@/lib/email-drafting";
import { updateSettings } from "./actions";
import { SettingsSectionIntro } from "./settings-screen";

export function EmailDraftingSection({ initial }: { initial: EmailDraftMode }) {
  const [mode, setMode] = useState(initial);
  const track = useTrackSave();
  return <>
    <SettingsSectionIntro title="Email drafting">Choose whether application preparation automatically drafts an email. Applications follow this setting unless you override it.</SettingsSectionIntro>
    <Card className="flex flex-col gap-4">
      <Select label="Automatic email drafting" value={mode} onChange={(event) => {
        const next = event.target.value as EmailDraftMode;
        const previous = mode;
        setMode(next);
        void track(updateSettings({ emailDraftMode: next })).then((result) => { if (!toastResult(result).ok) setMode(previous); });
      }}>
        <option value="AUTO">Auto</option>
        <option value="DISABLE">Disable</option>
        <option value="ENABLE">Enable</option>
      </Select>
      <p className="text-sm text-muted">Auto drafts only when the posting explicitly accepts applications by email, including postings that accept either email or a portal. Portal-only and unclear instructions are skipped.</p>
      <p className="text-sm text-muted">Changing this setting does not restart earlier jobs. Active jobs and their retries keep their original choice. You can always draft an email manually.</p>
    </Card>
  </>;
}
