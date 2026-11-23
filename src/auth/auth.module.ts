import { AuthService } from "./auth.service";
import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthController } from "./auth.controller";
import { SessionGuard, RateGuard } from "./session.guard";
import { Mail } from "./mail";

@Module({
  imports: [InfrastructureModule],
  controllers: [AuthController],
  providers: [AuthService, SessionGuard, RateGuard, Mail],
  exports: [SessionGuard],
})
export class AuthModule {}
