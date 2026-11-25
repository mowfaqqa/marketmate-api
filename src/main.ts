import "reflect-metadata";
import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { WaitlistModule } from "./waitlist/waitlist.module";
import { RateLimits } from "./infrastructure/rate-limits";
async function bootstrap() {
  const app = await NestFactory.create(WaitlistModule);
  if (process.env.TRUST_PROXY)
    app
      .getHttpAdapter()
      .getInstance()
      .set("trust proxy", process.env.TRUST_PROXY);
  const origin = process.env.WEB_ORIGIN || "http://localhost:3000";
  app.enableCors({ origin, credentials: true });
  const rate = app.get(RateLimits);
  app.use(
    (
      req: { ip: string; method: string; headers: Record<string, string> },
      res: {
        status(n: number): { json(v: unknown): void };
        setHeader(k: string, v: string): void;
      },
      next: () => void,
    ) => {
      res.setHeader("Cache-Control", "no-store");
      const retryAfter = rate.take("ingress", req.ip, 1200, 60000);
      if (retryAfter) {
        res.setHeader("Retry-After", String(retryAfter));
        res
          .status(429)
          .json({
            message: "Too many requests. Wait and try again.",
            retryAfter,
          });
        return;
      }
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers.origin !== origin
      ) {
        res
          .status(403)
          .json({
            message: "This request must come from the MarketMate application.",
          });
        return;
      }
      next();
    },
  );
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT || 4100),
    process.env.API_HOST || "127.0.0.1",
  );
}
void bootstrap();
