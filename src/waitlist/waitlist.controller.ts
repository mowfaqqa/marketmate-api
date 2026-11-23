import { Body, Controller, HttpCode, Ip, Post, Res } from "@nestjs/common";
import { ApiNoContentResponse, ApiProperty, ApiTags } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsEmail, IsString, Length, MaxLength } from "class-validator";
import { Database } from "../infrastructure/database";
import { RateLimits, type HeaderResponse } from "../infrastructure/rate-limits";

class JoinWaitlistDto {
  @ApiProperty({ format: "email", maxLength: 254 })
  @Transform(({ value }) =>
    typeof value === "string" ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 100, { message: "Enter a name of up to 100 characters." })
  name!: string;

  @ApiProperty({ maxLength: 250 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @Length(1, 250, {
    message: "Describe your business in up to 250 characters.",
  })
  businessType!: string;
}

@ApiTags("Waitlist")
@Controller("waitlist")
export class WaitlistController {
  constructor(
    private readonly db: Database,
    private readonly limits: RateLimits,
  ) {}

  @Post()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Early-access registration recorded." })
  async join(
    @Body() body: JoinWaitlistDto,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: HeaderResponse,
  ) {
    this.limits.enforce(res, "waitlist", ip, 20);
    await this.db.waitlistEntry.createMany({
      data: [
        { email: body.email, name: body.name, businessType: body.businessType },
      ],
      skipDuplicates: true,
    });
  }
}
