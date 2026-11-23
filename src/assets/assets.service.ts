import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { Database } from "../infrastructure/database";
import { currentBusinessId, type Request } from "../auth/session.guard";
import { Catalogue, productView } from "../catalogue/catalogue.service";
import { UploadInput } from "../catalogue/catalogue.dto";
import { digest, token } from "../auth/security";
import { R2Storage } from "../infrastructure/r2";

import { MAX_BYTES, prepareImage } from "./image";
@Injectable()
export class Assets {
  private readonly signingKey: string;
  private processing = 0;
  constructor(
    private readonly db: Database,
    private readonly catalogue: Catalogue,
    private readonly storage: R2Storage,
  ) {
    if (
      process.env.NODE_ENV === "production" &&
      (process.env.ASSET_SIGNING_KEY?.length || 0) < 32
    )
      throw new Error("ASSET_SIGNING_KEY must contain at least 32 characters.");
    this.signingKey =
      process.env.ASSET_SIGNING_KEY || randomBytes(32).toString("hex");
  }

  async authorizeUpload(req: Request, productId: string, input: UploadInput) {
    const businessId = currentBusinessId(req);
    const product = await this.catalogue.owned(businessId, productId);
    if (product.archivedAt || product.version !== input.version)
      throw new ConflictException(
        "Reload the active saved product before adding a photo.",
      );
    this.storage.requireConfigured();
    const pending = await this.db.mediaAsset.count({
      where: {
        businessId,
        status: "PENDING",
        uploadExpiresAt: { gt: new Date() },
      },
    });
    if (pending >= 5)
      throw new ConflictException(
        "Finish your pending photo uploads or wait 15 minutes before starting another.",
      );
    const uploadToken = token();
    const asset = await this.db.mediaAsset.create({
      data: {
        businessId,
        productId,
        productVersion: input.version,
        uploadTokenHash: digest(uploadToken),
        uploadExpiresAt: new Date(Date.now() + 15 * 60000),
      },
    });
    return { id: asset.id, uploadToken, expiresAt: asset.uploadExpiresAt };
  }

  async complete(
    req: Request,
    id: string,
    rawToken: string | undefined,
    file: { buffer: Buffer } | undefined,
  ) {
    const businessId = currentBusinessId(req);
    const asset = await this.db.mediaAsset.findUnique({
      where: { businessId_id: { businessId, id } },
      omit: { content: true, preview: true },
    });
    if (!asset) throw new NotFoundException("Photo not found.");
    if (
      !rawToken ||
      digest(rawToken) !== asset.uploadTokenHash ||
      asset.uploadExpiresAt <= new Date()
    )
      throw new BadRequestException(
        "This upload authorization expired or is invalid. Start the upload again.",
      );
    if (asset.status === "DELETING")
      throw new NotFoundException("Photo not found.");
    if (asset.status === "READY")
      return productView(
        await this.catalogue.owned(businessId, asset.productId),
      );
    if (!file) throw new BadRequestException("Choose a photo to upload.");
    if (this.processing >= 2)
      throw new ServiceUnavailableException(
        "Other photos are being prepared. Keep this page open and retry shortly.",
      );
    this.storage.requireConfigured();
    this.processing++;
    let staged: { fullKey: string; previewKey: string } | undefined;
    try {
      let prepared;
      try {
        prepared = await prepareImage(file.buffer);
      } catch (error) {
        await this.db.mediaAsset.updateMany({
          where: { businessId, id, status: { in: ["PENDING", "REJECTED"] } },
          data: { status: "REJECTED" },
        });
        throw error;
      }
      const prefix = `businesses/${businessId}/photos/${asset.objectKey}/${randomUUID()}`;
      staged = {
        fullKey: `${prefix}/full.webp`,
        previewKey: `${prefix}/preview.webp`,
      };
      const { content, preview, ...metadata } = prepared;
      const writes = await Promise.allSettled([
        this.storage.put(staged.fullKey, content, "image/webp"),
        this.storage.put(staged.previewKey, preview, "image/webp"),
      ]);
      const failed = writes.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      const keys = staged;
      const result = await this.db.$transaction(async (tx) => {
        const claimed = await tx.mediaAsset.updateMany({
          where: {
            businessId,
            id,
            status: { in: ["PENDING", "REJECTED"] },
            uploadExpiresAt: { gt: new Date() },
          },
          data: { ...metadata, ...keys, status: "READY" },
        });
        if (!claimed.count) {
          const current = await tx.mediaAsset.findUnique({
            where: { businessId_id: { businessId, id } },
            select: { status: true },
          });
          if (current?.status !== "READY")
            throw new ConflictException(
              "This upload ended before the photo was saved. Start it again.",
            );
          return {
            attached: false,
            product: productView(
              await this.catalogue.owned(businessId, asset.productId, tx),
            ),
          };
        }
        await this.catalogue.bump(
          tx,
          businessId,
          asset.productId,
          asset.productVersion,
        );
        const product = await this.catalogue.owned(
          businessId,
          asset.productId,
          tx,
        );
        if (product.archivedAt)
          throw new ConflictException(
            "Restore the product before adding a photo.",
          );
        await tx.product.update({
          where: { businessId_id: { businessId, id: asset.productId } },
          data: { primaryAssetId: id },
        });
        return {
          attached: true,
          product: productView(
            await this.catalogue.owned(businessId, asset.productId, tx),
          ),
        };
      });
      if (!result.attached) await this.storage.discard(Object.values(keys));
      return result.product;
    } catch (error) {
      if (staged) {
        const current = await this.db.mediaAsset
          .findUnique({
            where: { businessId_id: { businessId, id } },
            select: { fullKey: true },
          })
          .catch(() => undefined);
        if (current !== undefined && current?.fullKey !== staged.fullKey)
          await this.storage.discard(Object.values(staged));
      }
      throw error;
    } finally {
      this.processing--;
    }
  }

