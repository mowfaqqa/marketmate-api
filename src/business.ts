import { Body, ConflictException, Controller, Put, Req, UseGuards } from '@nestjs/common';
import { Database } from './database';
import { SessionGuard, type Request } from './auth';
import { BusinessInput } from './dto';
@Controller('business') @UseGuards(SessionGuard)
export class BusinessController {
  constructor(private readonly db: Database) {}
  @Put()
  async update(@Req() req: Request, @Body() input: BusinessInput) {
    const membership = await this.db.membership.findUniqueOrThrow({ where: { userId: req.user.id } });
    return this.db.$transaction(async tx => {
      const { version, ...data } = input;
      const result = await tx.business.updateMany({ where: { id: membership.businessId, version }, data: { ...data, version: { increment: 1 } } });
      if (!result.count) throw new ConflictException('Your business was updated in another tab. Reload the saved details before trying again.');
      return tx.business.findUniqueOrThrow({ where: { id: membership.businessId } });
    });
  }
}
