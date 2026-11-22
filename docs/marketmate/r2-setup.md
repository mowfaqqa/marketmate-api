# Private Cloudflare R2 storage

Create or choose a private R2 bucket. Keep public access disabled and create an R2 API token with **Object Read & Write** permission scoped to that bucket. The backend needs to upload, read and delete objects; read-only credentials cannot clean up files. See [Cloudflare’s R2 API token instructions](https://developers.cloudflare.com/r2/api/tokens/).

Set these values in `.env` locally or in the API server’s secret settings:

```dotenv
R2_ACCOUNT_ID=<Cloudflare account ID>
R2_BUCKET=<private bucket name>
R2_ACCESS_KEY_ID=<bucket-scoped S3 access key ID>
R2_SECRET_ACCESS_KEY=<S3 secret access key>
R2_JURISDICTION=
ASSET_SIGNING_KEY=<random secret of at least 32 characters>
```

Leave `R2_JURISDICTION` empty for the default endpoint. For a jurisdiction endpoint, this backend supports `eu` or `fedramp`; use the value matching your bucket. Do not set it to `auto`: that is the S3 region, which the backend already configures separately. See [Cloudflare’s bucket region documentation](https://developers.cloudflare.com/r2/api/s3/api/#bucket-region). Set `ASSET_SIGNING_KEY` in production; `openssl rand -hex 32` can generate it. Keep these values out of Git and frontend environment variables. Restart the API after configuration.

The backend uses the [AWS SDK v3 integration documented by Cloudflare](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/). The browser uploads to the API, which validates and re-encodes the photo before writing it to R2. No public bucket or R2 browser CORS configuration is needed. Without credentials the API remains available, and new photo uploads return `503`.

For a live smoke test, upload a disposable photo through the catalogue, reload the product to verify its preview, and check that the private bucket contains the full image and preview. Live R2 verification is separate from the local S3-compatible tests. Existing development images stored before the R2 migration remain readable; new uploads do not add image bytes to the database.

If the API logs `Unattached object cleanup failed`, check the preceding `Storage operation failed` entries. They identify the operation, object key, error name/code, HTTP status and request ID without logging credentials or raw provider responses. `DeleteObject` with `403` / `AccessDenied` means R2 rejected the deletion: check the token's permissions and bucket scope. Create a correctly scoped token if needed, update `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` in `.env`, then restart the API. A successful bucket connection alone does not verify delete permission. `StoredObject.deleteMany` instead indicates that R2 deletion succeeded but updating the database storage accounting failed. Failed cleanup keeps the storage reservation; it is not automatically retried in the background.

Future file features should reuse `R2Storage`, validate file size and format, check tenant ownership, and apply a route limit matched to the operation cost.
