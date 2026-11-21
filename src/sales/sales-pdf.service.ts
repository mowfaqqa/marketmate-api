import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Database } from "../database";
import { R2Storage } from "../r2";
import { Sales } from "./sales.service";
import { renderSalesPdf } from "./pdf";
@Injectable()
export class SalesPdf implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private readonly logger = new Logger(SalesPdf.name);
  constructor(
    private readonly db: Database,
    private readonly storage: R2Storage,
    private readonly sales: Sales,
  ) {}
  onModuleInit() {
    this.timer = setInterval(
      () =>
        void this.tick().catch(() =>
          this.logger.error("Sales PDF worker failed."),
        ),
      1000,
    );
    this.timer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }
  async request(businessId: string, id: string, version: number) {
    const row = await this.sales.owned(businessId, id);
    if (row.version !== version)
      throw new ConflictException(
        "The document changed. Reload before rendering.",
      );
    if (["NONE", "FAILED"].includes(row.pdfStatus)) {
      await this.db.salesDocument.updateMany({
        where: {
          id,
          businessId,
          version,
          pdfStatus: { in: ["NONE", "FAILED"] },
        },
        data: { pdfStatus: "PENDING", pdfError: null },
      });
    }
    return this.sales.get(businessId, id);
  }
  async download(businessId: string, id: string) {
    const row = await this.sales.owned(businessId, id);
    if (row.pdfStatus !== "READY" || !row.pdfKey)
      throw new ConflictException(
        "The PDF is not ready. Request a render or retry the failed job.",
      );
    const bytes = await this.storage.get(row.pdfKey, 10 * 1024 * 1024);
    const current = await this.sales.owned(businessId, id);
    if (
      current.pdfRevision !== row.pdfRevision ||
      current.pdfStatus !== "READY"
    )
      throw new ConflictException(
        "The document changed. Download its current PDF instead.",
      );
    return {
      bytes,
      filename: `${row.status === "VOID" ? "VOID-" : ""}${row.number ?? `draft-${id}`}.pdf`,
    };
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      // A crashed process leaves a lease that can be reclaimed; no new invoice number is allocated.
      const row = await this.db.salesDocument.findFirst({
        where: {
          OR: [
            { pdfStatus: "PENDING" },
            { pdfStatus: "WORKING", pdfLeaseUntil: { lt: new Date() } },
          ],
        },
        orderBy: { updatedAt: "asc" },
      });
      if (!row) return;
      const token = randomUUID();
      const claimed = await this.db.salesDocument.updateMany({
        where: {
          id: row.id,
          pdfRevision: row.pdfRevision,
          OR: [
            { pdfStatus: "PENDING" },
            { pdfStatus: "WORKING", pdfLeaseUntil: { lt: new Date() } },
          ],
        },
        data: {
          pdfStatus: "WORKING",
          pdfToken: token,
          pdfLeaseUntil: new Date(Date.now() + 60000),
        },
      });
      if (!claimed.count) return;
      const key = `businesses/${row.businessId}/sales/${row.id}/v${row.pdfRevision}-${token}.pdf`;
      try {
        const bytes = await renderSalesPdf(row);
        await this.storage.put(key, bytes, "application/pdf");
        const saved = await this.db.salesDocument.updateMany({
          where: { id: row.id, pdfRevision: row.pdfRevision, pdfToken: token },
          data: {
            pdfStatus: "READY",
            pdfKey: key,
            pdfError: null,
            pdfLeaseUntil: null,
          },
        });
        if (!saved.count) await this.storage.discard([key]);
      } catch {
        await this.db.salesDocument.updateMany({
          where: { id: row.id, pdfRevision: row.pdfRevision, pdfToken: token },
          data: {
            pdfStatus: "FAILED",
            pdfError:
              "PDF creation failed. Your document is saved; retry the PDF.",
            pdfLeaseUntil: null,
          },
        });
      }
    } finally {
      this.running = false;
    }
  }
}
