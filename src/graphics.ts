import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Query, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { IsIn, IsUUID } from 'class-validator';
import { randomUUID } from 'node:crypto';
import sharp, { type OverlayOptions } from 'sharp';
import { Assets } from './assets';
import { SessionGuard, type Request } from './auth';
import { Catalogue } from './catalogue';
import { Database } from './database';
import { R2Storage } from './r2';
import { RateLimits } from './rate-limits';
import { digest } from './security';
import { monthBounds, Studio } from './studio';

class GraphicInput {
  @IsUUID() draftId!: string;
  @IsIn(['spotlight', 'offer', 'service']) layout!: 'spotlight' | 'offer' | 'service';
  @IsIn(['square', 'story']) format!: 'square' | 'story';
}
type Spec = Awaited<ReturnType<Graphics['specification']>>;
type Headers = { setHeader(name: string, value: string): void };
const maxPng = 12 * 1024 * 1024;
const escapeMarkup = (value: string) => value.replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]!);

export async function renderGraphic(spec: Spec, photo?: Buffer, logo?: Buffer) {
  const width = 1080;
  const height = spec.format === 'story' ? 1920 : 1080;
  const accent = spec.brandColor;
  const offer = spec.layout === 'offer';
  const service = spec.layout === 'service';
  const background = offer ? accent : service ? '#e8f4ed' : '#f9fafb';
  const foreground = offer ? '#ffffff' : '#172720';
  const layers: OverlayOptions[] = [];
  const card = (w: number, h: number, color: string) => ({ create: { width: w, height: h, channels: 4 as const, background: color } });
  const text = async (label: string, size: number, min: number, y: number, available: number, color = foreground, bold = false, x = 72, zone = 936) => {
    for (let fontSize = size; fontSize >= min; fontSize -= 2) {
      const { data, info } = await sharp({ text: {
        text: `<span foreground="${color}" weight="${bold ? 'bold' : 'normal'}">${escapeMarkup(label)}</span>`,
        font: `sans ${fontSize}`, width: zone, rgba: true, dpi: 72, wrap: 'word-char',
      } }).png().toBuffer({ resolveWithObject: true });
      if (info.height <= available && info.width <= zone) {
        layers.push({ input: data, left: x, top: y });
        return;
      }
    }
    throw new BadRequestException('Text does not fit this layout. Shorten the draft headline or update the source details.');
  };
  if (logo) {
    layers.push({ input: await sharp(logo).resize(86, 86, { fit: 'contain', background: '#ffffff00' }).png().toBuffer(), left: 72, top: 52 });
  }
  await text(spec.facts.brand, 34, 26, 62, 86, foreground, true, logo ? 184 : 72, logo ? 824 : 936);
  const imageTop = 165;
  const imageHeight = height === 1920 ? 900 : 408;
  const imageWidth = service ? 780 : 936;
  const imageLeft = service ? 150 : 72;
  const image = photo
    ? await sharp(photo).resize(imageWidth, imageHeight, { fit: 'contain', background: '#edf2ef' }).png().toBuffer()
    : await sharp(card(imageWidth, imageHeight, accent)).png().toBuffer();
  layers.push({ input: image, left: imageLeft, top: imageTop });
  if (!photo) await text('Service invitation', 48, 36, imageTop + Math.floor(imageHeight / 2) - 28, 80, '#ffffff', true, imageLeft + 42, imageWidth - 84);
  const start = imageTop + imageHeight + 38;
  await text(spec.headline, 60, 42, start, 138, foreground, true);
  if (spec.facts.product !== spec.headline) await text(spec.facts.product, 30, 24, start + 139, 52);
  const price = spec.facts.price === null ? 'Price on request' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(spec.facts.price / 100);
  await text(price, 46, 36, start + 196, 52, offer ? '#ffffff' : accent, true);
  if (spec.facts.expires) {
    const expires = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(spec.facts.expires));
    await text(`Offer ends ${expires} (Lagos time)`, 25, 23, start + 255, 36);
  }
  if (spec.offerTerms) await text(spec.offerTerms, 24, 20, start + 294, height === 1920 ? 190 : 80);
  const contactTop = height === 1920 ? 1695 : 991;
  if (spec.offerTerms && height === 1080) {
    const terms = layers.at(-1)?.input;
    if (Buffer.isBuffer(terms) && (await sharp(terms).metadata()).height! + start + 294 > contactTop - 10) throw new BadRequestException('Offer terms are too long for the square graphic. Try the story format.');
  }
  await text(`${service ? 'Enquire' : 'Contact us'} · ${spec.facts.contact}`, 30, 22, contactTop, height - contactTop - 28, foreground, true);
  return sharp(card(width, height, background)).composite(layers).png().toBuffer();
}

@Injectable()
export class Graphics {
  constructor(private db: Database, private catalogue: Catalogue, private studio: Studio, private assets: Assets, private storage: R2Storage) {}

