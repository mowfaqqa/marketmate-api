import "reflect-metadata";
import "dotenv/config";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { RateLimits } from "./infrastructure/rate-limits";
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.SWAGGER_ENABLED === "true"
  ) {
    const config = new DocumentBuilder()
      .setTitle("MarketMate API")
      .setVersion("1.0")
      .setDescription(
        "Owner-scoped API. Sign in through the web app to establish the HttpOnly session. Mutations require an Origin matching WEB_ORIGIN. Sales creation and financial actions require an Idempotency-Key. Monetary values are integer NGN kobo. Sales DTO schemas are documented; older feature schemas are being completed incrementally.",
      )
      .addCookieAuth("marketmate_session")
      .build();
    SwaggerModule.setup(
      "api/docs",
      app,
      SwaggerModule.createDocument(app, config),
      { swaggerOptions: { supportedSubmitMethods: [] } },
    );
  }
  app.enableShutdownHooks();
  await app.listen(
    Number(process.env.PORT || 4100),
    process.env.API_HOST || "127.0.0.1",
  );
}
void bootstrap();
