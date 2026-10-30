import type { Metadata } from "next";

import { loadDocumentMode, loadProject } from "@/lib/preparation/data";
import { loadProfile } from "@/lib/profile-data";
import { maxPages } from "@/lib/settings";
import { loadSettings } from "@/lib/settings-data";
import { loadThemes, loadThemeUsage } from "@/lib/theme-data";

import { ResumeWorkspace } from "./resume-workspace";
import { LatexResumeWorkspace } from "./latex-resume-workspace";

export const metadata: Metadata = { title: "Base resume" };

export default async function BaseResumePage() {
  if ((await loadDocumentMode()) === "LATEX") {
    const { repository, baseRef, cvPath, engine } = await loadProject();
    const project = { repository, baseRef, cvPath, engine };
    return <LatexResumeWorkspace key={JSON.stringify(project)} project={project} />;
  }
  const [profile, themes, settings, usage] = await Promise.all([loadProfile(), loadThemes(), loadSettings(), loadThemeUsage()]);
  return (
    <ResumeWorkspace
      profile={profile}
      themes={themes}
      usage={usage}
      baseThemeId={settings.baseThemeId}
      paper={settings.paper}
      includeReferences={settings.includeRefs}
      language={settings.resumeLanguage}
      maxPages={maxPages(settings.pageLimit)}
    />
  );
}
