import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req, Res, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { SessionGuard, type Request } from './auth';
import { Catalogue, productView } from './catalogue';
import { Database } from './database';
import { RateLimits } from './rate-limits';
import { Studio, validateDraft } from './studio';

const goals = ['inquiries', 'offer', 'launch'];
const channels = ['instagram', 'whatsapp'];
const dayMs = 86400000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const localToday = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);
const dateOffset = (date: string, offset: number) => new Date(Date.parse(date + 'T00:00:00Z') + offset * dayMs).toISOString().slice(0, 10);
const themes = ['Product spotlight', 'Start a conversation', 'Product introduction', 'Customer questions', 'Catalogue feature', 'Weekend spotlight', 'Weekly roundup'];
const tasks = ['Review your product photo.', 'Answer a common product question.', 'Check your current price.', 'Review the public contact details.', 'Pick a photo from your catalogue.', 'Review the caption before sharing.', 'Note which posts prompted inquiries.'];
const include = { days: { orderBy: { date: 'asc' as const }, include: { job: { include: {
  drafts: { orderBy: { revision: 'desc' as const }, take: 1 },
  product: { select: { name: true, archivedAt: true, version: true } },
} } } } };
type Headers = { setHeader(name: string, value: string): void };

class PlanInput {
  @IsUUID() key!: string;
  @Matches(datePattern) start!: string;
  @IsIn(goals) goal!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @ArrayUnique() @IsUUID(undefined, { each: true }) productIds!: string[];
}
class DayInput {
  @IsInt() @Min(0) revision!: number;
  @Matches(datePattern) date!: string;
  @IsIn(channels) channel!: string;
  @IsUUID() productId!: string;
  @IsString() @Length(1, 180) task!: string;
  @IsOptional() @IsString() @Length(1, 1200) text?: string;
  @IsBoolean() swap!: boolean;
  @IsBoolean() regenerate!: boolean;
  @IsBoolean() confirmDoneEdit!: boolean;
}
class Completion {
  @IsInt() @Min(0) revision!: number;
  @IsBoolean() done!: boolean;
}

@Injectable()
export class Planner {
  constructor(private db: Database, private studio: Studio, private catalogue: Catalogue) {}

  private requireGeneration(req: Request) {
    if (!this.studio.localEnabled) throw new ServiceUnavailableException('Planner generation is currently unavailable.');
    if (!req.user.verifiedAt) throw new BadRequestException('Verify your email before generating a plan.');
  }

  private async lock(tx: Prisma.TransactionClient, businessId: string) {
    await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
  }

  private async plan(tx: Prisma.TransactionClient, businessId: string, id: string) {
    const plan = await tx.marketingPlan.findFirst({ where: { businessId, id }, include });
    if (!plan) throw new NotFoundException('Plan not found.');
    return plan;
  }

  private async createDraft(tx: Prisma.TransactionClient, businessId: string, productId: string, goal: string, channel: string, date: string, units: number, period: Date, text?: string, variant = 0, fallbackOnExpiredOffer = false) {
    const product = productView(await this.catalogue.owned(businessId, productId, tx));
    const start = Date.parse(date + 'T00:00:00+01:00');
    const validOffer = product.offer?.state === 'active' && product.offer.startsAt.getTime() <= start && product.offer.endsAt.getTime() >= start + dayMs;
    const facts = await this.studio.facts(businessId, { productId, goal: goal === 'offer' && !validOffer ? 'inquiries' : goal, channel, tone: 'friendly' }, tx);
    const unavailableOffer = goal === 'offer' && !validOffer;
    const priorOfferCopy = text && /\b(?:offer|discount|sale|deal)\b/i.test(text);
    const retained = fallbackOnExpiredOffer && unavailableOffer && priorOfferCopy ? undefined : text;
    const caption = retained ?? [
      `${facts.goal === 'offer' ? 'Explore the current offer on' : facts.goal === 'launch' ? 'Introducing' : 'Take a look at'} ${facts.product}.`,
      `Have a question about ${facts.product}? Get in touch.`,
      `Find out more about ${facts.product} from ${facts.brand}.`,
    ][variant % 3];
    if (goal === 'offer' && !validOffer && /\b(?:offer|discount|sale|deal)\b/i.test(caption)) throw new BadRequestException('This date has no valid offer. Remove the offer language or regenerate.');
    if (!caption.trim()) throw new BadRequestException('Enter a caption.');
    validateDraft(caption.trim(), facts);
    return tx.studioJob.create({ data: {
      businessId, productId, key: randomUUID(), fingerprint: 'planner', period, units, facts, status: 'ready',
      drafts: { create: { variant: 1, revision: 1, text: caption.trim() } },
    } });
  }

  async list(businessId: string) {
    return { today: localToday(), enabled: this.studio.localEnabled, usage: await this.studio.usage(businessId),
      plans: await this.db.marketingPlan.findMany({ where: { businessId }, orderBy: [{ start: 'desc' }, { createdAt: 'desc' }], take: 30, include }) };
  }

