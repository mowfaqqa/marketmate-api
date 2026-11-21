import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from "class-validator";
import { Catalogue, productView } from "./catalogue";
import { Database } from "./database";
import { SessionGuard, type Request } from "./auth";
import { RateLimits } from "./rate-limits";
import { digest } from "./security";
import { Facts, validateText, validateDraft, assemble } from "./ai/content";
import { generationMode, openAIConfig } from "./ai/config";
export { validateDraft } from "./ai/content";

class Brief {
  @IsUUID() productId!: string;
  @IsUUID() key!: string;
  @IsIn(["inquiries", "offer", "launch"]) goal!: string;
  @IsIn(["instagram", "whatsapp", "description", "ideas"]) channel!: string;
  @IsIn(["friendly", "professional", "energetic"]) tone!: string;
  @IsBoolean() manual!: boolean;
  @IsOptional() @IsInt() productVersion?: number;
  @IsOptional() @IsInt() businessVersion?: number;
  @IsOptional() @IsUUID() sourceDraftId?: string;
}
class DraftInput {
  @IsUUID() draftId!: string;
  @IsString() @Length(1, 1200) text!: string;
}
class DraftId {
  @IsUUID() draftId!: string;
}
class Feedback extends DraftId {
  @IsIn(["facts", "language"]) issue!: string;
}
class ArchiveInput {
  @IsBoolean() archived!: boolean;
}

const draftInclude = {
  drafts: {
    orderBy: [{ variant: "asc" as const }, { revision: "desc" as const }],
  },
};
const allowance = () =>
  Math.max(0, Number(process.env.STUDIO_MONTHLY_UNITS ?? 25) || 0);
export function monthBounds(anchor: Date, now = new Date()) {
  const boundary = (offset: number) => {
    const date = new Date(anchor);
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + offset);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(last, anchor.getUTCDate()));
    return date;
  };
  let offset =
    (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    now.getUTCMonth() -
    anchor.getUTCMonth();
  if (boundary(offset) > now) offset--;
  return { start: boundary(offset), end: boundary(offset + 1) };
}
@Injectable()
export class Studio {
  constructor(
    private db: Database,
    private catalogue: Catalogue,
  ) {}
  get localEnabled() {
    return generationMode() === "local";
  }
  get generationEnabled() {
    return generationMode() !== "disabled";
  }

