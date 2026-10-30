import "server-only";
import { googleConnection } from "./account";
import { loadSettings } from "@/lib/settings-data";
import { browserConnection, hostBrowser } from "@/lib/browser/service";
import type { GoogleConnection } from "./account";
import type { ReadMail } from "./gmail";

export async function mailConnection(): Promise<GoogleConnection> {
  const settings = await loadSettings();
  if (settings.gmailBackend !== "browser") return googleConnection();
  if (!settings.gmailBrowserEmail) return { status: "disconnected" };
  try {
    const status = await browserConnection("gmail");
    if (!status.connected || status.email !== settings.gmailBrowserEmail) return { status: "disconnected" };
    return { status: "connected", email: status.email, canSend: true, canRead: true, canUseCalendar: false, lastSyncAt: settings.gmailBrowserLastSync ? new Date(settings.gmailBrowserLastSync) : null, syncProblem: settings.gmailBrowserProblem };
  } catch { return { status: "disconnected" }; }
}
export async function readBrowserMailbox(email: string, signal?: AbortSignal): Promise<(ReadMail & { browserMessageId: string; browserThreadUrl: string })[]> {
  const result = await hostBrowser<{ urls: string[] }>("gmail-list", { account: email, query: "newer_than:21d -in:chats -category:promotions -category:social -in:spam -in:trash" }, signal);
  const mails: (ReadMail & { browserMessageId: string; browserThreadUrl: string })[] = [];
  for (const threadUrl of result.urls) {
    signal?.throwIfAborted();
    const result = await hostBrowser<{ mails: (Omit<ReadMail, "date"> & { date: string; browserMessageId: string; browserThreadUrl: string })[] }>("gmail-read", { account: email, threadUrl }, signal);
    for (const mail of result.mails) mails.push({ ...mail, date: new Date(mail.date) });
  }
  return mails;
}
