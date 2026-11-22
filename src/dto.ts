import {
  IsEmail,
  IsHexColor,
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from "class-validator";
export class Credentials {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
export class EmailInput {
  @IsEmail() @MaxLength(254) email!: string;
}
export class TokenInput {
  @IsString() @Matches(/^[a-f0-9]{64}$/) token!: string;
}
export class ResetInput extends TokenInput {
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
@ValidatorConstraint()
class ContactValidator implements ValidatorConstraintInterface {
  validate(value: unknown) {
    if (typeof value !== "string") return false;
    if (/^\+[1-9]\d{7,14}$/.test(value)) return true;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !!url.hostname &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }
  defaultMessage() {
    return "contact must be an HTTPS address or a phone number such as +2348012345678";
  }
}
export class BusinessInput {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(2) @MaxLength(80) category!: string;
  @IsString() @MaxLength(500) description!: string;
  @IsString() @MaxLength(150) location!: string;
  @IsString() @MaxLength(300) @Validate(ContactValidator) contact!: string;
  @IsIn(["en-NG"]) language!: string;
  @IsIn(["friendly", "professional", "playful"]) tone!: string;
  @IsHexColor() brandColor!: string;
  @IsInt() @Min(0) version!: number;
}