  async usage(businessId: string, tx: Prisma.TransactionClient = this.db) {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });
    const period = monthBounds(business.createdAt);
    const counts = await tx.studioJob.groupBy({
      by: ["status"],
      where: { businessId, period: period.start },
      _sum: { units: true },
    });
    const plans = await tx.marketingPlan.groupBy({
      by: ["status"],
      where: { businessId, period: period.start },
      _sum: { units: true },
    });
    const used =
      (counts.find((row) => row.status === "ready")?._sum.units ?? 0) +
      (plans.find((row) => row.status === "ready")?._sum.units ?? 0);
    const reserved =
      counts
        .filter((row) => ["pending", "running"].includes(row.status))
        .reduce((sum, row) => sum + (row._sum.units ?? 0), 0) +
      (plans.find((row) => row.status === "pending")?._sum.units ?? 0);
    return {
      used,
      reserved,
      limit: allowance(),
      remaining: Math.max(0, allowance() - used - reserved),
      ...period,
      localEnabled: this.localEnabled,
      generationEnabled: this.generationEnabled,
      generationMode: generationMode(),
    };
  }

  async facts(
    businessId: string,
    input: Pick<Brief, "productId" | "goal" | "channel" | "tone">,
    tx: Prisma.TransactionClient = this.db,
  ): Promise<Facts> {
    const product = productView(
      await this.catalogue.owned(businessId, input.productId, tx),
    );
    const brand = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });
    if (product.archivedAt || !brand.contact || !brand.name.trim())
      throw new BadRequestException(
        "Select an active product and complete your business name and public contact.",
      );
    if (input.goal === "offer" && product.offer?.state !== "active")
      throw new BadRequestException("Select a product with an active offer.");
    const offer = input.goal === "offer" ? product.offer : null;
    validateText(
      [
        product.name,
        product.category,
        product.description,
        brand.name,
        product.materialSize,
        product.serviceArea,
        product.fulfilmentTerms,
        product.confirmedClaims,
      ].join(" "),
      "facts",
    );
    return {
      product: product.name,
      description: product.description,
      brand: brand.name,
      contact: brand.contact,
      price: offer?.promoPriceKobo ?? product.priceKobo,
      expires: offer?.endsAt.toISOString() ?? null,
      productVersion: product.version,
      businessVersion: brand.version,
      goal: input.goal,
      channel: input.channel,
      tone: input.tone,
      policy: 2,
      locale: "en-NG",
      attributes: {
        materialSize: product.materialSize,
        serviceArea: product.serviceArea,
        fulfilmentTerms: product.fulfilmentTerms,
        confirmedClaims: product.confirmedClaims,
      },
    };
  }

  async start(businessId: string, input: Brief) {
    const fingerprint = digest(
      JSON.stringify([
        input.productId,
        input.goal,
        input.channel,
        input.tone,
        input.manual,
        input.productVersion,
        input.businessVersion,
        input.sourceDraftId,
      ]),
    );
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      const previous = await tx.studioJob.findUnique({
        where: { businessId_key: { businessId, key: input.key } },
      });
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new ConflictException("This request key is already in use.");
        return previous;
      }
      const facts = await this.facts(businessId, input, tx);
      if (
        facts.productVersion !== input.productVersion ||
        facts.businessVersion !== input.businessVersion
      )
        throw new ConflictException(
          "Review the current facts before starting a draft.",
        );
      const usage = await this.usage(businessId, tx);
      if (!input.manual && !this.generationEnabled)
        throw new ServiceUnavailableException(
          "Generation is unavailable. You can start a manual draft.",
        );
      if (!input.manual && !usage.remaining)
        throw new ConflictException(
          "Your generation allowance has been reached.",
        );
      let text = "";
      if (input.sourceDraftId) {
        if (!input.manual)
          throw new BadRequestException("Duplicate into a manual draft.");
        const source = await tx.studioDraft.findFirst({
          where: {
            id: input.sourceDraftId,
            job: { businessId, productId: input.productId },
          },
        });
        if (!source) throw new NotFoundException("Source draft not found.");
        text = source.text;
      }
      return tx.studioJob.create({
        data: {
          businessId,
          productId: input.productId,
          key: input.key,
          fingerprint,
          facts,
          period: usage.start,
          units: input.manual ? 0 : 1,
          status: input.manual ? "ready" : "pending",
          provider: input.manual ? "manual" : generationMode(),
          model:
            !input.manual && generationMode() === "openai"
              ? openAIConfig()!.model
              : null,
          drafts: input.manual
            ? { create: { variant: 1, revision: 1, text } }
            : undefined,
        },
      });
    });
  }

  async owned(
    businessId: string,
    id: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const job = await tx.studioJob.findFirst({
      where: { id, businessId },
      include: draftInclude,
    });
    if (!job) throw new NotFoundException("Draft request not found.");
    return job;
  }

  async review(
    businessId: string,
    id: string,
    draftId: string,
    userId: string,
    operation: "edit" | "approve" | "copy" | "graphic",
    text?: string,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "StudioJob" WHERE id = ${id} AND "businessId" = ${businessId} FOR UPDATE`;
      const job = await this.owned(businessId, id, tx);
      const draft = job.drafts.find((item) => item.id === draftId);
      if (!draft) throw new NotFoundException("Draft version not found.");
      if (
        job.archived ||
        job.drafts.some(
          (item) =>
            item.variant === draft.variant && item.revision > draft.revision,
        )
      )
        throw new ConflictException(
          "Open the latest version of an active draft.",
        );
      const facts = job.facts as unknown as Facts;
      const value = (text ?? draft.text).trim();
      if (!value) throw new BadRequestException("Enter draft text first.");
      validateDraft(value, facts);
      if (operation === "edit")
        return tx.studioDraft.create({
          data: {
            jobId: id,
            variant: draft.variant,
            revision: draft.revision + 1,
            text: value,
          },
        });
      const current = await this.facts(
        businessId,
        { productId: job.productId, ...facts },
        tx,
      );
      if (
        current.productVersion !== facts.productVersion ||
        current.businessVersion !== facts.businessVersion ||
        current.expires !== facts.expires
      )
        throw new ConflictException(
          "Product, offer or business facts changed. Start a new draft.",
        );
      if (operation === "approve")
        return draft.approvedAt
          ? draft
          : tx.studioDraft.update({
              where: { id: draft.id },
              data: { approvedAt: new Date(), approvedBy: userId },
            });
      if (!draft.approvedAt)
        throw new ConflictException("Approve this version before copying it.");
      if (operation === "graphic") {
        const product = await this.catalogue.owned(
          businessId,
          job.productId,
          tx,
        );
        const business = await tx.business.findUniqueOrThrow({
          where: { id: businessId },
        });
        if (
          product.version !== facts.productVersion ||
          business.version !== facts.businessVersion
        )
          throw new ConflictException(
            "The source changed. Review a new draft.",
          );
        return {
          facts,
          headline: value.split(/\r?\n|(?<=[.!?])\s/u)[0].trim(),
          brandColor: business.brandColor,
          logoKey: business.logoKey,
          photoId: product.primaryAssetId,
          productType: product.type,
          offerTerms:
            facts.goal === "offer" ? (product.offers[0]?.terms ?? "") : "",
        };
      }
      return { text: assemble(value, facts) };
    });
  }
}

@Controller("studio")
@UseGuards(SessionGuard)
export class StudioController {
  constructor(
    private studio: Studio,
    private catalogue: Catalogue,
    private db: Database,
    private rate: RateLimits,
  ) {}
  @Get()
  async list(@Req() req: Request) {
    const businessId = await this.catalogue.businessId(req);
    return {
      total: await this.db.studioJob.count({
        where: { businessId, archived: false },
      }),
      usage: await this.studio.usage(businessId),
      jobs: await this.db.studioJob.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    };
  }
  @Post("preview")
  async preview(@Req() req: Request, @Body() brief: Brief) {
    return this.studio.facts(await this.catalogue.businessId(req), brief);
  }
  @Post()
  @HttpCode(202)
  async start(
    @Req() req: Request,
    @Res({ passthrough: true })
    res: { setHeader(name: string, value: string): void },
    @Body() brief: Brief,
  ) {
    const businessId = await this.catalogue.businessId(req);
    this.rate.enforce(res, "studio-start", businessId, 5);
    if (!brief.manual && !req.user.verifiedAt)
      throw new BadRequestException(
        "Verify your email before generating content.",
      );
    return this.studio.start(businessId, brief);
  }
  @Get(":id")
  async get(@Req() req: Request, @Param("id") id: string) {
    return this.studio.owned(await this.catalogue.businessId(req), id);
  }
  @Post(":id/edit")
  async edit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: DraftInput,
  ) {
    return this.studio.review(
      await this.catalogue.businessId(req),
      id,
      input.draftId,
      req.user.id,
      "edit",
      input.text,
    );
  }
  @Post(":id/approve")
  async approve(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: DraftId,
  ) {
    return this.studio.review(
      await this.catalogue.businessId(req),
      id,
      input.draftId,
      req.user.id,
      "approve",
    );
  }
  @Post(":id/copy")
  async copy(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: DraftId,
  ) {
    return this.studio.review(
      await this.catalogue.businessId(req),
      id,
      input.draftId,
      req.user.id,
      "copy",
    );
  }
  @Post(":id/feedback")
  async feedback(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: Feedback,
  ) {
    const job = await this.studio.owned(
      await this.catalogue.businessId(req),
      id,
    );
    if (!job.drafts.some((draft) => draft.id === input.draftId))
      throw new NotFoundException("Draft version not found.");
    await this.db.studioDraft.update({
      where: { id: input.draftId },
      data: { feedback: input.issue },
    });
    return { saved: true };
  }
  @Post(":id/archive")
  async archive(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: ArchiveInput,
  ) {
    const job = await this.studio.owned(
      await this.catalogue.businessId(req),
      id,
    );
    return this.db.studioJob.update({ where: { id: job.id }, data: input });
  }
}
