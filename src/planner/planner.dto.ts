import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from "class-validator";

export const datePattern = /^\d{4}-\d{2}-\d{2}$/;
export const channels = ["instagram", "whatsapp"];
export const goals = ["inquiries", "offer", "launch"];
export class PlanInput {
  @IsUUID() key!: string;
  @Matches(datePattern) start!: string;
  @IsIn(goals) goal!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  productIds!: string[];
}
export class DayInput {
  @IsInt() @Min(0) revision!: number;
  @Matches(datePattern) date!: string;
  @IsIn(channels) channel!: string;
  @IsUUID() productId!: string;
  @IsString() @Length(1, 180) task!: string;
  @IsOptional() @IsString() @Length(1, 1200) text?: string;
  @IsBoolean() swap!: boolean;
  @IsBoolean() regenerate!: boolean;
  @IsBoolean() confirmDoneEdit!: boolean;
}
export class Completion {
  @IsInt() @Min(0) revision!: number;
  @IsBoolean() done!: boolean;
}
