import { lockBusiness, requireProductCapacity } from "./capacity";
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Database } from "./database";
import { SessionGuard, type Request } from "./auth";
import {
  ArchiveInput,
  OfferInput,
  ProductInput,
  ProductQuery,
  ProductUpdate,
  VersionInput,
} from "./catalogue.dto";

export const productInclude = {
  primaryAsset: {
    select: { id: true, width: true, height: true, status: true },
  },
  offers: {
    orderBy: [
      { status: "asc" as const },
      { createdAt: "desc" as const },
      { id: "desc" as const },
    ],
    take: 1,
  },
} satisfies Prisma.ProductInclude;
type ProductRecord = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;
export function productView(product: ProductRecord) {
  const now = Date.now();
  const offer = product.offers[0];
  const offerState = !offer
    ? null
    : offer.status === "CANCELLED"
      ? "cancelled"
      : offer.endsAt.getTime() <= now
        ? "expired"
        : offer.startsAt.getTime() > now
          ? "scheduled"
          : "active";
  const discountBasisPoints =
    offer && product.priceKobo && offer.promoPriceKobo < product.priceKobo
      ? Number(
          ((product.priceKobo - offer.promoPriceKobo) * 10000n) /
            product.priceKobo,
        )
      : null;
  const { offers, ...rest } = product;
  return {
    ...rest,
    priceKobo: product.priceKobo === null ? null : Number(product.priceKobo),
    graphicsReady:
      !product.archivedAt &&
      (product.type === "SERVICE" || product.primaryAsset?.status === "READY"),
    offer: offer
      ? {
          ...offer,
          promoPriceKobo: Number(offer.promoPriceKobo),
          assertedPriorPriceKobo:
            offer.assertedPriorPriceKobo === null
              ? null
              : Number(offer.assertedPriorPriceKobo),
          state: offerState,
          discountBasisPoints,
        }
      : null,
  };
}

@Injectable()
export class Catalogue {
  constructor(private readonly db: Database) {}

  async businessId(req: Request) {
    const membership = await this.db.membership.findUnique({
      where: { userId: req.user.id },
    });
    if (!membership) throw new NotFoundException("Business not found.");
    return membership.businessId;
  }

  async owned(
    businessId: string,
    id: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const product = await tx.product.findUnique({
      where: { businessId_id: { businessId, id } },
      include: productInclude,
    });
    if (!product) throw new NotFoundException("Product not found.");
    return product;
  }

  async bump(
    tx: Prisma.TransactionClient,
    businessId: string,
    id: string,
    version: number,
  ) {
    const result = await tx.product.updateMany({
      where: { businessId, id, version },
      data: { version: { increment: 1 } },
    });
    if (!result.count) {
      await this.owned(businessId, id, tx);
      throw new ConflictException(
        "This product changed in another tab. Copy your edits and reload the saved product.",
      );
    }
  }

  private fields(input: ProductInput) {
    if (!input.name.trim())
      throw new BadRequestException("Enter a product name.");
    if (input.pricingMode === "INQUIRY" && input.priceKobo !== null)
      throw new BadRequestException(
        "Price on request requires an empty price.",
      );
    const { clientId, ...data } = input;
    return {
      ...data,
      name: input.name.trim(),
      priceKobo: input.priceKobo === null ? null : BigInt(input.priceKobo),
    };
  }

