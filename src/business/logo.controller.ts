import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Post,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import {
  currentBusinessId,
  SessionGuard,
  type Request,
} from "../auth/session.guard";
import { prepareImage, MAX_BYTES } from "../assets/image";
import { UploadRateGuard } from "../assets/upload-rate.guard";
import { Database } from "../infrastructure/database";
import { R2Storage } from "../infrastructure/r2";
import { capacityLimits } from "../infrastructure/capacity";

@Controller("business")
@UseGuards(SessionGuard)
export class LogoController {
  constructor(
    private readonly db: Database,
    private readonly storage: R2Storage,
  ) {}
  private version(value: string) {
    if (!/^\d+$/.test(value ?? "") || !Number.isSafeInteger(Number(value)))
      throw new BadRequestException("Supply the saved business version.");
    return Number(value);
  }
  @Get("capacity")
  async capacity(@Req() req: Request) {
    const businessId = currentBusinessId(req);
    const [activeProducts, storage] = await Promise.all([
      this.db.product.count({ where: { businessId, archivedAt: null } }),
      this.db.storedObject.aggregate({
        where: { businessId },
        _sum: { bytes: true },
      }),
    ]);
    return {
      activeProducts,
      storageBytes: storage._sum.bytes ?? 0,
      limits: capacityLimits(),
    };
  }
  @Post("logo")
  @UseGuards(UploadRateGuard)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 1 },
    }),
  )
  async upload(
    @Req() req: Request,
    @Headers("x-business-version") rawVersion: string,
    @Headers("x-image-rights") rights: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    const businessId = currentBusinessId(req);
    const version = this.version(rawVersion);
    if (rights !== "confirmed" || !file)
      throw new BadRequestException(
        "Choose a logo and confirm you may use it.",
      );
    this.storage.requireConfigured();
    const original = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
    });
    if (original.version !== version)
      throw new ConflictException(
        "Reload the saved business before changing its logo.",
      );
    const image = await prepareImage(file.buffer);
    const key = `businesses/${businessId}/logos/${randomUUID()}.webp`;
    try {
      await this.storage.put(key, image.preview, "image/webp");
      const saved = await this.db.$transaction(async (tx) => {
        const changed = await tx.business.updateMany({
          where: { id: businessId, version },
          data: { logoKey: key, version: { increment: 1 } },
        });
        if (!changed.count)
          throw new ConflictException(
            "The business changed. Reload before uploading again.",
          );
        return tx.business.findUniqueOrThrow({ where: { id: businessId } });
      });
      if (original.logoKey) await this.storage.discard([original.logoKey]);
      return saved;
    } catch (error) {
      // An uncertain commit must never delete the business's current logo.
      const current = await this.db.business
        .findUnique({ where: { id: businessId }, select: { logoKey: true } })
        .catch(() => undefined);
      if (current !== undefined && current?.logoKey !== key)
        await this.storage.discard([key]);
      throw error;
    }
  }
  @Delete("logo")
  async remove(
    @Req() req: Request,
    @Headers("x-business-version") rawVersion: string,
  ) {
    const businessId = currentBusinessId(req);
    const version = this.version(rawVersion);
    const result = await this.db.$transaction(async (tx) => {
      const previous = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
      });
      const changed = await tx.business.updateMany({
        where: { id: businessId, version },
        data: { logoKey: null, version: { increment: 1 } },
      });
      if (!changed.count)
        throw new ConflictException(
          "Reload the saved business before removing its logo.",
        );
      return {
        previous,
        business: await tx.business.findUniqueOrThrow({
          where: { id: businessId },
        }),
      };
    });
    if (result.previous.logoKey)
      await this.storage.discard([result.previous.logoKey]);
    return result.business;
  }
  @Get("logo")
  async file(@Req() req: Request) {
    const id = currentBusinessId(req);
    const business = await this.db.business.findUniqueOrThrow({
      where: { id },
    });
    if (!business.logoKey) throw new NotFoundException("No logo uploaded.");
    return new StreamableFile(
      await this.storage.get(business.logoKey, MAX_BYTES),
      { type: "image/webp", disposition: 'inline; filename="logo.webp"' },
    );
  }
}
