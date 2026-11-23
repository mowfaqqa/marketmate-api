import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { AssetsModule } from "../assets/assets.module";
import { BusinessController } from "./business.controller";
import { LogoController } from "./logo.controller";

@Module({
  imports: [InfrastructureModule, AuthModule, AssetsModule],
  controllers: [BusinessController, LogoController],
})
export class BusinessModule {}
