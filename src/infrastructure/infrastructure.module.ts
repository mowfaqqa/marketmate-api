import { Module } from "@nestjs/common";
import { Database } from "./database";
import { RateLimits } from "./rate-limits";
import { R2Storage } from "./r2";

@Module({
  providers: [Database, RateLimits, R2Storage],
  exports: [Database, RateLimits, R2Storage],
})
export class InfrastructureModule {}
