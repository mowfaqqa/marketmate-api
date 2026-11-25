import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
export class Brief {
  @IsUUID() productId!: string;
  @IsUUID() key!: string;
  @IsIn(["inquiries", "offer", "launch"]) goal!: string;
  @IsIn(["instagram", "whatsapp", "description", "ideas"]) channel!: string;
  @IsIn(["friendly", "professional", "energetic"]) tone!: string;
  @IsBoolean() manual!: boolean;
  @IsOptional() @IsInt() productVersion?: number;
  @IsOptional() @IsInt() businessVersion?: number;
  @IsOptional() @IsUUID() sourceDraftId?: string;
}
export class DraftInput {
  @IsUUID() draftId!: string;
  @IsString() @Length(1, 1200) text!: string;
}
export class DraftId {
  @IsUUID() draftId!: string;
}
export class Feedback extends DraftId {
  @IsIn(["facts", "language"]) issue!: string;
}
export class ArchiveInput {
  @IsBoolean() archived!: boolean;
}
