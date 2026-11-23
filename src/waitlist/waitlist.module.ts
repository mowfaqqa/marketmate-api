import { Module } from "@nestjs/common";
import { Database } from "../infrastructure/database";
import { RateLimits } from "../infrastructure/rate-limits";
import { WaitlistController } from "./waitlist.controller";

@Module({
  providers: [Database, RateLimits],
  controllers: [WaitlistController],
})
export class WaitlistModule {}
