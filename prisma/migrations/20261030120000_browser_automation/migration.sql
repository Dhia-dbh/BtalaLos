CREATE TABLE "BrowserRun" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "applicationId" TEXT REFERENCES "Application"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "activeKey" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "approvedHash" TEXT,
  "snapshot" JSONB NOT NULL,
  "error" TEXT,
  "jobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "BrowserRun_activeKey_key" ON "BrowserRun"("activeKey");
CREATE INDEX "BrowserRun_applicationId_createdAt_idx" ON "BrowserRun"("applicationId", "createdAt");
CREATE TABLE "BrowserEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "runId" TEXT NOT NULL REFERENCES "BrowserRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "kind" TEXT NOT NULL,
  "data" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "BrowserEvent_runId_createdAt_idx" ON "BrowserEvent"("runId", "createdAt");
ALTER TABLE "EmailMessage" ADD COLUMN "mailbox" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "browserMessageId" TEXT,
  ADD COLUMN "browserThreadUrl" TEXT;
UPDATE "EmailMessage" SET "mailbox" = lower((SELECT "email" FROM "GoogleAccount" WHERE "id" = 'google'))
WHERE EXISTS (SELECT 1 FROM "GoogleAccount" WHERE "id" = 'google');
CREATE INDEX "EmailMessage_mailbox_messageId_idx" ON "EmailMessage"("mailbox", "messageId");
