import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { SwaggerModule, DocumentBuilder } = require('@nestjs/swagger');
const { AppModule } = require('../dist/app.module.js');
const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
try {
  app.setGlobalPrefix('api');
  const spec = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Sales schema test').addCookieAuth('marketmate_session').build());
  assert.ok(spec.paths['/api/sales-documents/{id}/issue']);
  assert.ok(spec.paths['/api/payments/{id}/reverse']);
  assert.equal(spec.components.schemas.DocumentInput.properties.lines.items.$ref, '#/components/schemas/LineInput');
  assert.ok(spec.components.schemas.DocumentUpdate.properties.version);
  assert.ok(spec.components.schemas.IssueInput.properties.taxConfirmed);
  assert.ok(spec.paths['/api/sales-documents/{id}/payments'].post.parameters.some(p => p.name === 'Idempotency-Key' && p.required));
  console.log('Sales OpenAPI schema checks passed without a database connection.');
} finally { await app.close(); }
