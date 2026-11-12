-- CreateTable
CREATE TABLE "StudioGraphic" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "specification" JSONB NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "period" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudioGraphic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudioGraphic_businessId_period_status_idx" ON "StudioGraphic"("businessId", "period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StudioGraphic_businessId_hash_key" ON "StudioGraphic"("businessId", "hash");

-- AddForeignKey
ALTER TABLE "StudioGraphic" ADD CONSTRAINT "StudioGraphic_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "StudioDraft"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
