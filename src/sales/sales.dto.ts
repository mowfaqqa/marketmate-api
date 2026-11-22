import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { MAX_MONEY } from "./money";
export class CustomerInput {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional() @IsString() @Length(0, 40) phone = "";
  @ApiPropertyOptional()
  @ValidateIf((o: CustomerInput) => o.email !== "")
  @IsEmail()
  @Length(0, 254)
  email = "";
  @ApiPropertyOptional() @IsString() @Length(0, 500) address = "";
}
export class CustomerUpdate extends CustomerInput {
  @ApiProperty() @IsInt() @Min(0) version!: number;
}
export class LineInput {
  @ApiPropertyOptional() @IsOptional() @IsUUID() productId?: string;
  @ApiProperty() @IsString() @Length(1, 500) description!: string;
  @ApiProperty()
  @IsString()
  @Matches(/^(0|[1-9]\d{0,6})(\.\d{1,3})?$/)
  quantity!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(MAX_MONEY) unitPriceKobo!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(MAX_MONEY) discountKobo = 0;
  @ApiProperty() @IsString() @Matches(/^(0|1)(\.\d{1,4})?$/) taxRate = "0";
}
export class DocumentInput {
  @ApiProperty({ enum: ["INVOICE", "QUOTATION"] })
  @IsIn(["INVOICE", "QUOTATION"])
  type!: "INVOICE" | "QUOTATION";
  @ApiProperty() @IsUUID() customerId!: string;
  @ApiProperty() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @ApiProperty({ type: [LineInput], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => LineInput)
  lines!: LineInput[];
  @ApiProperty() @IsInt() @Min(0) @Max(MAX_MONEY) deliveryKobo = 0;
  @ApiProperty() @IsString() @Length(0, 2000) notes = "";
  @ApiProperty() @IsString() @Length(0, 2000) paymentInstructions = "";
}
export class DocumentUpdate extends DocumentInput {
  @ApiProperty() @IsInt() @Min(0) version!: number;
}
export class VersionInput {
  @ApiProperty() @IsInt() @Min(0) version!: number;
}
export class IssueInput extends VersionInput {
  @ApiProperty() @IsBoolean() taxConfirmed!: boolean;
}
export class ReasonInput extends VersionInput {
  @ApiProperty() @IsString() @Length(1, 500) reason!: string;
}
export class PaymentInput extends VersionInput {
  @ApiProperty() @IsInt() @Min(1) @Max(MAX_MONEY) amountKobo!: number;
  @ApiProperty() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiProperty()
  @IsIn(["BANK_TRANSFER", "CASH", "CARD", "OTHER"])
  method!: string;
  @ApiProperty() @IsString() @Length(0, 200) reference = "";
}
export class ListQuery {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiProperty() @IsString() @Length(0, 120) search = "";
  @ApiPropertyOptional() @IsOptional() @IsIn(["INVOICE", "QUOTATION"]) type?:
    "INVOICE" | "QUOTATION";
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(["DRAFT", "ISSUED", "VOID", "PAID", "PARTIAL", "UNPAID", "OVERDUE"])
  status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() customerId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
