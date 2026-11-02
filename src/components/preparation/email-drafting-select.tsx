"use client";
import { Select } from "@/components/ui/select";
import type { EmailDraftMode } from "@/lib/email-drafting";

export function EmailDraftingSelect({ value, globalMode, onChange, disabled }: {
  value: EmailDraftMode | null;
  globalMode: EmailDraftMode;
  onChange: (value: EmailDraftMode | null) => void;
  disabled?: boolean;
}) {
  return (
    <Select label="Automatic email drafting" value={value ?? "GLOBAL"} disabled={disabled}
      onChange={(event) => onChange(event.target.value === "GLOBAL" ? null : event.target.value as EmailDraftMode)}
      hint="Auto drafts only when the posting explicitly accepts email applications. Manual drafting remains available.">
      <option value="GLOBAL">Use global setting ({globalMode.toLowerCase()})</option>
      <option value="AUTO">Auto</option>
      <option value="DISABLE">Disable</option>
      <option value="ENABLE">Enable</option>
    </Select>
  );
}
