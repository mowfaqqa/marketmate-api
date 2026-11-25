import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { AuthModule } from "./auth/auth.module";
import { CatalogueModule } from "./catalogue/catalogue.module";
import { AssetsModule } from "./assets/assets.module";
import { GraphicsModule } from "./graphics/graphics.module";
import { StudioModule } from "./studio/studio.module";
import { PlannerModule } from "./planner/planner.module";
import { BusinessModule } from "./business/business.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { SalesModule } from "./sales/sales.module";
import { AiModule } from "./ai/ai.module";

@Module({
  imports: [
    InfrastructureModule,
    AuthModule,
    CatalogueModule,
    AssetsModule,
    GraphicsModule,
    StudioModule,
    PlannerModule,
    BusinessModule,
    DashboardModule,
    SalesModule,
    AiModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
