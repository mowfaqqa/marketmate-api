import { BadRequestException, Body, CanActivate, ExecutionContext, ConflictException, Controller, Delete, Get, Headers, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, ServiceUnavailableException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { Database } from './database';
import { SessionGuard, type Request } from './auth';
import { Catalogue, productView } from './catalogue';
import { UploadInput } from './catalogue.dto';
import { digest, token } from './security';
import { R2Storage } from './r2';
import { RateLimits } from './rate-limits';

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;

export async function prepareImage(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_BYTES) throw new BadRequestException('Choose a JPEG, PNG or WebP image up to 10 MB.');
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const webp = buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (!jpeg && !png && !webp) throw new BadRequestException('This file is not a supported JPEG, PNG or WebP image.');
  try {
    const image = sharp(buffer, { limitInputPixels: MAX_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS || (metadata.pages || 1) > 1) throw new Error('Invalid dimensions or animation.');
    const full = await image.rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).timeout({ seconds: 15 }).toBuffer({ resolveWithObject: true });
    const preview = await sharp(full.data).resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
    return { content: full.data, preview, width: full.info.width, height: full.info.height, bytes: full.data.length, checksum: digest(full.data) };
  } catch {
    throw new BadRequestException('The photo could not be read. Use a still JPEG, PNG or WebP up to 20 megapixels.');
  }
}

@Injectable()
export class UploadRateGuard implements CanActivate {
  constructor(private readonly rate: RateLimits) {}
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    this.rate.enforce(context.switchToHttp().getResponse(), 'photo-upload', req.user.id, 30);
    return true;
  }
}

@Injectable()
export class Assets {
  private readonly signingKey: string;
  private processing = 0;
  constructor(private readonly db: Database, private readonly catalogue: Catalogue, private readonly storage: R2Storage) {
    if (process.env.NODE_ENV === 'production' && (process.env.ASSET_SIGNING_KEY?.length || 0) < 32) throw new Error('ASSET_SIGNING_KEY must contain at least 32 characters.');
    this.signingKey = process.env.ASSET_SIGNING_KEY || randomBytes(32).toString('hex');
  }

  async authorizeUpload(req: Request, productId: string, input: UploadInput) {
    const businessId = await this.catalogue.businessId(req);
    const product = await this.catalogue.owned(businessId, productId);
    if (product.archivedAt || product.version !== input.version) throw new ConflictException('Reload the active saved product before adding a photo.');
    this.storage.requireConfigured();
    const pending = await this.db.mediaAsset.count({ where: { businessId, status: 'PENDING', uploadExpiresAt: { gt: new Date() } } });
    if (pending >= 5) throw new ConflictException('Finish your pending photo uploads or wait 15 minutes before starting another.');
    const uploadToken = token();
    const asset = await this.db.mediaAsset.create({ data: { businessId, productId, productVersion: input.version, uploadTokenHash: digest(uploadToken), uploadExpiresAt: new Date(Date.now() + 15 * 60000) } });
    return { id: asset.id, uploadToken, expiresAt: asset.uploadExpiresAt };
  }

