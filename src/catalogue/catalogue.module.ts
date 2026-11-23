import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { CatalogueController } from "./catalogue.controller";
import { Catalogue } from "./catalogue.service";

@Module({
  imports: [InfrastructureModule, AuthModule],
  controllers: [CatalogueController],
  providers: [Catalogue],
  exports: [Catalogue],
})
export class CatalogueModule {}
