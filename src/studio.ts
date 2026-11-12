import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, Param, Post, Req, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Catalogue, productView } from './catalogue';
import { Database } from './database';
import { SessionGuard, type Request } from './auth';
import { RateLimits } from './rate-limits';
import { digest } from './security';

class Brief {
  @IsUUID() productId!: string;
  @IsUUID() key!: string;
  @IsIn(['inquiries', 'offer', 'launch']) goal!: string;
  @IsIn(['instagram', 'whatsapp', 'description', 'ideas']) channel!: string;
  @IsIn(['friendly', 'professional', 'energetic']) tone!: string;
  @IsBoolean() manual!: boolean;
  @IsOptional() @IsInt() productVersion?: number;
  @IsOptional() @IsInt() businessVersion?: number;
  @IsOptional() @IsUUID() sourceDraftId?: string;
}
class DraftInput {
  @IsUUID() draftId!: string;
  @IsString() @Length(1, 1200) text!: string;
}
class DraftId { @IsUUID() draftId!: string; }
class Feedback extends DraftId { @IsIn(['facts', 'language']) issue!: string; }
class ArchiveInput { @IsBoolean() archived!: boolean; }

type Facts = {
  product: string; description: string; productVersion: number; businessVersion: number;
  brand: string; contact: string; price: number | null; expires: string | null;
  goal: string; channel: string; tone: string; policy: number;
};
const draftInclude = { drafts: { orderBy: [{ variant: 'asc' as const }, { revision: 'desc' as const }] } };
const allowance = () => Math.max(0, Number(process.env.STUDIO_MONTHLY_UNITS ?? 25) || 0);
function monthBounds(anchor: Date, now = new Date()) {
  const boundary = (offset: number) => {
    const date = new Date(anchor);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(last, anchor.getUTCDate()));
    return date;
  };
  let offset = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + now.getUTCMonth() - anchor.getUTCMonth();
  if (boundary(offset) > now) offset--;
  return { start: boundary(offset), end: boundary(offset + 1) };
}
function validateText(text: string, channel: string) {
  const limit = channel === 'facts' ? Infinity : channel === 'whatsapp' ? 600 : channel === 'description' ? 800 : 1200;
  if (channel !== 'facts' && /\p{Sc}|https?:|\b(?:NGN|naira|kobo)\b|\d{3,}|\d\s*%/iu.test(text)) throw new BadRequestException('Use saved prices and contacts instead of typing amounts, discounts or links into copy.');
  if (text.length > limit) throw new BadRequestException(`Keep the copy within ${limit} characters.`);
  if (/\b(weapons?|firearms?|gambling|casino|controlled drugs|sexual services|guaranteed profits?|miracle cure|cures?|nafdac approved|vote for)\b/i.test(text)) {
    throw new BadRequestException({ code: 'RESTRICTED_CONTENT', message: 'Remove restricted products or unsupported claims before continuing.' });
  }
}
function assemble(text: string, facts: Facts) {
  const price = facts.price === null ? 'Price on request' : new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(facts.price / 100);
  const expiry = facts.expires ? `\nOffer ends ${new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(facts.expires))} (Lagos time)` : '';
  return `${text}\n\n${price}${expiry}\nContact ${facts.brand}: ${facts.contact}`;
}

function validateDraft(text: string, facts: Facts) {
  validateText(text, facts.channel);
  validateText(assemble(text, facts), 'facts');
  const limit = facts.channel === 'whatsapp' ? 600 : facts.channel === 'description' ? 800 : 1200;
  if (assemble(text, facts).length > limit) throw new BadRequestException('Shorten your copy to leave room for the saved price and contact details.');
}

