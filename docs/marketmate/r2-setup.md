# Private Cloudflare R2 storage

Create or choose a private R2 bucket. Keep public access disabled and use credentials scoped to object reads and writes on that bucket. See [Cloudflare’s R2 API token instructions](https://developers.cloudflare.com/r2/api/tokens/).

Set these values in `.env` locally or in the API server’s secret settings:

```dotenv
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_BUCKET=<private bucket name>
R2_ACCESS_KEY_ID=<bucket-scoped S3 access key ID>
R2_SECRET_ACCESS_KEY=<S3 secret access key>
R2_JURISDICTION=
ASSET_SIGNING_KEY=<random secret of at least 32 characters>
```

Leave `R2_JURISDICTION` empty unless your bucket uses a jurisdiction endpoint. Set `ASSET_SIGNING_KEY` in production; `openssl rand -hex 32` can generate it. Keep these values out of Git and frontend environment variables. Restart the API after configuration.

The backend uses the [AWS SDK v3 integration documented by Cloudflare](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/). The browser uploads to the API, which validates and re-encodes the photo before writing it to R2. No public bucket or R2 browser CORS configuration is needed. Without credentials the API remains available, and new photo uploads return `503`.

For a live smoke test, upload a disposable photo through the catalogue, reload the product to verify its preview, and check that the private bucket contains the full image and preview. Live R2 verification is separate from the local S3-compatible tests. Existing development images stored before the R2 migration remain readable; new uploads do not add image bytes to the database.

Future file features should reuse `R2Storage`, validate file size and format, check tenant ownership, and apply a route limit matched to the operation cost.
