import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
@Injectable()
export class Mail {
  async send(email: string, purpose: string, rawToken: string) {
    const origin = process.env.WEB_ORIGIN || 'http://localhost:3000';
    const path = purpose === 'verify' ? 'verify-email' : 'reset-password';
    const link = `${origin}/${path}#token=${rawToken}`;
    const subject = purpose === 'verify' ? 'Verify your MarketMate email' : 'Reset your MarketMate password';
    if (process.env.NODE_ENV !== 'production' && process.env.MAIL_MODE === 'file') {
      const dir = process.env.MAIL_DIRECTORY || '.local-mail';
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ to: email, subject, link }), { mode: 0o600 });
      return;
    }
    if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM) throw new ServiceUnavailableException('Email delivery is unavailable. Please try again later.');
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender: { email: process.env.MAIL_FROM, name: 'MarketMate' }, to: [{ email }], subject, textContent: `${subject}: ${link}\nIf you did not request this, ignore this message.` }),
    }).catch(() => null);
    if (!response?.ok) throw new ServiceUnavailableException('Email delivery is unavailable. Please try again later.');
  }
}
