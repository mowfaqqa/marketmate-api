import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
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