@Injectable()
export class Studio implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private db: Database, private catalogue: Catalogue) {}
  onModuleInit() { this.timer = setInterval(() => void this.tick().catch(() => {}), 1000); }
  onModuleDestroy() { clearInterval(this.timer); }
  get localEnabled() { return process.env.NODE_ENV !== 'production' && process.env.STUDIO_LOCAL_GENERATOR === 'true'; }

  async usage(businessId: string, tx: Prisma.TransactionClient = this.db) {
    const business = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    const period = monthBounds(business.createdAt);
    const counts = await tx.studioJob.groupBy({ by: ['status'], where: { businessId, period: period.start }, _sum: { units: true } });
    const used = counts.find(row => row.status === 'ready')?._sum.units ?? 0;
    const reserved = counts.find(row => row.status === 'pending')?._sum.units ?? 0;
    return { used, reserved, limit: allowance(), remaining: Math.max(0, allowance() - used - reserved), ...period, localEnabled: this.localEnabled };
  }

  async facts(businessId: string, input: Pick<Brief, 'productId' | 'goal' | 'channel' | 'tone'>, tx: Prisma.TransactionClient = this.db): Promise<Facts> {
    const product = productView(await this.catalogue.owned(businessId, input.productId, tx));
    const brand = await tx.business.findUniqueOrThrow({ where: { id: businessId } });
    if (product.archivedAt || !brand.contact || !brand.name.trim()) throw new BadRequestException('Select an active product and complete your business name and public contact.');
    if (input.goal === 'offer' && product.offer?.state !== 'active') throw new BadRequestException('Select a product with an active offer.');
    const offer = input.goal === 'offer' ? product.offer : null;
    validateText([product.name, product.category, product.description, brand.name].join(' '), 'facts');
    return { product: product.name, description: product.description, brand: brand.name, contact: brand.contact,
      price: offer?.promoPriceKobo ?? product.priceKobo, expires: offer?.endsAt.toISOString() ?? null,
      productVersion: product.version, businessVersion: brand.version, goal: input.goal, channel: input.channel, tone: input.tone, policy: 1 };
  }

  async start(businessId: string, input: Brief) {
    const fingerprint = digest(JSON.stringify([input.productId, input.goal, input.channel, input.tone, input.manual, input.productVersion, input.businessVersion]));
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      const previous = await tx.studioJob.findUnique({ where: { businessId_key: { businessId, key: input.key } } });
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new ConflictException('This request key is already in use.');
        return previous;
      }
      const facts = await this.facts(businessId, input, tx);
      if (facts.productVersion !== input.productVersion || facts.businessVersion !== input.businessVersion) throw new ConflictException('Review the current facts before starting a draft.');
      const usage = await this.usage(businessId, tx);
      if (!input.manual && !this.localEnabled) throw new ServiceUnavailableException('Generation is unavailable. You can start a manual draft.');
      if (!input.manual && !usage.remaining) throw new ConflictException('Your generation allowance has been reached.');
      let text = '';
      if (input.sourceDraftId) {
        if (!input.manual) throw new BadRequestException('Duplicate into a manual draft.');
        const source = await tx.studioDraft.findFirst({ where: { id: input.sourceDraftId, job: { businessId, productId: input.productId } } });
        if (!source) throw new NotFoundException('Source draft not found.');
        text = source.text;
      }
      return tx.studioJob.create({ data: { businessId, productId: input.productId, key: input.key, fingerprint,
        facts, period: usage.start, units: input.manual ? 0 : 1, status: input.manual ? 'ready' : 'pending',
        drafts: input.manual ? { create: { variant: 1, revision: 1, text } } : undefined } });
    });
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.db.studioJob.updateMany({ where: { status: 'pending', createdAt: { lt: new Date(Date.now() - 600000) } }, data: { status: 'failed', error: 'This request expired. Start a new draft.' } });
      if (!this.localEnabled) return;
      const job = await this.db.studioJob.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
      if (!job) return;
      const facts = job.facts as unknown as Facts;
      const subject = facts.goal === 'offer' ? 'See the current offer on' : facts.goal === 'launch' ? 'Introducing' : 'Find out more about';
      const texts = [
        `${subject} ${facts.product}. ${facts.description}`.trim(),
        `Interested in ${facts.product}? Ask ${facts.brand} for details.`,
        facts.tone === 'energetic' ? `Take a look at ${facts.product}!` : facts.tone === 'professional' ? `Learn about ${facts.product} from ${facts.brand}.` : `Explore ${facts.product} from ${facts.brand}.`,
      ];
      if (facts.channel === 'ideas') texts.splice(0, 3, `Introduce ${facts.product} in a product spotlight.`, `Invite questions about ${facts.product} in a short post.`, `Feature ${facts.product} in a catalogue roundup.`);
      try {
        if (Date.now() - job.createdAt.getTime() > 600000) throw new Error('Expired');
        for (const text of texts) validateDraft(text, facts);
        await this.db.$transaction(async tx => {
          const claimed = await tx.studioJob.updateMany({ where: { id: job.id, status: 'pending' }, data: { status: 'ready' } });
          if (claimed.count) await tx.studioDraft.createMany({ data: texts.map((text, index) => ({ jobId: job.id, variant: index + 1, revision: 1, text })) });
        });
      } catch {
        await this.db.studioJob.updateMany({ where: { id: job.id, status: 'pending' }, data: { status: 'failed', error: 'The draft could not be generated. Try a shorter product description or start a manual draft.' } });
      }
    } finally { this.running = false; }
  }

  async owned(businessId: string, id: string, tx: Prisma.TransactionClient = this.db) {
    const job = await tx.studioJob.findFirst({ where: { id, businessId }, include: draftInclude });
    if (!job) throw new NotFoundException('Draft request not found.');
    return job;
  }

  async review(businessId: string, id: string, draftId: string, userId: string, operation: 'edit' | 'approve' | 'copy', text?: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "StudioJob" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
      const job = await this.owned(businessId, id, tx);
      const draft = job.drafts.find(item => item.id === draftId);
      if (!draft) throw new NotFoundException('Draft version not found.');
      if (job.archived || job.drafts.some(item => item.variant === draft.variant && item.revision > draft.revision)) throw new ConflictException('Open the latest version of an active draft.');
      const facts = job.facts as unknown as Facts;
      const value = (text ?? draft.text).trim();
      if (!value) throw new BadRequestException('Enter draft text first.');
      validateDraft(value, facts);
      if (operation === 'edit') return tx.studioDraft.create({ data: { jobId: id, variant: draft.variant, revision: draft.revision + 1, text: value } });
      const current = await this.facts(businessId, { productId: job.productId, ...facts }, tx);
      if (current.productVersion !== facts.productVersion || current.businessVersion !== facts.businessVersion || current.expires !== facts.expires) throw new ConflictException('Product, offer or business facts changed. Start a new draft.');
      if (operation === 'approve') return draft.approvedAt ? draft : tx.studioDraft.update({ where: { id: draft.id }, data: { approvedAt: new Date(), approvedBy: userId } });
      if (!draft.approvedAt) throw new ConflictException('Approve this version before copying it.');
      return { text: assemble(value, facts) };
    });
  }
}

