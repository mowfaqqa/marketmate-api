import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
@Injectable()
export class Mail {
  private readonly logger = new Logger(Mail.name);

  private unavailable(reason: string): never {
    // Never log recipients, tokens, API keys or provider response bodies.
    this.logger.error(reason);
    throw new ServiceUnavailableException(
      "Email delivery is unavailable. Please try again later.",
    );
  }

  async send(email: string, purpose: "verify" | "reset", rawToken: string) {
    const production = process.env.NODE_ENV === "production";
    const mode = process.env.MAIL_MODE?.trim() || "brevo";
    if (!["file", "brevo"].includes(mode))
      this.unavailable("MAIL_MODE must be file or brevo.");
    if (mode === "file" && production)
      this.unavailable(
        "File email delivery is disabled in production. Set MAIL_MODE=brevo.",
      );

    let origin: URL;
    try {
      origin = new URL(
        process.env.WEB_ORIGIN?.trim() ||
          (production ? "" : "http://localhost:3000"),
      );
      if (
        !["http:", "https:"].includes(origin.protocol) ||
        (production && origin.protocol !== "https:") ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash
      )
        throw new Error();
    } catch {
      this.unavailable(
        "WEB_ORIGIN must be a browser origin, using HTTPS in production.",
      );
    }
    const path = purpose === "verify" ? "verify-email" : "reset-password";
    const link = `${origin.origin}/${path}#token=${encodeURIComponent(rawToken)}`;
    const subject =
      purpose === "verify"
        ? "Verify your MarketMate email"
        : "Reset your MarketMate password";
    const lifetime = purpose === "verify" ? "24 hours" : "30 minutes";
    if (mode === "file") {
      const dir = process.env.MAIL_DIRECTORY || ".local-mail";
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(
        join(dir, `${Date.now()}-${randomUUID()}.json`),
        JSON.stringify({ to: email, subject, link }),
        { mode: 0o600 },
      );
      return;
    }
    const key = process.env.BREVO_API_KEY?.trim();
    const from = process.env.MAIL_FROM?.trim();
    const name = process.env.MAIL_FROM_NAME?.trim() || "MarketMate";
    if (!key || !from)
      this.unavailable("Brevo requires BREVO_API_KEY and MAIL_FROM.");
    if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(from))
      this.unavailable("MAIL_FROM must contain a sender email address.");
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      redirect: "error",
      headers: {
        "api-key": key,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        sender: { email: from, name },
        to: [{ email }],
        subject,
        textContent: `${subject}\n\n${link}\n\nThis link expires in ${lifetime} and can only be used once.\nIf you did not request this, ignore this message.`,
      }),
    }).catch(() => null);
    if (!response) this.unavailable("Brevo request failed or timed out.");
    if (!response.ok)
      this.unavailable(
        `Brevo rejected email delivery (HTTP ${response.status}). Check credentials, sender verification and transactional email availability.`,
      );
  }
}
