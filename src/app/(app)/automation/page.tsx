import type { Metadata } from "next";
import { BrowserRuns } from "@/components/browser/runs";

export const metadata: Metadata = { title: "Application automation" };
export default function AutomationPage() {
  return <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-5 sm:p-8"><h1 className="font-serif text-page">Application automation</h1><BrowserRuns /></div>;
}
