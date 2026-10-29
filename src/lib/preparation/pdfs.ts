import "server-only";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { verifiedBytes } from "./storage";

export async function storedApplicationPdf(
  applicationId: string,
  role: "cv" | "letter" | "package",
) {
  const pack = await prisma.applicationArtifact.findFirst({
    where: { applicationId, role: "package" },
    orderBy: { version: "desc" },
  });
  if (!pack)
    throw new ActionError(
      "Prepare an application package before downloading its PDFs.",
    );
  const manifest = pack.manifest as {
    cv: string;
    letter: string;
    fileName: string;
  };
  const file =
    role === "package"
      ? pack
      : await prisma.applicationArtifact.findFirst({
          where: { id: manifest[role], applicationId, role },
        });
  if (!file)
    throw new ActionError(
      "The saved package is missing its generated document.",
    );
  return {
    pdf: await verifiedBytes(file),
    fileName: role === "package" ? manifest.fileName : `${role}.pdf`,
  };
}
