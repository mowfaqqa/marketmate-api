-- AlterTable
ALTER TABLE "StudioJob" ADD COLUMN     "leaseToken" TEXT,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "model" TEXT,
ADD COLUMN     "planBatchId" TEXT,
ADD COLUMN     "provider" TEXT NOT NULL DEFAULT 'local';

-- AlterTable
ALTER TABLE "MarketingPlan" ADD COLUMN     "period" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ready',
ADD COLUMN     "units" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AiBudgetDay" (
    "date" TEXT NOT NULL,
    "reservedMicros" BIGINT NOT NULL DEFAULT 0,
    "spentMicros" BIGINT NOT NULL DEFAULT 0,
    "alerted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AiBudgetDay_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "AiAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "priceVersion" TEXT NOT NULL,
    "inputRate" DOUBLE PRECISION NOT NULL,
    "outputRate" DOUBLE PRECISION NOT NULL,
    "reservedMicros" BIGINT NOT NULL,
    "costMicros" BIGINT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "providerRequestId" TEXT,
    "providerResponseId" TEXT,
    "actualModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAttempt_jobId_createdAt_idx" ON "AiAttempt"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAttempt_status_createdAt_idx" ON "AiAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "StudioJob_planBatchId_idx" ON "StudioJob"("planBatchId");

-- AddForeignKey
ALTER TABLE "StudioJob" ADD CONSTRAINT "StudioJob_planBatchId_fkey" FOREIGN KEY ("planBatchId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "StudioJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_day_fkey" FOREIGN KEY ("day") REFERENCES "AiBudgetDay"("date") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "AiBudgetDay" ADD CONSTRAINT "AiBudgetDay_amount_check" CHECK ("reservedMicros" >= 0 AND "spentMicros" >= 0);
ALTER TABLE "AiAttempt" ADD CONSTRAINT "AiAttempt_amount_check" CHECK ("reservedMicros" >= 0 AND ("costMicros" IS NULL OR "costMicros" >= 0));
