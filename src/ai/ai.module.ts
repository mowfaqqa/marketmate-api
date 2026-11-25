import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { OpenAIGeneration } from "./generation.service";
import { GenerationWorker } from "./generation-worker";

@Module({
  imports: [InfrastructureModule],
  providers: [OpenAIGeneration, GenerationWorker],
})
export class AiModule {}
