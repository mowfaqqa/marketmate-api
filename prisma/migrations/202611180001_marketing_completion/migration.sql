-- AlterTable
ALTER TABLE "Business" ADD COLUMN     "logoKey" TEXT;

-- CreateTable
CREATE TABLE "StoredObject" (
    "key" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoredObject_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "StoredObject_businessId_idx" ON "StoredObject"("businessId");

ALTER TABLE "StoredObject" ADD CONSTRAINT "StoredObject_bytes_nonnegative" CHECK ("bytes" >= 0);

-- Existing objects have incomplete byte metadata: reserve the known full-image size
-- and conservative read limits for previews/graphics/PDFs. Reconcile via R2 HEAD
-- during the deferred integration pass before lowering any estimates.
INSERT INTO "StoredObject" ("key", "businessId", "bytes")
SELECT "fullKey", "businessId", COALESCE("bytes", 10485760) FROM "MediaAsset" WHERE "fullKey" IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO "StoredObject" ("key", "businessId", "bytes")
SELECT "previewKey", "businessId", 10485760 FROM "MediaAsset" WHERE "previewKey" IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO "StoredObject" ("key", "businessId", "bytes")
SELECT "objectKey", "businessId", 12582912 FROM "StudioGraphic" WHERE "status" IN ('ready', 'pending')
ON CONFLICT DO NOTHING;
INSERT INTO "StoredObject" ("key", "businessId", "bytes")
SELECT "pdfKey", "businessId", 10485760 FROM "SalesDocument" WHERE "pdfKey" IS NOT NULL
ON CONFLICT DO NOTHING;
