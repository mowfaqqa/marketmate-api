-- CreateEnum
CREATE TYPE "ProductType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('FIXED', 'INQUIRY');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'READY', 'REJECTED', 'DELETING');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('ENABLED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "ProductType" NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "pricingMode" "PricingMode" NOT NULL,
    "priceKobo" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "materialSize" TEXT NOT NULL DEFAULT '',
    "serviceArea" TEXT NOT NULL DEFAULT '',
    "fulfilmentTerms" TEXT NOT NULL DEFAULT '',
    "confirmedClaims" TEXT NOT NULL DEFAULT '',
    "primaryAssetId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "uploadTokenHash" TEXT NOT NULL,
    "rightsConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "productVersion" INTEGER NOT NULL,
    "checksum" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "content" BYTEA,
    "preview" BYTEA,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "promoPriceKobo" BIGINT NOT NULL,
    "assertedPriorPriceKobo" BIGINT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "terms" TEXT NOT NULL DEFAULT '',
    "status" "OfferStatus" NOT NULL DEFAULT 'ENABLED',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_businessId_archivedAt_createdAt_idx" ON "Product"("businessId", "archivedAt", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Product_businessId_id_key" ON "Product"("businessId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_objectKey_key" ON "MediaAsset"("objectKey");

-- CreateIndex
CREATE INDEX "MediaAsset_businessId_productId_idx" ON "MediaAsset"("businessId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_businessId_id_key" ON "MediaAsset"("businessId", "id");

-- CreateIndex
CREATE INDEX "Offer_businessId_productId_createdAt_idx" ON "Offer"("businessId", "productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_businessId_id_key" ON "Offer"("businessId", "id");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_primaryAssetId_fkey" FOREIGN KEY ("businessId", "primaryAssetId") REFERENCES "MediaAsset"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_businessId_productId_fkey" FOREIGN KEY ("businessId", "productId") REFERENCES "Product"("businessId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce catalogue invariants independently of API validation.
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_check" CHECK (("pricingMode" = 'FIXED' AND "priceKobo" BETWEEN 1 AND 1000000000000) OR ("pricingMode" = 'INQUIRY' AND "priceKobo" IS NULL));
ALTER TABLE "Product" ADD CONSTRAINT "Product_currency_check" CHECK ("currency" = 'NGN');
ALTER TABLE "Product" ADD CONSTRAINT "Product_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 100);
ALTER TABLE "Product" ADD CONSTRAINT "Product_version_check" CHECK ("version" >= 0);
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_amount_check" CHECK ("promoPriceKobo" BETWEEN 1 AND 1000000000000 AND ("assertedPriorPriceKobo" IS NULL OR ("assertedPriorPriceKobo" > "promoPriceKobo" AND "assertedPriorPriceKobo" <= 1000000000000)));
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_interval_check" CHECK ("endsAt" > "startsAt");
CREATE UNIQUE INDEX "Offer_one_enabled_per_product" ON "Offer" ("businessId", "productId") WHERE "status" = 'ENABLED';
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ready_check" CHECK ("status" <> 'READY' OR ("content" IS NOT NULL AND "preview" IS NOT NULL AND "checksum" IS NOT NULL AND "width" > 0 AND "height" > 0 AND "width"::bigint * "height" <= 20000000 AND "bytes" > 0));