  async remove(req: Request, id: string) {
    const businessId = currentBusinessId(req);
    const asset = await this.db.mediaAsset.findUnique({
      where: { businessId_id: { businessId, id } },
      select: { id: true },
    });
    if (!asset) throw new NotFoundException("Photo not found.");
    const removed = await this.db.mediaAsset.updateMany({
      where: {
        businessId,
        id,
        status: { in: ["READY", "DELETING"] },
        primaryFor: { none: {} },
      },
      data: { status: "DELETING" },
    });
    if (!removed.count)
      throw new ConflictException(
        "This photo is still in use or is not ready for removal.",
      );
    const keys = await this.db.mediaAsset.findUniqueOrThrow({
      where: { businessId_id: { businessId, id } },
      select: { fullKey: true, previewKey: true },
    });
    for (const key of [keys.fullKey, keys.previewKey])
      if (key) await this.storage.remove(key);
    await this.db.mediaAsset.updateMany({
      where: { businessId, id, status: "DELETING" },
      data: { fullKey: null, previewKey: null, content: null, preview: null },
    });
    return { message: "Unreferenced photo removed." };
  }

  private signature(
    id: string,
    sessionId: string,
    size: string,
    expires: string,
  ) {
    return createHmac("sha256", this.signingKey)
      .update(`${id}:${sessionId}:${size}:${expires}`)
      .digest("hex");
  }

  async authorizeRead(req: Request, id: string) {
    const businessId = currentBusinessId(req);
    const asset = await this.db.mediaAsset.findUnique({
      where: { businessId_id: { businessId, id } },
      select: { status: true },
    });
    if (!asset || asset.status !== "READY")
      throw new NotFoundException("Photo not found.");
    const expires = String(Date.now() + 2 * 60000);
    const url = (size: string) =>
      `/api/assets/${id}/file?size=${size}&expires=${expires}&signature=${this.signature(id, req.sessionId, size, expires)}`;
    return {
      previewUrl: url("preview"),
      fullUrl: url("full"),
      expiresAt: new Date(Number(expires)).toISOString(),
    };
  }

  async read(
    req: Request,
    id: string,
    size: string,
    expires: string,
    signature: string,
  ) {
    const businessId = currentBusinessId(req);
    if (
      !["preview", "full"].includes(size) ||
      !/^\d{13}$/.test(expires || "") ||
      Number(expires) <= Date.now() ||
      Number(expires) > Date.now() + 2 * 60000 ||
      !/^[a-f0-9]{64}$/.test(signature || "")
    )
      throw new NotFoundException(
        "This photo link has expired. Reload the page.",
      );
    const expected = this.signature(id, req.sessionId, size, expires);
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
      throw new NotFoundException("Photo not found.");
    return this.readOwned(businessId, id, size === "full" ? "full" : "preview");
  }

  async readOwned(businessId: string, id: string, size: "full" | "preview") {
    const asset = await this.db.mediaAsset.findUnique({
      where: { businessId_id: { businessId, id } },
      select: {
        status: true,
        storageProvider: true,
        fullKey: true,
        previewKey: true,
      },
    });
    if (!asset || asset.status !== "READY")
      throw new NotFoundException("Photo not found.");
    const key = size === "full" ? asset.fullKey : asset.previewKey;
    if (key) return this.storage.get(key, MAX_BYTES);
    if (asset.storageProvider === "LEGACY_DB") {
      const legacy = await this.db.mediaAsset.findUnique({
        where: { businessId_id: { businessId, id }, status: "READY" },
        select: { content: size === "full", preview: size === "preview" },
      });
      const bytes = size === "full" ? legacy?.content : legacy?.preview;
      if (bytes) return Buffer.from(bytes);
    }
    throw new NotFoundException("Photo not found.");
  }
}
