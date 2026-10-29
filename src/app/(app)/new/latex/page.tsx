import { PageHeader } from "@/components/page-header";
import { NewLatex } from "@/components/preparation/new-latex";
import { loadProject } from "@/lib/preparation/data";
import { projectSchema } from "@/lib/preparation/types";
import { prisma } from "@/lib/prisma";
import { postingText } from "@/lib/job-search/search";
import { getStartup, startupPostingText } from "@/lib/startups/store";
export const metadata = { title: "New LaTeX application" };
export default async function NewLatexPage({
  searchParams,
}: PageProps<"/new/latex">) {
  const { posting, startup } = await searchParams;
  const project = await loadProject();
  const profiles = await prisma.applicationProfile.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const source =
    typeof posting === "string"
      ? await prisma.posting.findUnique({ where: { id: posting } })
      : null;
  const startupSource =
    typeof startup === "string" ? await getStartup(startup) : null;
  return (
    <>
      <PageHeader
        title="New LaTeX application"
        description="Tailor your existing CV and cover letter to a job posting."
      />
      <NewLatex
        profiles={profiles}
        initialCli={project}
        configured={projectSchema.safeParse(project).success}
        initialPosting={
          source
            ? postingText(source)
            : startupSource
              ? startupPostingText(startupSource)
              : ""
        }
        initialUrl={source?.url ?? startupSource?.website ?? ""}
      />
    </>
  );
}
