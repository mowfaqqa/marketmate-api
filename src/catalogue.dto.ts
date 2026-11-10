import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export const MAX_KOBO = 1_000_000_000_000;

export class ProductInput {
  @IsUUID() clientId!: string;
  @IsIn(['PRODUCT', 'SERVICE']) type!: 'PRODUCT' | 'SERVICE';
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsString() @MaxLength(80) category!: string;
  @IsString() @MaxLength(2000) description!: string;
  @IsIn(['FIXED', 'INQUIRY']) pricingMode!: 'FIXED' | 'INQUIRY';
  @ValidateIf(o => o.pricingMode === 'FIXED') @IsInt() @Min(1) @Max(MAX_KOBO) priceKobo!: number | null;
  @IsString() @MaxLength(500) materialSize!: string;
  @IsString() @MaxLength(500) serviceArea!: string;
  @IsString() @MaxLength(500) fulfilmentTerms!: string;
  @IsString() @MaxLength(1000) confirmedClaims!: string;
}

export class ProductUpdate extends ProductInput {
  @IsInt() @Min(0) version!: number;
}

export class VersionInput {
  @IsInt() @Min(0) version!: number;
}

export class ArchiveInput extends VersionInput {
  @IsBoolean() archived!: boolean;
}

export class UploadInput extends VersionInput {
  @Equals(true) rightsConfirmed!: boolean;
}

export class ProductQuery {
  @IsOptional() @IsString() @MaxLength(100) search = '';
  @IsOptional() @IsIn(['active', 'archived']) status: 'active' | 'archived' = 'active';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}

export class OfferInput extends VersionInput {
  @IsInt() @Min(1) @Max(MAX_KOBO) promoPriceKobo!: number;
  @ValidateIf(o => o.assertedPriorPriceKobo !== null) @IsInt() @Min(1) @Max(MAX_KOBO) assertedPriorPriceKobo!: number | null;
  @IsISO8601({ strict: true }) startsAt!: string;
  @IsISO8601({ strict: true }) endsAt!: string;
  @IsString() @MaxLength(500) terms!: string;
}
