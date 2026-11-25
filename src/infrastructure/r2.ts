import { Database } from './database';
import { reserveStorage } from './capacity';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class R2Storage {
  private readonly client?: S3Client;
  private readonly bucket?: string;
  private readonly logger = new Logger(R2Storage.name);

  constructor(private readonly db: Database) {
    const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_TEST_ENDPOINT, R2_JURISDICTION } = process.env;
    if (!R2_ACCOUNT_ID || !R2_BUCKET || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return;
    if (!/^[a-f0-9]{32}$/i.test(R2_ACCOUNT_ID)) throw new Error('R2_ACCOUNT_ID must be the Cloudflare account ID.');
    if (R2_JURISDICTION && !['eu', 'fedramp'].includes(R2_JURISDICTION)) throw new Error('R2_JURISDICTION must be empty, "eu", or "fedramp". The S3 region "auto" is already configured separately.');
    const jurisdiction = R2_JURISDICTION ? `.${R2_JURISDICTION}` : '';
    let endpoint = `https://${R2_ACCOUNT_ID}${jurisdiction}.r2.cloudflarestorage.com`;
    if (R2_TEST_ENDPOINT) {
      const test = new URL(R2_TEST_ENDPOINT);
      if (process.env.NODE_ENV !== 'test' || test.protocol !== 'http:' || test.hostname !== '127.0.0.1') throw new Error('R2_TEST_ENDPOINT is limited to loopback in tests.');
      endpoint = test.origin;
    }
    this.bucket = R2_BUCKET;
    this.client = new S3Client({
      endpoint, region: 'auto', forcePathStyle: true, maxAttempts: 2,
      credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  requireConfigured() {
    if (!this.client || !this.bucket) throw new ServiceUnavailableException('Cloudflare R2 storage is not configured yet. Your saved details are still available.');
    return { client: this.client, bucket: this.bucket };
  }

  private unavailable(operation: string, key: string, message: string, cause: unknown) {
    // Log diagnostic fields only: SDK responses and database errors may contain secrets.
    const error = cause as {
      name?: string; code?: string; errorCode?: string; cause?: { code?: string };
      $metadata?: { httpStatusCode?: number; requestId?: string };
    } | null | undefined;
    this.logger.warn({
      message: 'Storage operation failed.', operation, key,
      errorName: error?.name, errorCode: error?.code ?? error?.errorCode ?? error?.cause?.code,
      httpStatus: error?.$metadata?.httpStatusCode, requestId: error?.$metadata?.requestId,
    });
    return new ServiceUnavailableException(message, { cause });
  }

  async put(key: string, bytes: Buffer, contentType: string) {
    const { client, bucket } = this.requireConfigured();
    const businessId = /^businesses\/([^/]+)\//.exec(key)?.[1];
    if (!businessId) throw new Error('Storage keys must belong to a business.');
    await this.db.$transaction(tx => reserveStorage(tx, businessId, key, bytes.length));
    try {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType, ContentLength: bytes.length, CacheControl: 'private, no-store' }), { abortSignal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw this.unavailable('PutObject', key, 'File storage is temporarily unavailable. Keep your file and retry.', error);
    }
  }

  async get(key: string, maxBytes: number) {
    const { client, bucket } = this.requireConfigured();
    try {
      const object = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15000) });
      if (!object.Body || !object.ContentLength || object.ContentLength > maxBytes) {
        if (object.Body && 'destroy' in object.Body) object.Body.destroy();
        throw new Error('Unexpected stored file size.');
      }
      return Buffer.from(await object.Body.transformToByteArray());
    } catch (error) {
      throw this.unavailable('GetObject', key, 'This file is temporarily unavailable. Please retry.', error);
    }
  }

  async remove(key: string) {
    const { client, bucket } = this.requireConfigured();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: AbortSignal.timeout(15000) });
    } catch (error) {
      throw this.unavailable('DeleteObject', key, 'File removal is pending. Please retry.', error);
    }
    try {
      await this.db.storedObject.deleteMany({ where: { key } });
    } catch (error) {
      throw this.unavailable('StoredObject.deleteMany', key, 'File removal is pending. Please retry.', error);
    }
  }

  async discard(keys: string[]) {
    const results = await Promise.allSettled(keys.map(key => this.remove(key)));
    const failedKeys = keys.filter((_, index) => results[index].status === 'rejected');
    if (failedKeys.length) this.logger.warn({
      message: 'Unattached object cleanup failed.', failedCount: failedKeys.length,
      attemptedCount: keys.length, failedKeys,
    });
  }
}
