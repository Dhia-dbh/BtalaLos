-- CreateEnum
CREATE TYPE "DocumentMode" AS ENUM ('NATIVE', 'LATEX');

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "documentMode" "DocumentMode" NOT NULL DEFAULT 'NATIVE',
ADD COLUMN     "packageProfileId" TEXT;

-- CreateTable
CREATE TABLE "ApplicationProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "items" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApplicationProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportingDocument" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupportingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportingDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "pages" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportingDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PreparationRun" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "activeKey" TEXT,
    "snapshot" JSONB NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PreparationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationArtifact" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "pages" INTEGER,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApplicationArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationProfile_name_key" ON "ApplicationProfile"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SupportingDocument_active_name_key" ON "SupportingDocument"(lower(trim("name"))) WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupportingDocumentVersion_documentId_version_key" ON "SupportingDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PreparationRun_activeKey_key" ON "PreparationRun"("activeKey");

-- CreateIndex
CREATE INDEX "PreparationRun_applicationId_createdAt_idx" ON "PreparationRun"("applicationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApplicationArtifact_applicationId_role_version_key" ON "ApplicationArtifact"("applicationId", "role", "version");

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_packageProfileId_fkey" FOREIGN KEY ("packageProfileId") REFERENCES "ApplicationProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportingDocumentVersion" ADD CONSTRAINT "SupportingDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "SupportingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreparationRun" ADD CONSTRAINT "PreparationRun_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationArtifact" ADD CONSTRAINT "ApplicationArtifact_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationArtifact" ADD CONSTRAINT "ApplicationArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PreparationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

