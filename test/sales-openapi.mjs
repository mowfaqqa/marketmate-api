import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
require("reflect-metadata");
const { Module } = require("@nestjs/common");
const { NestFactory } = require("@nestjs/core");
const { SwaggerModule, DocumentBuilder } = require("@nestjs/swagger");
const {
  CustomersController,
  SalesController,
  PaymentsController,
} = require("../dist/sales/sales.controller.js");
const { Sales } = require("../dist/sales/sales.service.js");
const { SalesPdf } = require("../dist/sales/sales-pdf.service.js");
const { Catalogue } = require("../dist/catalogue.js");
const { Database } = require("../dist/database.js");
const { RateLimits } = require("../dist/rate-limits.js");
class SchemaModule {}
Module({
  controllers: [CustomersController, SalesController, PaymentsController],
  providers: [Sales, SalesPdf, Catalogue, Database, RateLimits].map(
    (provide) => ({ provide, useValue: {} }),
  ),
})(SchemaModule);
const app = await NestFactory.create(SchemaModule, { logger: false });
try {
  app.setGlobalPrefix("api");
  const spec = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Sales schema test")
      .addCookieAuth("marketmate_session")
      .build(),
  );
  assert.ok(spec.paths["/api/sales-documents/{id}/issue"]);
  assert.ok(spec.paths["/api/payments/{id}/reverse"]);
  assert.equal(
    spec.components.schemas.DocumentInput.properties.lines.items.$ref,
    "#/components/schemas/LineInput",
  );
  assert.ok(spec.components.schemas.DocumentUpdate.properties.version);
  assert.ok(spec.components.schemas.IssueInput.properties.taxConfirmed);
  assert.ok(
    spec.paths["/api/sales-documents/{id}/payments"].post.parameters.some(
      (p) => p.name === "Idempotency-Key" && p.required,
    ),
  );
  console.log(
    "Sales OpenAPI schema checks passed without a database connection.",
  );
} finally {
  await app.close();
}
