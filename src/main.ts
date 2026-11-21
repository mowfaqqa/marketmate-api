import 'reflect-metadata';
import 'dotenv/config';
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { LogoController } from './logo';
import { Database } from './database';
import { DashboardController } from './dashboard';
import { AuthController, SessionGuard, RateGuard } from './auth';
import { BusinessController } from './business';
import { Mail } from './mail';
import { RateLimits } from './rate-limits';
import { R2Storage } from './r2';
import { Catalogue, CatalogueController } from './catalogue';
import { Assets, AssetsController, UploadRateGuard } from './assets';
import { Studio, StudioController } from './studio';
import { Graphics, GraphicsController } from './graphics';
import { Planner, PlannerController } from './planner';
import { OpenAIGeneration } from './ai/generation.service';
import { GenerationWorker } from './ai/generation-worker';
import { Sales } from './sales/sales.service';
import { SalesPdf } from './sales/sales-pdf.service';
import { CustomersController, SalesController, PaymentsController } from './sales/sales.controller';
@Controller('health')
class HealthController { @Get() status() { return { status: 'ok', service: 'marketmate-api' }; } }
@Module({ controllers: [LogoController, DashboardController, HealthController, AuthController, BusinessController, CatalogueController, AssetsController, StudioController, GraphicsController, PlannerController, CustomersController, SalesController, PaymentsController], providers: [Database, Mail, SessionGuard, RateGuard, Catalogue, Assets, UploadRateGuard, RateLimits, R2Storage, Studio, Graphics, Planner, Sales, SalesPdf, OpenAIGeneration, GenerationWorker] })
class AppModule {}
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  if (process.env.TRUST_PROXY) app.getHttpAdapter().getInstance().set('trust proxy', process.env.TRUST_PROXY);
  const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
  app.enableCors({ origin, credentials: true });
  const rate = app.get(RateLimits);
  app.use((req: { ip: string; method: string; headers: Record<string, string> }, res: { status(n: number): { json(v: unknown): void }; setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    const retryAfter = rate.take('ingress', req.ip, 1200, 60000);
    if (retryAfter) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ message: 'Too many requests. Wait and try again.', retryAfter }); return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) {
      res.status(403).json({ message: 'This request must come from the MarketMate application.' }); return;
    }
    next();
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder().setTitle('MarketMate API').setVersion('1.0')
      .setDescription('Owner-scoped API. Sign in through the web app to establish the HttpOnly session. Mutations require an Origin matching WEB_ORIGIN. Sales creation and financial actions require an Idempotency-Key. Monetary values are integer NGN kobo. Sales DTO schemas are documented; older feature schemas are being completed incrementally.')
      .addCookieAuth('marketmate_session').build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config), { swaggerOptions: { supportedSubmitMethods: [] } });
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 4100), process.env.API_HOST || '127.0.0.1');
}
void bootstrap();
