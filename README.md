# MarketMate API

NestJS API, Prisma and PostgreSQL. Run commands from this repository with Node.js 22 and pnpm 10.18.2.

```sh
pnpm install --frozen-lockfile
cp .env.example .env # first setup only
docker compose up -d
pnpm db:generate
pnpm db:migrate
pnpm start:dev
```

For deployment, run `pnpm install --frozen-lockfile`, `pnpm db:generate` and `pnpm build`. Apply migrations with `pnpm exec prisma migrate deploy` and start with `pnpm start`. Run `pnpm check` for type checking.

Authentication, business profiles, catalogue, Marketing Studio, graphics and the planner are implemented. Studio and Planner now include an OpenAI Responses integration plus an explicitly labelled development-only local generator. OpenAI remains disabled until server configuration is complete; live-model and database integration tests are deferred. See docs/marketmate/pr-live-marketing-generation.md. The sales-document implementation adds customers, quotation/invoice drafts, issuance, manual payments, reversals and private PDFs. Its database-backed validation remains pending; see docs/marketmate/pr-sales-documents.md.

The browser uses the same-origin `/api` proxy; `API_ORIGIN` defaults to `http://127.0.0.1:4100`. `WEB_ORIGIN` must exactly match the browser origin. Sessions use HttpOnly, SameSite=Strict cookies, with Secure enabled in production. Serve production through HTTPS.

Development emails are saved to `.local-mail/` with restricted permissions when `MAIL_MODE=file`. Open the link in the newest message for your test email. This directory is ignored by Git. Production disables file delivery and requires `BREVO_API_KEY`, `MAIL_FROM`, a verified sender and an approved HTTPS `WEB_ORIGIN`. Real email delivery is unverified.

`pnpm start:dev` compiles and starts the API; run `pnpm build` after backend edits to trigger the process watcher.

After starting both apps, run `node test/identity.mjs` for database-backed HTTP checks using synthetic accounts. These checks add test accounts and email files; use an isolated database. Restart the test API before rerunning the suite to reset local rate limits.

Database migrations are under `prisma/migrations`. Use `pnpm prisma migrate deploy` to apply committed migrations. No existing financial data is assumed or reset.

Product photos use private Cloudflare R2. Follow the [R2 setup guide](docs/marketmate/r2-setup.md) before trying a live upload. To check installed dependency versions and resolution, run `node scripts/check-dependencies.mjs`. With the test database migrated and backend built, run `node test/run-catalogue.mjs` to test the API with synthetic accounts and a local S3-compatible server.

Limits per API process: 1,200 requests/minute per incoming IP, 240 reads and 120 writes/minute per signed-in owner, 30 account actions/15 minutes per IP, and 30 upload requests/minute per owner. Limited requests return `429` and `Retry-After`. Behind a proxy, configure `TRUST_PROXY` with the actual trusted forwarding IPs or CIDRs and have the proxy replace untrusted forwarding headers; without that setting, IP limits apply to the immediate peer. Use a shared limiter before running multiple API instances.


## Sales documents

Apply the committed migrations before starting the updated API. Open `/invoices` to create a customer and draft quotation or invoice. Save and review the server totals before issuing. Issuance freezes the document and queues a private PDF; missing storage produces a retriable PDF error without losing the invoice number. Product and customer edits cannot rewrite issued snapshots. Manual payments and reversals are owner-entered records, not bank verification or money transfers.

- `pnpm test:sales-unit` checks exact money calculations.
- `pnpm test:sales-pdf` checks PDF text, totals and 50-line pagination (requires `pdftotext`). Synthetic PDFs are written under `/tmp/marketmate-sales-qa`.
- Configure `TEST_DATABASE_URL` with an isolated PostgreSQL database whose name contains `test`, then run `pnpm test:sales`. This applies migrations to that test database, builds the API and runs HTTP tests with synthetic accounts and local S3-compatible storage. It never uses `DATABASE_URL` as a fallback.
- Swagger is at `/api/docs`, with the JSON specification at `/api/docs-json`. It is read-only documentation, enabled in development and explicitly enabled in production with `SWAGGER_ENABLED=true`. Sales input schemas are annotated; legacy feature schemas still need completion.
- `SALES_LAUNCH_APPROVED=true` is required for production issuance after the finance and financial-retention review. Development/test issuance is available without this flag. No default statutory tax rate is assumed.

Sales PDFs use PDFKit and the bundled Noto Sans Latin font package. Extended-script names require font coverage QA before those languages are supported. Existing issued PDFs are private objects; historical-object retention/cleanup belongs to the operations milestone.

### OpenAI setup and offline verification

Use `.env.example` for server-only configuration. Set `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_DAILY_BUDGET_USD`, both token-price variables and `AI_PRICE_VERSION` before live testing. Prices are USD per million tokens; use current prices for the selected model. No model or spending cap is assumed. Disable `STUDIO_LOCAL_GENERATOR` to use OpenAI. Incomplete configuration keeps generation unavailable while manual drafts remain usable.

`pnpm test:ai-unit` runs simulated provider and budget checks without a database or network requests. Apply the sales and AI migrations only during the deferred database integration pass. Home activity requires those migrations too.

### Logos, sharing and capacities

Settings supports private logo uploads and displays active-product/storage allowances. All new files use Cloudflare R2. Populate the R2 credentials and asset-signing secret in `.env`; `.env.example` documents the fields. See `docs/marketmate/pr-marketing-completion.md` for setup and deferred verification.

Approved promotions support device sharing with download/copy fallbacks. Profiles, existing products, Studio captions and unfinished Planner items autosave after a one-second pause. Conflicts preserve the current text for review; unsaved edits remain only in the current tab.

`pnpm test:marketing-unit` runs offline capacity, R2 adapter and logo checks. Migration `202611180001_marketing_completion` is prepared but has not been applied.
