import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

function limit(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a nonnegative safe integer.`);
  return value;
}
export const capacityLimits = () => ({ activeProducts: limit('ACTIVE_PRODUCT_LIMIT', 50), storageBytes: limit('STORAGE_LIMIT_BYTES', 500 * 1024 * 1024) });
export async function lockBusiness(tx: Prisma.TransactionClient, businessId: string) {
  await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
}
export async function requireProductCapacity(tx: Prisma.TransactionClient, businessId: string) {
  const count = await tx.product.count({ where: { businessId, archivedAt: null } });
  if (count >= capacityLimits().activeProducts) throw new ConflictException('Active product limit reached. Archive a product before adding or restoring another.');
}
export async function reserveStorage(tx: Prisma.TransactionClient, businessId: string, key: string, bytes: number) {
  await lockBusiness(tx, businessId);
  const existing = await tx.storedObject.findUnique({ where: { key } });
  if (existing) {
    if (existing.businessId !== businessId || existing.bytes !== bytes) throw new ConflictException('Stored objects cannot be replaced. Start a fresh upload.');
    return;
  }
  const total = await tx.storedObject.aggregate({ where: { businessId }, _sum: { bytes: true } });
  if ((total._sum.bytes ?? 0) + bytes > capacityLimits().storageBytes) throw new ConflictException('Storage limit reached. Remove unused files before uploading or rendering another.');
  await tx.storedObject.create({ data: { key, businessId, bytes } });
}
