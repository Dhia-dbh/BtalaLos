ALTER TABLE "Application"
ADD COLUMN "applicationType" TEXT NOT NULL DEFAULT 'PHD',
ADD COLUMN "formAnswers" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "Application" ADD CONSTRAINT "Application_applicationType_check" CHECK ("applicationType" IN ('PHD', 'JOB'));
