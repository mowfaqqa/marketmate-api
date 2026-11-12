-- CreateTable
CREATE TABLE "StudioJob" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "period" TIMESTAMP(3) NOT NULL,
    "units" INTEGER NOT NULL,
    "facts" JSONB NOT NULL,
    "error" TEXT,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudioJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudioDraft" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "variant" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "feedback" TEXT,

    CONSTRAINT "StudioDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioJob_businessId_period_status_idx" ON "StudioJob"("businessId", "period", "status");

-- CreateIndex
CREATE INDEX "StudioJob_status_createdAt_idx" ON "StudioJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StudioJob_businessId_key_key" ON "StudioJob"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "StudioDraft_jobId_variant_revision_key" ON "StudioDraft"("jobId", "variant", "revision");

-- AddForeignKey
ALTER TABLE "StudioJob" ADD CONSTRAINT "StudioJob_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudioDraft" ADD CONSTRAINT "StudioDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "StudioJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
