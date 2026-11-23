import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { StudioController } from "./studio.controller";
import { Studio } from "./studio.service";

@Module({
  imports: [InfrastructureModule, AuthModule, CatalogueModule],
  controllers: [StudioController],
  providers: [Studio],
  exports: [Studio],
})
export class StudioModule {}
