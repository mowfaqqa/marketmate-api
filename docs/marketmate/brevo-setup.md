# Brevo email verification

MarketMate uses Brevo's transactional email HTTP API for signup verification,
verification resends and password resets. No SMTP library or Brevo template is needed.

## Configure Brevo

1. Create an API key in your Brevo account under **Settings → SMTP & API → API Keys**.
   Use an API key, not an SMTP key. Keep it on the backend only.
2. Add your sending domain in **Settings → Senders, Domains, IPs** and authenticate it
   with the DNS records Brevo provides. Add a sender address under **Senders** and
   complete sender verification if prompted. `MAIL_FROM` must match this address.
3. Ensure transactional sending is enabled for your Brevo account.

References: [Brevo transactional email API](https://developers.brevo.com/docs/send-a-transactional-email)
and [create a verified sender](https://help.brevo.com/hc/en-us/articles/208836149-Create-a-new-sender-From-name-and-From-email).

## Configure the backend

Edit `backend/.env` (ignored by Git):

```dotenv
MAIL_MODE=brevo
BREVO_API_KEY=your_brevo_api_key
MAIL_FROM=no-reply@your-domain.com
MAIL_FROM_NAME=MarketMate
WEB_ORIGIN=http://localhost:3000
```

Replace the key and sender with real values. `MAIL_FROM` contains only the email
address; put the display name in `MAIL_FROM_NAME`. Never use a `NEXT_PUBLIC_` variable
for the key. Existing unrelated `.env` settings must be preserved.

`WEB_ORIGIN` is the frontend's exact browser origin, with no path, query or fragment.
Use your actual HTTPS frontend origin in production. It must also match the origin
allowed by the API's request checks. Restart the backend after editing `.env`:

```sh
cd backend
pnpm start:dev
```

For local delivery without Brevo, use `MAIL_MODE=file`; messages are saved in
`MAIL_DIRECTORY` (default `.local-mail`). File delivery is rejected in production.
If `MAIL_MODE` is unset, Brevo is selected for compatibility with existing deployments.

## Verify delivery

1. Register with an inbox you control, or sign in and open **Settings → Resend
   verification email** for an existing unverified account.
2. Check Brevo's transactional logs and your inbox/spam folder. An accepted API
   request does not guarantee inbox delivery.
3. Open the full `/verify-email#token=…` link and click **Verify email**. Verification
   links expire after 24 hours and are single-use. Reload Settings to confirm
   **Email verified**. Test an already-used link to confirm it is rejected.
4. Password-reset links use the same provider and expire after 30 minutes.

The URL fragment carries the secret token. Confirm the full fragment survives any
mail-client or provider link rewriting in your real inbox test.

`pnpm test:mail` builds the backend and exercises the adapter using mocked Brevo
responses and temporary local files. It sends no email and needs no database or key.
The existing `node test/identity.mjs` suite checks the database-backed verification
flow using file delivery; run it only against an isolated test database and API.

## Troubleshooting

- **Mail is saved locally:** set `MAIL_MODE=brevo` and restart the API.
- **503 / delivery unavailable:** check backend logs. They report missing settings,
  network failure or Brevo's HTTP status without printing keys, recipients or tokens.
  Check the API key, verified sender, account sending status and quota in Brevo.
- **Account exists after a failed signup email:** signup may already have created
  the account. Sign in with that password, fix delivery configuration and resend
  verification from Settings.
- **Link opens the wrong website:** correct `WEB_ORIGIN`, restart the API and resend.
- **Invalid or expired link:** request a new verification email from Settings.
