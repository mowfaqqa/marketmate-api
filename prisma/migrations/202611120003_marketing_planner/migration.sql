-- CreateTable
CREATE TABLE "MarketingPlan" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "start" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "productIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDay" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "theme" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "previousJobIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,

    CONSTRAINT "MarketingDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingPlan_businessId_start_idx" ON "MarketingPlan"("businessId", "start");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlan_businessId_key_key" ON "MarketingPlan"("businessId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDay_jobId_key" ON "MarketingDay"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingDay_planId_date_key" ON "MarketingDay"("planId", "date");

-- AddForeignKey
ALTER TABLE "MarketingDay" ADD CONSTRAINT "MarketingDay_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MarketingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingDay" ADD CONSTRAINT "MarketingDay_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "StudioJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
