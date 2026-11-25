import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { CatalogueModule } from "../catalogue/catalogue.module";
import { StudioModule } from "../studio/studio.module";
import { PlannerController } from "./planner.controller";
import { Planner } from "./planner.service";

@Module({
  imports: [InfrastructureModule, AuthModule, CatalogueModule, StudioModule],
  controllers: [PlannerController],
  providers: [Planner],
})
export class PlannerModule {}
