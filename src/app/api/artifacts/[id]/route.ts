import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/route";
import { verifiedBytes } from "@/lib/preparation/storage";
import { contentDisposition } from "@/lib/file-name";

export const GET = route<RouteContext<"/api/artifacts/[id]">>(
  async (request, { params }) => {
    const { id } = await params;
    const file =
      (await prisma.applicationArtifact.findUnique({ where: { id } })) ??
      (await prisma.supportingDocumentVersion.findUnique({ where: { id } }));
    if (!file)
      return NextResponse.json(
        { error: "Artifact not found." },
        { status: 404 },
      );
    const isPdf = file.path.endsWith(".pdf");
    const fileName =
      "manifest" in file
        ? ((file.manifest as { fileName?: string }).fileName ??
          `${file.role}.${isPdf ? "pdf" : "txt"}`)
        : "supporting-document.pdf";
    return new Response(await verifiedBytes(file), {
      headers: {
        "content-type": isPdf ? "application/pdf" : "text/plain; charset=utf-8",
        "content-disposition": request.nextUrl.searchParams.has("inline")
          ? "inline"
          : contentDisposition(fileName),
        "x-artifact-checksum": file.checksum,
      },
    });
  },
);
