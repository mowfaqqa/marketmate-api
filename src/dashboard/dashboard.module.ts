import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { DashboardController } from "./dashboard.controller";

@Module({
  imports: [InfrastructureModule, AuthModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
