import { HttpException, Injectable } from '@nestjs/common';

type Headers = { setHeader(name: string, value: string): void };
@Injectable()
export class RateLimits {
  private readonly entries = new Map<string, { count: number; expiresAt: number }>();
  private nextSweep = 0;

  take(scope: string, subject: string, limit: number, windowMs: number) {
    const now = Date.now();
    if (now >= this.nextSweep) {
      for (const [key, entry] of this.entries) if (entry.expiresAt <= now) this.entries.delete(key);
      this.nextSweep = now + 60000;
    }
    const key = `${scope}:${subject}`;
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (!entry && this.entries.size >= 50000) return 60;
      this.entries.set(key, { count: 1, expiresAt: now + windowMs });
      return 0;
    }
    if (entry.count >= limit) return Math.ceil((entry.expiresAt - now) / 1000);
    entry.count++;
    return 0;
  }

  enforce(response: Headers, scope: string, subject: string, limit: number, windowMs = 60000) {
    const retryAfter = this.take(scope, subject, limit, windowMs);
    if (!retryAfter) return;
    response.setHeader('Retry-After', String(retryAfter));
    throw new HttpException({ message: 'Too many requests. Wait and try again.', retryAfter }, 429);
  }
}
