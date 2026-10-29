import { PageHeader } from "@/components/page-header";
import { PreparationLibrary } from "@/components/preparation/library";
import { preparationLibrary } from "@/lib/preparation/data";
export const metadata = { title: "Application preparation" };
export default async function PreparationPage() {
  return (
    <>
      <PageHeader
        title="Application preparation"
        description="Your LaTeX project, supporting PDFs, and ordered application profiles."
      />
      <PreparationLibrary initial={await preparationLibrary()} />
    </>
  );
}