@Controller('studio')
@UseGuards(SessionGuard)
export class StudioController {
  constructor(private studio: Studio, private catalogue: Catalogue, private db: Database, private rate: RateLimits) {}
  @Get()
  async list(@Req() req: Request) {
    const businessId = await this.catalogue.businessId(req);
    return { total: await this.db.studioJob.count({ where: { businessId, archived: false } }), usage: await this.studio.usage(businessId), jobs: await this.db.studioJob.findMany({ where: { businessId }, orderBy: { createdAt: 'desc' }, take: 50 }) };
  }
  @Post('preview')
  async preview(@Req() req: Request, @Body() brief: Brief) { return this.studio.facts(await this.catalogue.businessId(req), brief); }
  @Post() @HttpCode(202)
  async start(@Req() req: Request, @Res({ passthrough: true }) res: { setHeader(name: string, value: string): void }, @Body() brief: Brief) {
    const businessId = await this.catalogue.businessId(req);
    this.rate.enforce(res, 'studio-start', businessId, 5);
    if (!brief.manual && !req.user.verifiedAt) throw new BadRequestException('Verify your email before generating samples.');
    return this.studio.start(businessId, brief);
  }
  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) { return this.studio.owned(await this.catalogue.businessId(req), id); }
  @Post(':id/edit')
  async edit(@Req() req: Request, @Param('id') id: string, @Body() input: DraftInput) { return this.studio.review(await this.catalogue.businessId(req), id, input.draftId, req.user.id, 'edit', input.text); }
  @Post(':id/approve')
  async approve(@Req() req: Request, @Param('id') id: string, @Body() input: DraftId) { return this.studio.review(await this.catalogue.businessId(req), id, input.draftId, req.user.id, 'approve'); }
  @Post(':id/copy')
  async copy(@Req() req: Request, @Param('id') id: string, @Body() input: DraftId) { return this.studio.review(await this.catalogue.businessId(req), id, input.draftId, req.user.id, 'copy'); }
  @Post(':id/feedback')
  async feedback(@Req() req: Request, @Param('id') id: string, @Body() input: Feedback) {
    const job = await this.studio.owned(await this.catalogue.businessId(req), id);
    if (!job.drafts.some(draft => draft.id === input.draftId)) throw new NotFoundException('Draft version not found.');
    await this.db.studioDraft.update({ where: { id: input.draftId }, data: { feedback: input.issue } });
    return { saved: true };
  }
  @Post(':id/archive')
  async archive(@Req() req: Request, @Param('id') id: string, @Body() input: ArchiveInput) {
    const job = await this.studio.owned(await this.catalogue.businessId(req), id);
    return this.db.studioJob.update({ where: { id: job.id }, data: input });
  }
}
