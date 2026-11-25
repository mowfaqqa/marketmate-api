import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import { AssetsModule } from "../assets/assets.module";
import { StudioModule } from "../studio/studio.module";
import { GraphicsController } from "./graphics.controller";
import { Graphics } from "./graphics.service";

@Module({
  imports: [InfrastructureModule, AuthModule, AssetsModule, StudioModule],
  controllers: [GraphicsController],
  providers: [Graphics],
})
export class GraphicsModule {}
