-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "invoiceSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "quotationSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "address" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesDocument" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "number" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "seller" JSONB NOT NULL,
    "buyer" JSONB NOT NULL,
    "lines" JSONB NOT NULL,
    "totals" JSONB NOT NULL,
    "totalKobo" BIGINT NOT NULL,
    "paidKobo" BIGINT NOT NULL DEFAULT 0,
    "dueDate" TEXT NOT NULL,
    "issueDate" TEXT,
    "issuedAt" TIMESTAMP(3),
    "issuedBy" TEXT,
    "taxConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "paymentInstructions" TEXT NOT NULL DEFAULT '',
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedBy" TEXT,
    "sourceQuotationId" TEXT,
    "replacesId" TEXT,
    "pdfStatus" TEXT NOT NULL DEFAULT 'NONE',
    "pdfRevision" INTEGER NOT NULL DEFAULT 0,
    "pdfToken" TEXT,
    "pdfLeaseUntil" TIMESTAMP(3),
    "pdfKey" TEXT,
    "pdfError" TEXT,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualPayment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "amountKobo" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL DEFAULT '',
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReversal" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReversal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_businessId_name_idx" ON "Customer"("businessId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_id_key" ON "Customer"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_sourceQuotationId_key" ON "SalesDocument"("sourceQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_replacesId_key" ON "SalesDocument"("replacesId");

-- CreateIndex
CREATE INDEX "SalesDocument_businessId_createdAt_id_idx" ON "SalesDocument"("businessId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "SalesDocument_pdfStatus_pdfLeaseUntil_idx" ON "SalesDocument"("pdfStatus", "pdfLeaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_businessId_id_key" ON "SalesDocument"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SalesDocument_businessId_number_key" ON "SalesDocument"("businessId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ManualPayment_businessId_id_key" ON "ManualPayment"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReversal_paymentId_key" ON "PaymentReversal"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAction_businessId_key_key" ON "SalesAction"("businessId", "key");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_sourceQuotationId_fkey" FOREIGN KEY ("sourceQuotationId") REFERENCES "SalesDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "SalesDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_businessId_customerId_fkey" FOREIGN KEY ("businessId", "customerId") REFERENCES "Customer"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_businessId_documentId_fkey" FOREIGN KEY ("businessId", "documentId") REFERENCES "SalesDocument"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReversal" ADD CONSTRAINT "PaymentReversal_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ManualPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAction" ADD CONSTRAINT "SalesAction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Financial invariants also apply to direct database writes.
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_money_check" CHECK ("totalKobo" BETWEEN 0 AND 1000000000000 AND "paidKobo" BETWEEN 0 AND "totalKobo");
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_type_check" CHECK ("type" IN ('INVOICE', 'QUOTATION'));
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_status_check" CHECK ("status" IN ('DRAFT', 'ISSUED', 'VOID'));
ALTER TABLE "SalesDocument" ADD CONSTRAINT "SalesDocument_issuance_check" CHECK (("status" = 'DRAFT' AND "number" IS NULL AND "issuedAt" IS NULL) OR ("status" IN ('ISSUED', 'VOID') AND "number" IS NOT NULL AND "issuedAt" IS NOT NULL));
ALTER TABLE "ManualPayment" ADD CONSTRAINT "ManualPayment_amount_check" CHECK ("amountKobo" BETWEEN 1 AND 1000000000000);
