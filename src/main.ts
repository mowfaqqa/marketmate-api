import 'reflect-metadata';
import 'dotenv/config';
import { Controller, Get, Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Database } from './database';
import { AuthController, SessionGuard, RateGuard } from './auth';
import { BusinessController } from './business';
import { Mail } from './mail';
import { RateLimits } from './rate-limits';
import { R2Storage } from './r2';
import { Catalogue, CatalogueController } from './catalogue';
import { Assets, AssetsController, UploadRateGuard } from './assets';
import { Studio, StudioController } from './studio';
@Controller('health')
class HealthController { @Get() status() { return { status: 'ok', service: 'marketmate-api' }; } }
@Module({ controllers: [HealthController, AuthController, BusinessController, CatalogueController, AssetsController, StudioController], providers: [Database, Mail, SessionGuard, RateGuard, Catalogue, Assets, UploadRateGuard, RateLimits, R2Storage, Studio] })
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
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 4100), process.env.API_HOST || '127.0.0.1');
}
void bootstrap();
