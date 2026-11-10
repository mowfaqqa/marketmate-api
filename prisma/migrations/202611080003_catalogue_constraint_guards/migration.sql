-- Reject null values explicitly because SQL CHECK permits unknown expressions.
ALTER TABLE "Product" DROP CONSTRAINT "Product_price_check";
ALTER TABLE "Product" ADD CONSTRAINT "Product_price_check" CHECK (("pricingMode" = 'FIXED' AND "priceKobo" IS NOT NULL AND "priceKobo" BETWEEN 1 AND 1000000000000) OR ("pricingMode" = 'INQUIRY' AND "priceKobo" IS NULL));
ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_ready_check";
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ready_check" CHECK ("status" <> 'READY' OR ("content" IS NOT NULL AND "preview" IS NOT NULL AND "checksum" IS NOT NULL AND "width" IS NOT NULL AND "height" IS NOT NULL AND "bytes" IS NOT NULL AND "width" > 0 AND "height" > 0 AND "width"::bigint * "height" <= 20000000 AND "bytes" > 0));
