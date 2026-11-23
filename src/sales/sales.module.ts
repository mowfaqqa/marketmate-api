import { Module } from "@nestjs/common";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { AuthModule } from "../auth/auth.module";
import {
  CustomersController,
  SalesController,
  PaymentsController,
} from "./sales.controller";
import { Sales } from "./sales.service";
import { SalesPdf } from "./sales-pdf.service";

@Module({
  imports: [InfrastructureModule, AuthModule],
  controllers: [CustomersController, SalesController, PaymentsController],
  providers: [Sales, SalesPdf],
})
export class SalesModule {}
