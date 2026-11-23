import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { AssetsController } from "./assets.controller";
import { Assets } from "./assets.service";
import { UploadRateGuard } from "./upload-rate.guard";

@Module({
  imports: [InfrastructureModule, AuthModule, CatalogueModule],
  controllers: [AssetsController],
  providers: [Assets, UploadRateGuard],
  exports: [Assets, UploadRateGuard],
})
export class AssetsModule {}