  async create(req: Request, input: PlanInput) {
    const businessId = await this.catalogue.businessId(req);
    return this.db.$transaction(async tx => {
      await this.lock(tx, businessId);
      const where = { businessId_key: { businessId, key: input.key } };
      const existing = await tx.marketingPlan.findUnique({ where, include });
      if (existing) {
        if (existing.start !== input.start || existing.goal !== input.goal || JSON.stringify(existing.productIds) !== JSON.stringify(input.productIds)) throw new ConflictException('This request key is already in use.');
        return existing;
      }
      this.requireGeneration(req);
      const today = localToday();
      if (!Number.isFinite(Date.parse(input.start)) || dateOffset(input.start, 0) !== input.start || input.start < today || input.start > dateOffset(today, 30)) throw new BadRequestException('Choose a Lagos start date within the next 30 days.');
      const usage = await this.studio.usage(businessId, tx);
      if (usage.remaining < 3) throw new ConflictException('A weekly plan needs three available units.');
      const plan = await tx.marketingPlan.create({ data: { ...input, businessId } });
      for (let index = 0; index < 7; index++) {
        const date = dateOffset(input.start, index);
        const channel = channels[index % channels.length];
        const job = await this.createDraft(tx, businessId, input.productIds[index % input.productIds.length], input.goal, channel, date, index === 0 ? 3 : 0, usage.start, undefined, index);
        await tx.marketingDay.create({ data: { planId: plan.id, date, jobId: job.id, theme: themes[index], task: tasks[index] } });
      }
      return this.plan(tx, businessId, plan.id);
    });
  }

  async edit(req: Request, planId: string, dayId: string, input: DayInput) {
    const businessId = await this.catalogue.businessId(req);
    return this.db.$transaction(async tx => {
      await this.lock(tx, businessId);
      const plan = await this.plan(tx, businessId, planId);
      const day = plan.days.find(item => item.id === dayId);
      if (!day) throw new NotFoundException('Planner day not found.');
      if (day.revision !== input.revision) throw new ConflictException('This day changed. Reload your plan.');
      if (!plan.productIds.includes(input.productId)) throw new BadRequestException('Choose a product included in this plan.');
      const other = plan.days.find(item => item.date === input.date && item.id !== dayId);
      if (day.date !== input.date && (!other || !input.swap)) throw new ConflictException('Select Swap dates to move this item to another day of the plan.');
      if ((day.completedAt || other?.completedAt) && !input.confirmDoneEdit) throw new ConflictException('Confirm the edit. An earlier version may have been shared.');
      if (input.regenerate) this.requireGeneration(req);
      const usage = await this.studio.usage(businessId, tx);
      if (input.regenerate && usage.remaining < 1) throw new ConflictException('Regeneration needs one available unit.');
      const channel = day.job.facts as { channel: string };
      if (!input.regenerate && input.text === undefined) throw new BadRequestException('Enter a caption.');
      const job = await this.createDraft(tx, businessId, input.productId, plan.goal, input.channel, input.date, input.regenerate ? 1 : 0, usage.start, input.regenerate ? undefined : input.text, day.revision + 1);
      if (other) {
        await tx.marketingDay.update({ where: { id: day.id }, data: { date: '' } });
        const replacement = await this.createDraft(tx, businessId, other.job.productId, plan.goal, (other.job.facts as typeof channel).channel, day.date, 0, usage.start, other.job.drafts[0].text, 0, true);
        await tx.marketingDay.update({ where: { id: other.id }, data: { date: day.date, jobId: replacement.id, previousJobIds: { push: other.jobId }, revision: { increment: 1 }, completedAt: null, completedBy: null } });
        await tx.studioJob.update({ where: { id: other.jobId }, data: { archived: true } });
      }
      await tx.marketingDay.update({ where: { id: day.id }, data: { date: input.date, jobId: job.id, previousJobIds: { push: day.jobId }, task: input.task, revision: { increment: 1 }, completedAt: null, completedBy: null } });
      await tx.studioJob.update({ where: { id: day.jobId }, data: { archived: true } });
      return this.plan(tx, businessId, planId);
    });
  }

  async complete(req: Request, planId: string, dayId: string, input: Completion) {
    const businessId = await this.catalogue.businessId(req);
    return this.db.$transaction(async tx => {
      await this.lock(tx, businessId);
      const plan = await this.plan(tx, businessId, planId);
      const day = plan.days.find(item => item.id === dayId);
      if (!day) throw new NotFoundException('Planner day not found.');
      if (day.revision !== input.revision) throw new ConflictException('This day changed. Reload your plan.');
      if (input.done && !day.job.drafts[0]?.approvedAt) throw new ConflictException('Approve this caption before marking it done.');
      if (input.done && day.completedAt) return plan;
      await tx.marketingDay.update({ where: { id: day.id }, data: { completedAt: input.done ? new Date() : null, completedBy: input.done ? req.user.id : null, revision: { increment: 1 } } });
      return this.plan(tx, businessId, planId);
    });
  }
}

@Controller('planner')
@UseGuards(SessionGuard)
export class PlannerController {
  constructor(private planner: Planner, private catalogue: Catalogue, private rate: RateLimits) {}

  @Get()
  async list(@Req() req: Request) { return this.planner.list(await this.catalogue.businessId(req)); }

  @Post()
  create(@Req() req: Request, @Body() input: PlanInput, @Res({ passthrough: true }) res: Headers) {
    this.rate.enforce(res, 'plan-create', req.user.id, 5);
    return this.planner.create(req, input);
  }

  @Patch(':plan/days/:day')
  edit(@Req() req: Request, @Param('plan', ParseUUIDPipe) plan: string, @Param('day', ParseUUIDPipe) day: string, @Body() input: DayInput, @Res({ passthrough: true }) res: Headers) {
    this.rate.enforce(res, 'plan-edit', req.user.id, 20);
    return this.planner.edit(req, plan, day, input);
  }

  @Patch(':plan/days/:day/completion')
  complete(@Req() req: Request, @Param('plan', ParseUUIDPipe) plan: string, @Param('day', ParseUUIDPipe) day: string, @Body() input: Completion, @Res({ passthrough: true }) res: Headers) {
    this.rate.enforce(res, 'plan-completion', req.user.id, 30);
    return this.planner.complete(req, plan, day, input);
  }
}