  async specification(businessId: string, jobId: string, userId: string, input: GraphicInput) {
    const source = await this.studio.review(businessId, jobId, input.draftId, userId, 'graphic');
    if (!('headline' in source) || !source.facts) throw new ConflictException('Approve the draft before rendering.');
    if (input.layout === 'offer' && !source.facts.expires) throw new BadRequestException('The offer layout requires an approved active offer draft.');
    if (input.layout === 'service' && source.productType !== 'SERVICE') throw new BadRequestException('Choose a service draft for this layout.');
    if (source.productType !== 'SERVICE' && !source.photoId) throw new BadRequestException('Add a product photo and approve a new draft before rendering.');
    if (Array.from(source.headline).length > 70) throw new BadRequestException('Shorten the first sentence of the draft to 70 characters, then approve the new revision.');
    const color = source.brandColor;
    const rgb = /^#[0-9a-f]{6}$/i.test(color) ? [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16) / 255) : [1, 1, 1];
    const luminance = rgb.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    const contrast = 1.05 / (0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2] + 0.05);
    return { ...source, facts: source.facts, brandColor: contrast >= 5 ? color : '#166534', draftId: input.draftId, layout: input.layout, format: input.format, jobId, templateVersion: 2 };
  }

  async create(req: Request, jobId: string, input: GraphicInput, response: Headers, rate: RateLimits) {
    const businessId = await this.catalogue.businessId(req);
    rate.enforce(response, 'graphic-render', businessId, 8);
    const spec = await this.specification(businessId, jobId, req.user.id, input);
    const hash = digest(JSON.stringify(spec));
    const objectKey = `businesses/${businessId}/graphics/${randomUUID()}.png`;
    const reservation = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      const where = { businessId_hash: { businessId, hash } };
      const previous = await tx.studioGraphic.findUnique({ where });
      if (previous?.status === 'ready') return previous;
      const cutoff = new Date(Date.now() - 120000);
      if (previous?.status === 'pending' && previous.updatedAt > cutoff) throw new ConflictException('This graphic is rendering. Retry shortly.');
      await tx.studioGraphic.updateMany({ where: { businessId, status: 'pending', updatedAt: { lte: cutoff } }, data: { status: 'failed' } });
      const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
      const { start: period } = monthBounds(business.createdAt);
      const pending = await tx.studioGraphic.count({ where: { businessId, status: 'pending' } });
      if (pending >= 2) throw new ConflictException('Wait for a graphic to finish before starting another.');
      const used = await tx.studioGraphic.count({ where: { businessId, period, status: { in: ['ready', 'pending'] } } });
      const limit = Math.max(0, Number(process.env.STUDIO_MONTHLY_GRAPHICS ?? 100) || 0);
      if (used >= limit) throw new ConflictException('Your monthly graphic allowance has been reached.');
      this.storage.requireConfigured();
      const fields = { objectKey, status: 'pending', period };
      return tx.studioGraphic.upsert({ where, update: fields, create: { ...fields, businessId, hash, draftId: input.draftId, specification: spec } });
    });
    if (reservation.status === 'ready') return { id: reservation.id };
    let uploaded = false;
    try {
      const photo = spec.photoId ? await this.assets.readOwned(businessId, spec.photoId, 'full') : undefined;
      const logo = spec.logoKey ? await this.storage.get(spec.logoKey, 10 * 1024 * 1024) : undefined;
      const png = await renderGraphic(spec, photo, logo);
      if (png.length > maxPng) throw new BadRequestException('The graphic is too large. Try a different photo.');
      const current = await this.specification(businessId, jobId, req.user.id, input);
      if (digest(JSON.stringify(current)) !== hash) throw new ConflictException('The source changed. Render a new graphic.');
      uploaded = true;
      await this.storage.put(objectKey, png, 'image/png');
      const saved = await this.db.studioGraphic.updateMany({ where: { id: reservation.id, objectKey, status: 'pending' }, data: { status: 'ready' } });
      if (!saved.count) throw new ConflictException('The render expired. Retry the graphic.');
      return { id: reservation.id };
    } catch (error) {
      const current = await this.db.studioGraphic.findUnique({ where: { id: reservation.id } }).catch(() => undefined);
      if (current?.status === 'ready' && current.objectKey === objectKey) return { id: reservation.id };
      if (current !== undefined) {
        await this.db.studioGraphic.updateMany({ where: { id: reservation.id, objectKey, status: 'pending' }, data: { status: 'failed' } }).catch(() => {});
        if (uploaded) await this.storage.discard([objectKey]);
      }
      throw error;
    }
  }

  async file(req: Request, id: string) {
    const businessId = await this.catalogue.businessId(req);
    const graphic = await this.db.studioGraphic.findFirst({ where: { id, businessId, status: 'ready' } });
    if (!graphic) throw new NotFoundException('Graphic not found.');
    const spec = graphic.specification as unknown as Spec;
    const input = { draftId: spec.draftId, layout: spec.layout, format: spec.format };
    const validate = async () => {
      const current = await this.specification(businessId, spec.jobId, req.user.id, input);
      if (digest(JSON.stringify(current)) !== graphic.hash) throw new ConflictException('The source changed. Review a new draft and render it again.');
    };
    await validate();
    const file = await this.storage.get(graphic.objectKey, maxPng);
    await validate();
    return file;
  }
}

@Controller()
@UseGuards(SessionGuard)
export class GraphicsController {
  constructor(private graphics: Graphics, private rate: RateLimits) {}

  @Post('studio/:jobId/graphics')
  create(@Req() req: Request, @Param('jobId', ParseUUIDPipe) jobId: string, @Body() input: GraphicInput, @Res({ passthrough: true }) res: Headers) {
    return this.graphics.create(req, jobId, input, res, this.rate);
  }

  @Get('studio/graphics/:id/file')
  async file(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Query('download') download: string | undefined, @Res({ passthrough: true }) res: Headers) {
    this.rate.enforce(res, 'graphic-file', req.user.id, 30);
    const file = await this.graphics.file(req, id);
    return new StreamableFile(file, { type: 'image/png', disposition: `${download === '1' ? 'attachment' : 'inline'}; filename="marketmate-${id}.png"` });
  }
}