  async create(businessId: string, input: ProductInput) {
    const data = this.fields(input);
    const existing = await this.db.product.findUnique({
      where: { businessId_id: { businessId, id: input.clientId } },
      include: productInclude,
    });
    if (existing) {
      const matches = Object.entries(data).every(
        ([key, value]) => existing[key as keyof typeof existing] === value,
      );
      if (!matches)
        throw new ConflictException(
          "This product was already saved with different details. Open the saved product to continue editing.",
        );
      return productView(existing);
    }
    try {
      return await this.db.$transaction(async (tx) => {
        await lockBusiness(tx, businessId);
        const retry = await tx.product.findUnique({
          where: { businessId_id: { businessId, id: input.clientId } },
          include: productInclude,
        });
        if (retry) {
          if (
            !Object.entries(data).every(
              ([key, value]) => retry[key as keyof typeof retry] === value,
            )
          )
            throw new ConflictException(
              "This product was saved with different details.",
            );
          return productView(retry);
        }
        await requireProductCapacity(tx, businessId);
        return productView(
          await tx.product.create({
            data: { ...data, id: input.clientId, businessId },
            include: productInclude,
          }),
        );
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const retry = await this.db.product.findUnique({
          where: { businessId_id: { businessId, id: input.clientId } },
          include: productInclude,
        });
        if (
          retry &&
          Object.entries(data).every(
            ([key, value]) => retry[key as keyof typeof retry] === value,
          )
        )
          return productView(retry);
        throw new ConflictException(
          "Unable to save this product. Start a new product and try again.",
        );
      }
      throw error;
    }
  }

  async list(businessId: string, query: ProductQuery) {
    const where: Prisma.ProductWhereInput = {
      businessId,
      archivedAt: query.status === "archived" ? { not: null } : null,
      name: { contains: query.search, mode: "insensitive" },
    };
    const [total, products, activeCount, archivedCount] =
      await this.db.$transaction([
        this.db.product.count({ where }),
        this.db.product.findMany({
          where,
          include: productInclude,
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip: (query.page - 1) * 20,
          take: 20,
        }),
        this.db.product.count({ where: { businessId, archivedAt: null } }),
        this.db.product.count({
          where: { businessId, archivedAt: { not: null } },
        }),
      ]);
    return {
      items: products.map(productView),
      total,
      page: query.page,
      pageSize: 20,
      activeCount,
      archivedCount,
    };
  }

  async update(businessId: string, id: string, input: ProductUpdate) {
    if (input.clientId !== id)
      throw new BadRequestException("Product identity cannot be changed.");
    const { version, ...fields } = input;
    const data = this.fields(fields);
    return this.db.$transaction(async (tx) => {
      await this.bump(tx, businessId, id, version);
      const product = await this.owned(businessId, id, tx);
      if (product.archivedAt)
        throw new ConflictException("Restore this product before editing it.");
      const offer = product.offers[0];
      if (
        offer?.status === "ENABLED" &&
        offer.endsAt > new Date() &&
        (data.pricingMode === "INQUIRY" ||
          data.priceKobo === null ||
          offer.promoPriceKobo >= data.priceKobo)
      ) {
        throw new ConflictException(
          "Cancel the current offer before changing to an incompatible price.",
        );
      }
      return productView(
        await tx.product.update({
          where: { businessId_id: { businessId, id } },
          data,
          include: productInclude,
        }),
      );
    });
  }

  async archive(businessId: string, id: string, input: ArchiveInput) {
    return this.db.$transaction(async (tx) => {
      await lockBusiness(tx, businessId);
      const current = await this.owned(businessId, id, tx);
      if (!input.archived && current.archivedAt)
        await requireProductCapacity(tx, businessId);
      await this.bump(tx, businessId, id, input.version);
      return productView(
        await tx.product.update({
          where: { businessId_id: { businessId, id } },
          data: { archivedAt: input.archived ? new Date() : null },
          include: productInclude,
        }),
      );
    });
  }

  async saveOffer(businessId: string, id: string, input: OfferInput) {
    const startsAt = new Date(input.startsAt),
      endsAt = new Date(input.endsAt);
    const hasZone = (value: string) => /(Z|[+-]\d{2}:\d{2})$/i.test(value);
    if (
      !hasZone(input.startsAt) ||
      !hasZone(input.endsAt) ||
      endsAt <= startsAt ||
      endsAt.getTime() <= Date.now()
    )
      throw new BadRequestException(
        "Use dated times with a timezone. The end must follow the start and still be in the future.",
      );
    return this.db.$transaction(async (tx) => {
      await this.bump(tx, businessId, id, input.version);
      const product = await this.owned(businessId, id, tx);
      if (product.archivedAt)
        throw new ConflictException(
          "Restore this product before creating an offer.",
        );
      if (
        product.pricingMode !== "FIXED" ||
        !product.priceKobo ||
        BigInt(input.promoPriceKobo) >= product.priceKobo
      )
        throw new BadRequestException(
          "The offer price must be lower than the current fixed price.",
        );
      if (
        input.assertedPriorPriceKobo !== null &&
        input.assertedPriorPriceKobo <= input.promoPriceKobo
      )
        throw new BadRequestException(
          "An asserted prior price must be higher than the offer price.",
        );
      await tx.offer.updateMany({
        where: { businessId, productId: id, status: "ENABLED" },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      await tx.offer.create({
        data: {
          businessId,
          productId: id,
          promoPriceKobo: input.promoPriceKobo,
          assertedPriorPriceKobo: input.assertedPriorPriceKobo,
          startsAt,
          endsAt,
          terms: input.terms,
        },
      });
      return productView(await this.owned(businessId, id, tx));
    });
  }

  async cancelOffer(businessId: string, id: string, input: VersionInput) {
    return this.db.$transaction(async (tx) => {
      await this.bump(tx, businessId, id, input.version);
      await tx.offer.updateMany({
        where: { businessId, productId: id, status: "ENABLED" },
        data: { status: "CANCELLED", version: { increment: 1 } },
      });
      return productView(await this.owned(businessId, id, tx));
    });
  }
}

@Controller("products")
@UseGuards(SessionGuard)
export class CatalogueController {
  constructor(private readonly catalogue: Catalogue) {}

  @Get()
  async list(@Req() req: Request, @Query() query: ProductQuery) {
    return this.catalogue.list(await this.catalogue.businessId(req), query);
  }

  @Post()
  async create(@Req() req: Request, @Body() input: ProductInput) {
    return this.catalogue.create(await this.catalogue.businessId(req), input);
  }

  @Get(":id")
  async get(@Req() req: Request, @Param("id", ParseUUIDPipe) id: string) {
    return productView(
      await this.catalogue.owned(await this.catalogue.businessId(req), id),
    );
  }

  @Put(":id")
  async update(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: ProductUpdate,
  ) {
    return this.catalogue.update(
      await this.catalogue.businessId(req),
      id,
      input,
    );
  }

  @Patch(":id/archive")
  async archive(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: ArchiveInput,
  ) {
    return this.catalogue.archive(
      await this.catalogue.businessId(req),
      id,
      input,
    );
  }

  @Put(":id/offer")
  async offer(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: OfferInput,
  ) {
    return this.catalogue.saveOffer(
      await this.catalogue.businessId(req),
      id,
      input,
    );
  }

  @Post(":id/offer/cancel")
  async cancel(
    @Req() req: Request,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() input: VersionInput,
  ) {
    return this.catalogue.cancelOffer(
      await this.catalogue.businessId(req),
      id,
      input,
    );
  }
}