  async complete(req: Request, id: string, rawToken: string | undefined, file: { buffer: Buffer } | undefined) {
    const businessId = await this.catalogue.businessId(req);
    const asset = await this.db.mediaAsset.findUnique({ where: { businessId_id: { businessId, id } }, omit: { content: true, preview: true } });
    if (!asset) throw new NotFoundException('Photo not found.');
    if (!rawToken || digest(rawToken) !== asset.uploadTokenHash || asset.uploadExpiresAt <= new Date()) throw new BadRequestException('This upload authorization expired or is invalid. Start the upload again.');
    if (asset.status === 'DELETING') throw new NotFoundException('Photo not found.');
    if (asset.status === 'READY') return productView(await this.catalogue.owned(businessId, asset.productId));
    if (!file) throw new BadRequestException('Choose a photo to upload.');
    if (this.processing >= 2) throw new ServiceUnavailableException('Other photos are being prepared. Keep this page open and retry shortly.');
    this.storage.requireConfigured();
    this.processing++;
    let staged: { fullKey: string; previewKey: string } | undefined;
    try {
      let prepared;
      try { prepared = await prepareImage(file.buffer); }
      catch (error) { await this.db.mediaAsset.updateMany({ where: { businessId, id, status: { in: ['PENDING', 'REJECTED'] } }, data: { status: 'REJECTED' } }); throw error; }
      const prefix = `businesses/${businessId}/photos/${asset.objectKey}/${randomUUID()}`;
      staged = { fullKey: `${prefix}/full.webp`, previewKey: `${prefix}/preview.webp` };
      const { content, preview, ...metadata } = prepared;
      const writes = await Promise.allSettled([
        this.storage.put(staged.fullKey, content, 'image/webp'),
        this.storage.put(staged.previewKey, preview, 'image/webp'),
      ]);
      const failed = writes.find(result => result.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      const keys = staged;
      const result = await this.db.$transaction(async tx => {
        const claimed = await tx.mediaAsset.updateMany({ where: { businessId, id, status: { in: ['PENDING', 'REJECTED'] }, uploadExpiresAt: { gt: new Date() } }, data: { ...metadata, ...keys, status: 'READY' } });
        if (!claimed.count) {
          const current = await tx.mediaAsset.findUnique({ where: { businessId_id: { businessId, id } }, select: { status: true } });
          if (current?.status !== 'READY') throw new ConflictException('This upload ended before the photo was saved. Start it again.');
          return { attached: false, product: productView(await this.catalogue.owned(businessId, asset.productId, tx)) };
        }
        await this.catalogue.bump(tx, businessId, asset.productId, asset.productVersion);
        const product = await this.catalogue.owned(businessId, asset.productId, tx);
        if (product.archivedAt) throw new ConflictException('Restore the product before adding a photo.');
        await tx.product.update({ where: { businessId_id: { businessId, id: asset.productId } }, data: { primaryAssetId: id } });
        return { attached: true, product: productView(await this.catalogue.owned(businessId, asset.productId, tx)) };
      });
      if (!result.attached) await this.storage.discard(Object.values(keys));
      return result.product;
    } catch (error) {
      if (staged) {
        const current = await this.db.mediaAsset.findUnique({ where: { businessId_id: { businessId, id } }, select: { fullKey: true } }).catch(() => undefined);
        if (current !== undefined && current?.fullKey !== staged.fullKey) await this.storage.discard(Object.values(staged));
      }
      throw error;
    } finally { this.processing--; }
  }

  async remove(req: Request, id: string) {
    const businessId = await this.catalogue.businessId(req);
    const asset = await this.db.mediaAsset.findUnique({ where: { businessId_id: { businessId, id } }, select: { id: true } });
    if (!asset) throw new NotFoundException('Photo not found.');
    const removed = await this.db.mediaAsset.updateMany({ where: { businessId, id, status: { in: ['READY', 'DELETING'] }, primaryFor: { none: {} } }, data: { status: 'DELETING' } });
    if (!removed.count) throw new ConflictException('This photo is still in use or is not ready for removal.');
    const keys = await this.db.mediaAsset.findUniqueOrThrow({ where: { businessId_id: { businessId, id } }, select: { fullKey: true, previewKey: true } });
    for (const key of [keys.fullKey, keys.previewKey]) if (key) await this.storage.remove(key);
    await this.db.mediaAsset.updateMany({ where: { businessId, id, status: 'DELETING' }, data: { fullKey: null, previewKey: null, content: null, preview: null } });
    return { message: 'Unreferenced photo removed.' };
  }

  private signature(id: string, sessionId: string, size: string, expires: string) {
    return createHmac('sha256', this.signingKey).update(`${id}:${sessionId}:${size}:${expires}`).digest('hex');
  }

  async authorizeRead(req: Request, id: string) {
    const businessId = await this.catalogue.businessId(req);
    const asset = await this.db.mediaAsset.findUnique({ where: { businessId_id: { businessId, id } }, select: { status: true } });
    if (!asset || asset.status !== 'READY') throw new NotFoundException('Photo not found.');
    const expires = String(Date.now() + 2 * 60000);
    const url = (size: string) => `/api/assets/${id}/file?size=${size}&expires=${expires}&signature=${this.signature(id, req.sessionId, size, expires)}`;
    return { previewUrl: url('preview'), fullUrl: url('full'), expiresAt: new Date(Number(expires)).toISOString() };
  }

  async read(req: Request, id: string, size: string, expires: string, signature: string) {
    const businessId = await this.catalogue.businessId(req);
    if (!['preview', 'full'].includes(size) || !/^\d{13}$/.test(expires || '') || Number(expires) <= Date.now() || Number(expires) > Date.now() + 2 * 60000 || !/^[a-f0-9]{64}$/.test(signature || '')) throw new NotFoundException('This photo link has expired. Reload the page.');
    const expected = this.signature(id, req.sessionId, size, expires);
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new NotFoundException('Photo not found.');
    return this.readOwned(businessId, id, size === 'full' ? 'full' : 'preview');
  }

  async readOwned(businessId: string, id: string, size: 'full' | 'preview') {
    const asset = await this.db.mediaAsset.findUnique({ where: { businessId_id: { businessId, id } }, select: { status: true, storageProvider: true, fullKey: true, previewKey: true } });
    if (!asset || asset.status !== 'READY') throw new NotFoundException('Photo not found.');
    const key = size === 'full' ? asset.fullKey : asset.previewKey;
    if (key) return this.storage.get(key, MAX_BYTES);
    if (asset.storageProvider === 'LEGACY_DB') {
      const legacy = await this.db.mediaAsset.findUnique({ where: { businessId_id: { businessId, id }, status: 'READY' }, select: { content: size === 'full', preview: size === 'preview' } });
      const bytes = size === 'full' ? legacy?.content : legacy?.preview;
      if (bytes) return Buffer.from(bytes);
    }
    throw new NotFoundException('Photo not found.');
  }
}

@Controller() @UseGuards(SessionGuard)
export class AssetsController {
  constructor(private readonly assets: Assets) {}

  @Post('products/:id/image-upload') @UseGuards(UploadRateGuard)
  async authorize(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() input: UploadInput) { return this.assets.authorizeUpload(req, id, input); }

  @Post('assets/:id/complete') @UseGuards(UploadRateGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 1 } }))
  async complete(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Headers('x-upload-token') uploadToken: string | undefined, @UploadedFile() file: { buffer: Buffer } | undefined) { return this.assets.complete(req, id, uploadToken, file); }

  @Post('assets/:id/authorize')
  async authorizeRead(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.assets.authorizeRead(req, id); }

  @Delete('assets/:id')
  async remove(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string) { return this.assets.remove(req, id); }

  @Get('assets/:id/file')
  async file(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('size') size: string, @Query('expires') expires: string, @Query('signature') signature: string, @Res() response: { setHeader(k: string, v: string): void; send(data: Buffer): void }) {
    const bytes = await this.assets.read(req, id, size, expires, signature);
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Disposition', `inline; filename="${id}.webp"`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.send(bytes);
  }
}
