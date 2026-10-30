"use client";
import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/toast";
import type { SettingsData } from "@/lib/settings";
import type { BrowserModel } from "@/lib/browser/ai";
import { browserRequest } from "./client";

export type BrowserSettingsView = Pick<SettingsData, "browserEnabled" | "browserAi" | "applicationSubmissionMode" | "replySubmissionMode" | "gmailBackend" | "gmailReadingMode" | "gmailAutoDraft" | "gmailRead" | "gmailScope" | "gmailInterval" | "gmailFilters">;
export function BrowserSettings({ initial, keySet, email, lastSkipped }: { initial: BrowserSettingsView; keySet: boolean; email: string; lastSkipped: SettingsData["gmailLastSkipped"] }) {
  const [settings, setSettings] = useState(initial), [apiKey, setApiKey] = useState(""), [clearKey, setClearKey] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const dirty = JSON.stringify(settings) !== saved || Boolean(apiKey) || clearKey;
  const [models, setModels] = useState<BrowserModel[]>([]), [busy, setBusy] = useState(false);
  const updateAi = (change: Partial<BrowserSettingsView["browserAi"]>) => { setSettings({ ...settings, browserAi: { ...settings.browserAi, ...change } }); setModels([]); };
  const work = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (error) { toast((error as Error).message); } finally { setBusy(false); } };
  return <div className="flex flex-col gap-5">
    <p className="text-sm text-muted">Automate portal applications and use a signed-in host browser for Gmail. <Link href="/settings?section=prompts" className="underline">Edit automation prompts</Link>.</p>
    <Card className="flex flex-col gap-4">
      <Checkbox label="Enable browser automation" checked={settings.browserEnabled} onChange={(event) => setSettings({ ...settings, browserEnabled: event.target.checked })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Application submission" value={settings.applicationSubmissionMode} onChange={(event) => setSettings({ ...settings, applicationSubmissionMode: event.target.value as "review" | "automatic" })}><option value="review">Review before submitting</option><option value="automatic">Submit automatically</option></Select>
        <Select label="Reply submission" value={settings.replySubmissionMode} onChange={(event) => setSettings({ ...settings, replySubmissionMode: event.target.value as "review" | "automatic" })}><option value="review">Review each reply</option><option value="automatic">Send automatically</option></Select>
      </div>
      <p className="text-meta text-muted">Review mode fills and advances through portal pages, then pauses for your approval here. Portals may save intermediate steps. Login and verification are completed in the host browser.</p>
    </Card>
    <Card className="flex flex-col gap-4">
      <h2 className="font-serif text-section">Browser AI</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="AI source" value={settings.browserAi.source} onChange={(event) => updateAi({ source: event.target.value as "cli" | "provider", provider: event.target.value === "cli" ? "codex" : "LOCAL", model: "", effort: "default" })}><option value="cli">Host coding CLI</option><option value="provider">AI provider or local model</option></Select>
        <Select label="Browser provider" value={settings.browserAi.provider} onChange={(event) => updateAi({ provider: event.target.value as BrowserSettingsView["browserAi"]["provider"], model: "", effort: "default" })}>
          {(settings.browserAi.source === "cli" ? [["codex", "Codex"], ["claude", "Claude Code"]] : [["LOCAL", "Local (Ollama / compatible)"], ["OPENAI", "OpenAI compatible"], ["LMSTUDIO", "LM Studio"], ["ANTHROPIC", "Anthropic"], ["MISTRAL", "Mistral"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </Select>
        {settings.browserAi.source === "provider" && <><Input label="Browser AI endpoint" value={settings.browserAi.baseUrl} onChange={(event) => updateAi({ baseUrl: event.target.value })} /><Input label={`Browser AI key${keySet ? " (saved; leave empty to keep)" : " (optional for local servers)"}`} type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /><Checkbox label="Remove saved browser AI key" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} /></>}
        {models.length ? <Select label="Browser model" value={settings.browserAi.model} onChange={(event) => setSettings({ ...settings, browserAi: { ...settings.browserAi, model: event.target.value, effort: "default" } })}><option value="">Select a model</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</Select> : <Input label="Browser model" value={settings.browserAi.model} onChange={(event) => updateAi({ model: event.target.value })} />}
        <Select label="Browser thinking" value={settings.browserAi.effort} onChange={(event) => setSettings({ ...settings, browserAi: { ...settings.browserAi, effort: event.target.value as BrowserSettingsView["browserAi"]["effort"] } })}><option value="default">Model default</option>{[...new Set([...(models.find((model) => model.id === settings.browserAi.model)?.efforts ?? []), ...(settings.browserAi.effort !== "default" ? [settings.browserAi.effort] : [])])].map((effort) => <option key={effort} value={effort}>{effort}</option>)}</Select>
      </div>
      <Button variant="secondary" disabled={busy} onClick={() => void work(async () => { setModels(await browserRequest<BrowserModel[]>("models", { ...settings.browserAi, ...(apiKey ? { apiKey } : {}) })); toast("Browser model catalog loaded."); })}>Load models</Button>
      <p className="text-meta text-muted">These settings are independent of document preparation. To reuse a document model, select the same provider and model explicitly.</p>
    </Card>
    <Card className="flex flex-col gap-4">
      <h2 className="font-serif text-section">Gmail</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Gmail backend" value={settings.gmailBackend} onChange={(event) => setSettings({ ...settings, gmailBackend: event.target.value as "api" | "browser" })}><option value="api">Gmail API</option><option value="browser">Playwright browser</option></Select>
        <Select label="Email reading" value={settings.gmailReadingMode} onChange={(event) => setSettings({ ...settings, gmailReadingMode: event.target.value as "manual" | "scheduled" })}><option value="manual">Manual only</option><option value="scheduled">Scheduled</option></Select>
        <Select label="Read every" value={settings.gmailInterval} onChange={(event) => setSettings({ ...settings, gmailInterval: Number(event.target.value) })}>{[5, 10, 15, 30, 60, 120].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}</Select>
        <Select label="Messages to consider" value={settings.gmailScope} onChange={(event) => setSettings({ ...settings, gmailScope: event.target.value as "known" | "all" })}><option value="known">Known application threads and companies</option><option value="all">All incoming messages</option></Select>
      </div>
      <Checkbox label="Read replies" checked={settings.gmailRead} onChange={(event) => setSettings({ ...settings, gmailRead: event.target.checked })} />
      <Checkbox label="Automatically draft replies that need an answer" checked={settings.gmailAutoDraft} onChange={(event) => setSettings({ ...settings, gmailAutoDraft: event.target.checked })} />
      <p className="text-meta text-muted">Drafts cover questions, interview invitations, and offers. Rejections and automatic acknowledgements are skipped. Calendar continues to use the optional Google API connection.</p>
      <Link href="/settings?section=google" className="text-sm underline">Google API and Calendar settings</Link>
      <Button variant="secondary" disabled={busy} onClick={() => void work(async () => { const { checkInbox } = await import("@/lib/google/actions"); const result = await checkInbox({}); if (!result.ok) throw new Error(result.error); toast(result.toast ?? "Email reading finished."); })}>Read now</Button>
      <p className="text-meta text-muted">Verified browser account: {email || "Not connected"}</p>
    </Card>
    <Card className="flex flex-col gap-4">
      <h2 className="font-serif text-section">Exclude emails</h2>
      <p className="text-meta text-muted">One phrase per line. Any match ignores the message in BtalaLos before AI reading. Matches ignore letter case. Gmail messages are left unchanged.</p>
      {settings.gmailFilters.map((filter, index) => <div key={filter.id} className="flex flex-col gap-3 rounded-panel border border-line p-4">
        <Select label={`Filter ${index + 1}: look in`} value={filter.target} onChange={(event) => setSettings({ ...settings, gmailFilters: settings.gmailFilters.map((entry) => entry.id === filter.id ? { ...entry, target: event.target.value as "subject" | "body" | "both" } : entry) })}><option value="subject">Subject</option><option value="body">Body</option><option value="both">Subject and body</option></Select>
        <Textarea label={`Filter ${index + 1}: words or phrases`} value={filter.phrases.join("\n")} onChange={(event) => setSettings({ ...settings, gmailFilters: settings.gmailFilters.map((entry) => entry.id === filter.id ? { ...entry, phrases: event.target.value.split("\n") } : entry) })} />
        <Button variant="secondary" onClick={() => setSettings({ ...settings, gmailFilters: settings.gmailFilters.filter((entry) => entry.id !== filter.id) })}>Remove filter</Button>
      </div>)}
      <Button variant="secondary" onClick={() => setSettings({ ...settings, gmailFilters: [...settings.gmailFilters, { id: crypto.randomUUID(), target: "subject", phrases: [""] }] })}>Add exclusion filter</Button>
      <p className="text-meta text-muted">Last reading skipped {lastSkipped.reduce((sum, entry) => sum + entry.count, 0)} messages. {lastSkipped.map((entry) => `${entry.rules.join(", ")}: ${entry.count}`).join("; ")}</p>
    </Card>
    <p role="status" className="text-sm text-muted">{dirty ? "Unsaved automation changes. Save settings to apply them." : "Automation settings saved. Changes apply to new runs."}</p>
    <Button disabled={busy || !dirty} onClick={() => void work(async () => { const next = { ...settings, gmailFilters: settings.gmailFilters.map((filter) => ({ ...filter, phrases: filter.phrases.map((phrase) => phrase.trim()).filter(Boolean) })) }; await browserRequest("settings", { ...next, ...(apiKey ? { apiKey } : {}), clearKey }); setSettings(next); setSaved(JSON.stringify(next)); setApiKey(""); setClearKey(false); toast("Browser and mail settings saved."); })}>{busy ? "Working…" : "Save settings"}</Button>
    <Card className="flex flex-col gap-4"><h2 className="font-serif text-section">Host browsers</h2><p className="text-sm text-muted">Open the dedicated browser, sign in yourself, then connect Playwright. Gmail must use English. The browser opens on the computer running BtalaLos.</p><BrowserProfile profile="portals" /><BrowserProfile profile="gmail" /></Card>
  </div>;
}
function BrowserProfile({ profile }: { profile: "gmail" | "portals" }) {
  const [status, setStatus] = useState("Not checked"), [busy, setBusy] = useState(false);
  const act = async (command: "open" | "connect" | "status") => {
    setBusy(true);
    try {
      const response = command === "status" ? await fetch(`/api/browser/connection?profile=${profile}`) : null;
      const result = response ? await response.json() : await browserRequest<{ connected: boolean; email?: string }>(command, { profile });
      if (result.error) throw new Error(result.error);
      setStatus(result.connected ? `Connected${result.email ? ` as ${result.email}` : ""}` : result.opened ? "Open; sign in, then connect" : "Closed");
    } catch (error) { setStatus((error as Error).message); } finally { setBusy(false); }
  };
  return <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4"><span className="min-w-20 font-medium">{profile === "gmail" ? "Gmail" : "Portals"}</span><Button variant="secondary" disabled={busy} onClick={() => void act("open")}>Open browser</Button><Button variant="secondary" disabled={busy} onClick={() => void act("connect")}>Connect</Button><Button variant="secondary" disabled={busy} onClick={() => void act("status")}>Check</Button><p role="status" className="w-full text-sm text-muted">{status}</p></div>;
}
