CREATE TABLE "GenerationTrace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "applicationId" TEXT,
  "type" TEXT NOT NULL,
  "stages" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GenerationTrace_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "GenerationTrace_applicationId_idx" ON "GenerationTrace"("applicationId");
