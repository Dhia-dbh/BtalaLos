import { NextResponse } from "next/server";
import { z } from "zod";
import { route } from "@/lib/route";
import { ActionError } from "@/lib/action";
import { prisma } from "@/lib/prisma";
import { startJob, cancelJob } from "@/lib/jobs/runner";
import {
  prepareApplicationJob,
  queuePreparation,
  latestPackage,
} from "@/lib/preparation/service";
import { preparationLibrary, loadProject } from "@/lib/preparation/data";
import {
  bundleSchema,
  documentModeSchema,
  cliOptionsSchema,
  projectSchema,
  type Step,
  type PdfResult,
} from "@/lib/preparation/types";
import { checksum, workerOperation } from "@/lib/preparation/worker";
import { saveBytes, verifiedBytes } from "@/lib/preparation/storage";
import { emailUnits } from "@/lib/application-email";

const applicationIdSchema = z.object({ applicationId: z.string().min(1) });
const errorResponse = (error: unknown) =>
  NextResponse.json(
    {
      error:
        error instanceof z.ZodError
          ? z.prettifyError(error)
          : error instanceof Error
            ? error.message
            : "Operation failed.",
    },
    { status: error instanceof RangeError ? 413 : 422 },
  );
export const GET = route<RouteContext<"/api/preparation/[action]">>(
  async (request, { params }) => {
    try {
      const { action } = await params;
      if (action === "library")
        return NextResponse.json(await preparationLibrary());
      if (action !== "application")
        return NextResponse.json(
          { error: "Unknown preparation route." },
          { status: 404 },
        );
      const id = z
        .string()
        .min(1)
        .parse(request.nextUrl.searchParams.get("applicationId"));
      const application = await prisma.application.findUnique({
        where: { id },
        select: {
          id: true,
          documentMode: true,
          packageProfileId: true,
          company: true,
          role: true,
          postingText: true,
          extracted: true,
          deadline: true,
          status: true,
          title: true,
          emailThreadId: true,
          documents: { where: { kind: "EMAIL" }, select: { units: true } },
          preparations: { orderBy: { createdAt: "desc" }, take: 20 },
          artifacts: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              role: true,
              version: true,
              checksum: true,
              pages: true,
              createdAt: true,
              manifest: true,
            },
          },
        },
      });
      if (!application)
        return NextResponse.json(
          { error: "Application not found." },
          { status: 404 },
        );
      const { profiles, project } = await preparationLibrary();
      const currentProject = (
        application.preparations[0]?.snapshot as
          | { project?: { provider: string; model: string; effort: string } }
          | undefined
      )?.project;
      return NextResponse.json({
        ...application,
        profiles,
        cli: {
          provider: currentProject?.provider ?? project.provider,
          model: currentProject?.model ?? project.model,
          effort: currentProject?.effort ?? project.effort,
        },
        preparations: application.preparations.map((run) => ({
          id: run.id,
          kind: run.kind,
          status: run.status,
          error: run.error,
          createdAt: run.createdAt,
          finishedAt: run.finishedAt,
          steps: (run.steps as unknown as Step[]).map(
            ({ name, status, attempts }) => ({ name, status, attempts }),
          ),
        })),
        artifacts: application.artifacts.map(({ manifest, ...file }) => ({
          ...file,
          fileName: (manifest as { fileName?: string }).fileName,
        })),
      });
    } catch (error) {
      return errorResponse(error);
    }
  },
);
export const POST = route<RouteContext<"/api/preparation/[action]">>(
  async (request, { params }) => {
    try {
      const { action } = await params;
      if (action === "upload") {
        if (Number(request.headers.get("content-length")) > 26 * 1024 * 1024)
          throw new RangeError("Upload exceeds 25 MiB.");
        const form = await request.formData();
        const name = z.string().trim().min(1).max(200).parse(form.get("name"));
        const file = form.get("file");
        if (
          !(file instanceof File) ||
          file.size > 25 * 1024 * 1024 ||
          file.size === 0
        )
          throw new ActionError("Choose a PDF under 25 MiB.");
        const bytes = Buffer.from(await file.arrayBuffer());
        const validated = await workerOperation<PdfResult>(
          `upload-${checksum(bytes)}`,
          {
            kind: "pdf",
            documents: [
              { data: bytes.toString("base64"), checksum: checksum(bytes) },
            ],
          },
        );
        const stored = await saveBytes(bytes);
        const existingId = form.get("documentId");
        const version = Number(form.get("version"));
        const saved = await prisma.$transaction(async (tx) => {
          let document;
          if (existingId) {
            document = await tx.supportingDocument.findFirstOrThrow({
              where: { id: String(existingId), deletedAt: null },
            });
            const latest = await tx.supportingDocumentVersion.findFirstOrThrow({
              where: { documentId: document.id },
              orderBy: { version: "desc" },
            });
            if (latest.version !== version)
              throw new ActionError(
                "The document changed. Refresh before replacing it.",
              );
            await tx.supportingDocument.update({
              where: { id: document.id },
              data: { name },
            });
          } else
            document = await tx.supportingDocument.create({ data: { name } });
          await tx.supportingDocumentVersion.create({
            data: {
              documentId: document.id,
              version: existingId ? version + 1 : 1,
              ...stored,
              pages: validated.pages,
            },
          });
          return document;
        });
        return NextResponse.json(saved);
      }
      if (Number(request.headers.get("content-length")) > 1024 * 1024)
        throw new RangeError("Request exceeds 1 MiB.");
      const input = await request.json();
      if (action === "document-mode") {
        const { documentMode } = z
          .object({ documentMode: documentModeSchema })
          .parse(input);
        await prisma.setting.upsert({
          where: { key: "applicationDocumentMode" },
          create: { key: "applicationDocumentMode", value: documentMode },
          update: { value: documentMode },
        });
      } else if (action === "config") {
        const project = projectSchema.parse(input);
        await workerOperation(`config-${Date.now()}`, {
          kind: "inspect",
          ...project,
        });
        await prisma.setting.upsert({
          where: { key: "latexProject" },
          create: { key: "latexProject", value: JSON.stringify(project) },
          update: { value: JSON.stringify(project) },
        });
      } else if (action === "directories") {
        const data = z
          .object({ directory: z.string().min(1).optional() })
          .parse(input);
        return NextResponse.json(
          await workerOperation(`directories-${Date.now()}`, {
            kind: "directories",
            ...data,
          }),
        );
      } else if (action === "repository") {
        const data = z.object({ repository: z.string().min(1) }).parse(input);
        return NextResponse.json(
          await workerOperation(`repository-${Date.now()}`, {
            kind: "repository",
            ...data,
          }),
        );
      } else if (action === "capabilities") {
        const { provider } = z
          .object({ provider: z.enum(["codex", "claude"]) })
          .parse(input);
        return NextResponse.json(
          await workerOperation(`capabilities-${provider}-${Date.now()}`, {
            kind: "capabilities",
            provider,
          }),
        );
      } else if (action === "profile") {
        const { id, name, items, version } = z
          .object({
            id: z.string().optional(),
            name: z.string().trim().min(1).max(100),
            items: bundleSchema,
            version: z.number().optional(),
          })
          .parse(input);
        const ids = items.flatMap((item) =>
          item.role === "supporting" ? [item.documentId] : [],
        );
        if (
          (await prisma.supportingDocument.count({
            where: { id: { in: ids }, deletedAt: null },
          })) !== new Set(ids).size
        )
          throw new ActionError("A selected supporting document is missing.");
        if (id) {
          const result = await prisma.applicationProfile.updateMany({
            where: { id, version },
            data: { name, items, version: { increment: 1 } },
          });
          if (!result.count)
            throw new ActionError("Profile changed. Refresh before saving.");
        } else
          await prisma.applicationProfile.create({ data: { name, items } });
      } else if (action === "delete-profile") {
        const { id } = z.object({ id: z.string() }).parse(input);
        if (await prisma.application.count({ where: { packageProfileId: id } }))
          throw new ActionError(
            "Remove this profile from applications before deleting it.",
          );
        await prisma.applicationProfile.delete({ where: { id } });
      } else if (action === "delete-document") {
        const { id } = z.object({ id: z.string() }).parse(input);
        const profiles = await prisma.applicationProfile.findMany();
        if (
          profiles.some((profile) =>
            bundleSchema
              .parse(profile.items)
              .some(
                (item) => item.role === "supporting" && item.documentId === id,
              ),
          ) ||
          (await loadProject()).contextDocumentIds.includes(id)
        )
          throw new ActionError(
            "Remove this document from profiles and context before deleting it.",
          );
        await prisma.supportingDocument.update({
          where: { id },
          data: { deletedAt: new Date() },
        });
      } else if (action === "create") {
        const data = z
          .object({
            posting: z.string().trim().min(1).max(100_000),
            profileId: z.string().min(1),
            instructions: z.string().max(4000),
            cli: cliOptionsSchema.optional(),
            postingUrl: z
              .union([z.literal(""), z.url({ protocol: /^https?$/ })])
              .default(""),
          })
          .parse(input);
        const profile = await prisma.applicationProfile.findUniqueOrThrow({
          where: { id: data.profileId },
        });
        const application = await prisma.application.create({
          data: {
            documentMode: "LATEX",
            packageProfileId: profile.id,
            postingText: data.posting,
            postingUrl: data.postingUrl,
            title: "Preparing LaTeX application",
          },
        });
        try {
          await queuePreparation(
            application.id,
            "prepare",
            data.instructions,
            data.cli,
          );
        } catch (error) {
          await prisma.preparationRun.create({
            data: {
              applicationId: application.id,
              kind: "prepare",
              status: "FAILED",
              snapshot: {},
              error:
                error instanceof Error
                  ? error.message
                  : "Unable to start preparation.",
            },
          });
        }
        return NextResponse.json({ id: application.id });
      } else if (
        action === "prepare" ||
        action === "bundle" ||
        action === "compose"
      ) {
        const { applicationId, profileId, instructions, cli } = z
          .object({
            applicationId: z.string(),
            profileId: z.string().min(1),
            instructions: z.string().max(4000).default(""),
            cli: cliOptionsSchema.optional(),
          })
          .parse(input);
        if (
          await prisma.preparationRun.count({
            where: { activeKey: applicationId },
          })
        )
          throw new ActionError("Preparation is already active.");
        await prisma.application.update({
          where: { id: applicationId },
          data: { packageProfileId: profileId },
        });
        await queuePreparation(
          applicationId,
          action === "bundle"
            ? "bundle"
            : action === "compose"
              ? "email"
              : "prepare",
          instructions,
          cli,
        );
      } else if (action === "retry") {
        const { runId } = z.object({ runId: z.string() }).parse(input);
        const run = await prisma.preparationRun.findUniqueOrThrow({
          where: { id: runId },
        });
        if ((run.snapshot as { restored?: boolean }).restored)
          throw new ActionError(
            "Start a fresh preparation after restoring an archive; imported history cannot resume host operations.",
          );
        if (
          !["FAILED", "CANCELLED"].includes(run.status) ||
          !(run.snapshot as { items?: unknown }).items
        )
          throw new ActionError(
            "Start a fresh preparation with current configuration.",
          );
        const result = await prisma.preparationRun.updateMany({
          where: { id: runId, status: run.status, activeKey: null },
          data: { activeKey: run.applicationId, status: "QUEUED", error: null },
        });
        if (!result.count)
          throw new ActionError("Preparation already changed.");
        try {
          const jobId = await startJob(
            prepareApplicationJob,
            { runId },
            {
              applicationId: run.applicationId,
              key: `preparation:${run.applicationId}`,
            },
          );
          await prisma.preparationRun.update({
            where: { id: runId },
            data: { jobId },
          });
        } catch (error) {
          await prisma.preparationRun.update({
            where: { id: runId },
            data: { activeKey: null, status: "FAILED" },
          });
          throw error;
        }
      } else if (action === "cancel") {
        const { runId } = z.object({ runId: z.string() }).parse(input);
        const run = await prisma.preparationRun.findUniqueOrThrow({
          where: { id: runId },
        });
        const job = run.jobId
          ? await prisma.job.findUnique({ where: { id: run.jobId } })
          : null;
        if (job) await cancelJob(job.id);
        if (!job || job.status !== "RUNNING")
          await prisma.preparationRun.update({
            where: { id: runId },
            data: {
              status: "CANCELLED",
              activeKey: null,
              finishedAt: new Date(),
            },
          });
      } else if (action === "reveal") {
        const { applicationId } = applicationIdSchema.parse(input);
        const file = await latestPackage(applicationId);
        if (!file) throw new ActionError("Prepare a merged PDF first.");
        const application = await prisma.application.findUniqueOrThrow({
          where: { id: applicationId },
        });
        await workerOperation(`reveal-${file.id}-${Date.now()}`, {
          kind: "reveal",
          folder: `${application.documentMode === "LATEX" ? "dossier" : "native"}-${applicationId}`,
          fileName: (file.manifest as { fileName: string }).fileName,
          version: file.version,
          checksum: file.checksum,
          data: (await verifiedBytes(file)).toString("base64"),
        });
      } else if (action === "email") {
        const { applicationId, ...parts } = z
          .object({
            applicationId: z.string(),
            to: z.union([z.literal(""), z.email()]),
            subject: z.string().max(500),
            body: z.string().max(20_000),
          })
          .parse(input);
        const units = emailUnits(parts);
        await prisma.document.update({
          where: { applicationId_kind: { applicationId, kind: "EMAIL" } },
          data: { units, versions: { create: { units, cause: "REFINED" } } },
        });
      } else if (action === "metadata") {
        const {
          applicationId,
          company,
          role,
          deadline,
          recruiterEmail,
          postingText,
        } = z
          .object({
            applicationId: z.string(),
            company: z.string().max(200),
            role: z.string().max(200),
            deadline: z.union([z.literal(""), z.iso.date()]),
            recruiterEmail: z.union([z.literal(""), z.email()]),
            postingText: z.string().min(1).max(100_000),
          })
          .parse(input);
        if (
          await prisma.preparationRun.count({
            where: { activeKey: applicationId },
          })
        )
          throw new ActionError(
            "Cancel preparation before editing its inputs.",
          );
        const previous = await prisma.application.findUniqueOrThrow({
          where: { id: applicationId },
        });
        await prisma.application.update({
          where: { id: applicationId },
          data: {
            company,
            role,
            title: `${role} · ${company}`,
            postingText,
            deadline: deadline ? new Date(`${deadline}T00:00:00Z`) : null,
            extracted: {
              ...((previous.extracted as object) ?? {}),
              manualMetadata: {
                company,
                role,
                deadline: deadline || null,
                recruiterEmail: recruiterEmail || null,
              },
            },
          },
        });
      } else
        return NextResponse.json(
          { error: "Unknown preparation action." },
          { status: 404 },
        );
      return NextResponse.json({ ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  },
);
