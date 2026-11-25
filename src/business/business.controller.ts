import {
  Body,
  ConflictException,
  Controller,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Database } from "../infrastructure/database";
import {
  currentBusinessId,
  SessionGuard,
  type Request,
} from "../auth/session.guard";
import { BusinessInput } from "./business.dto";
@Controller("business")
@UseGuards(SessionGuard)
export class BusinessController {
  constructor(private readonly db: Database) {}
  @Put()
  async update(@Req() req: Request, @Body() input: BusinessInput) {
    const businessId = currentBusinessId(req);
    return this.db.$transaction(async (tx) => {
      const { version, ...data } = input;
      const result = await tx.business.updateMany({
        where: { id: businessId, version },
        data: { ...data, version: { increment: 1 } },
      });
      if (!result.count)
        throw new ConflictException(
          "Your business was updated in another tab. Reload the saved details before trying again.",
        );
      return tx.business.findUniqueOrThrow({
        where: { id: businessId },
      });
    });
  }
}
