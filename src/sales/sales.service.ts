import { lagosToday } from "../infrastructure/lagos-date";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { Database } from "../infrastructure/database";
import { calculate, validDate } from "./money";
import {
  CustomerInput,
  CustomerUpdate,
  DocumentInput,
  DocumentUpdate,
  IssueInput,
  ListQuery,
  PaymentInput,
  ReasonInput,
} from "./sales.dto";
const include = {
  payments: {
    include: { reversal: true },
    orderBy: { createdAt: "asc" as const },
  },
  convertedInvoice: { select: { id: true } },
  replacement: { select: { id: true } },
};
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? Number(v) : v)),
  );
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

@Injectable()
export class Sales {
  constructor(private readonly db: Database) {}

  /** One short transaction per mutation; business lock serializes numbering and balances. */
  private async transaction<T>(
    businessId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Business" WHERE id = ${businessId} FOR UPDATE`;
      return work(tx);
    });
  }
  private async once(
    businessId: string,
    key: string | undefined,
    operation: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) {
    if (!key || !/^[a-zA-Z0-9_-]{16,100}$/.test(key))
      throw new BadRequestException(
        "Send an Idempotency-Key of 16–100 letters, numbers, underscores or hyphens.",
      );
    const hash = fingerprint(operation);
    return this.transaction(businessId, async (tx) => {
      const existing = await tx.salesAction.findUnique({
        where: { businessId_key: { businessId, key } },
      });
      if (existing) {
        if (existing.fingerprint !== hash)
          throw new ConflictException(
            "This request key was already used with different details.",
          );
        return existing.result;
      }
      const result = json(await work(tx));
      await tx.salesAction.create({
        data: { businessId, key, fingerprint: hash, result },
      });
      return result;
    });
  }
  private async customer(
    businessId: string,
    id: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.customer.findUnique({
      where: { businessId_id: { businessId, id } },
    });
    if (!row) throw new NotFoundException("Customer not found.");
    return row;
  }
  private customerFields(input: CustomerInput) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Enter a customer name.");
    return {
      name,
      email: input.email.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
    };
  }
  async customers(businessId: string, query: ListQuery) {
    const where = {
      businessId,
      name: { contains: query.search, mode: "insensitive" as const },
    };
    const [items, total] = await this.db.$transaction([
      this.db.customer.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * 20,
        take: 20,
      }),
      this.db.customer.count({ where }),
    ]);
    return { items, total, page: query.page };
  }
  getCustomer(businessId: string, id: string) {
    return this.customer(businessId, id);
  }
  createCustomer(
    businessId: string,
    key: string | undefined,
    input: CustomerInput,
  ) {
    const data = this.customerFields(input);
    return this.once(businessId, key, ["customer", data], (tx) =>
      tx.customer.create({ data: { ...data, businessId } }),
    );
  }
  updateCustomer(businessId: string, id: string, input: CustomerUpdate) {
    return this.transaction(businessId, async (tx) => {
      const customer = await this.customer(businessId, id, tx);
      this.version(customer.version, input.version);
      return tx.customer.update({
        where: { id },
        data: { ...this.customerFields(input), version: { increment: 1 } },
      });
    });
  }
  async owned(
    businessId: string,
    id: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    const row = await tx.salesDocument.findUnique({
      where: { businessId_id: { businessId, id } },
      include,
    });
    if (!row) throw new NotFoundException("Document not found.");
    return row;
  }
  private version(actual: number, expected: number) {
    if (actual !== expected)
      throw new ConflictException(
        "This record changed. Copy your edits and reload before continuing.",
      );
  }
  view(row: Awaited<ReturnType<Sales["owned"]>>) {
    const balanceKobo = Number(row.totalKobo - row.paidKobo);
    const paymentState =
      row.type !== "INVOICE" || row.status !== "ISSUED"
        ? null
        : balanceKobo === 0
          ? "PAID"
          : row.paidKobo > 0n
            ? "PARTIAL"
            : "UNPAID";
    const { pdfKey, pdfToken, pdfLeaseUntil, ...safe } = row;
    return {
      ...JSON.parse(
        JSON.stringify(safe, (_, v) => (typeof v === "bigint" ? Number(v) : v)),
      ),
      balanceKobo,
      paymentState,
      overdue:
        row.type === "INVOICE" &&
        row.status === "ISSUED" &&
        balanceKobo > 0 &&
        row.dueDate < lagosToday(),
      manualPayments: true,
    };
  }
  async get(businessId: string, id: string) {
    return this.view(await this.owned(businessId, id));
  }
  async list(businessId: string, query: ListQuery) {
    for (const date of [query.from, query.to])
      if (date && !validDate(date))
        throw new BadRequestException("Invalid date filter.");
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException("The end date must follow the start date.");
    const where: Prisma.SalesDocumentWhereInput = {
      businessId,
      type: query.type,
      customerId: query.customerId,
    };
    if (query.from || query.to)
      where.createdAt = {
        ...(query.from
          ? { gte: new Date(`${query.from}T00:00:00+01:00`) }
          : {}),
        ...(query.to
          ? {
              lt: new Date(
                new Date(`${query.to}T00:00:00+01:00`).getTime() + 86400000,
              ),
            }
          : {}),
      };
    if (query.search)
      where.OR = [
        { number: { contains: query.search, mode: "insensitive" } },
        { customer: { name: { contains: query.search, mode: "insensitive" } } },
      ];
    if (query.status && ["DRAFT", "ISSUED", "VOID"].includes(query.status))
      where.status = query.status;
    if (
      query.status &&
      ["PAID", "PARTIAL", "UNPAID", "OVERDUE"].includes(query.status)
    ) {
      where.status = "ISSUED";
      where.type = "INVOICE";
      if (query.status === "PAID")
        where.paidKobo = { equals: this.db.salesDocument.fields.totalKobo };
      else if (query.status === "UNPAID") {
        where.paidKobo = 0;
        where.totalKobo = { gt: 0 };
      } else {
        where.paidKobo = {
          ...(query.status === "PARTIAL" ? { gt: 0 } : {}),
          lt: this.db.salesDocument.fields.totalKobo,
        };
      }
      if (query.status === "OVERDUE") where.dueDate = { lt: lagosToday() };
    }
    const [rows, total] = await this.db.$transaction([
      this.db.salesDocument.findMany({
        where,
        include,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * 20,
        take: 20,
      }),
      this.db.salesDocument.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.view(row)),
      total,
      page: query.page,
    };
  }
  private async fields(
    tx: Prisma.TransactionClient,
    businessId: string,
    input: DocumentInput,
  ) {
    if (!validDate(input.dueDate))
      throw new BadRequestException("Enter a valid due or validity date.");
    const customer = await this.customer(businessId, input.customerId, tx);
    const productIds = [
      ...new Set(
        input.lines.flatMap((line) => (line.productId ? [line.productId] : [])),
      ),
    ];
    const count = await tx.product.count({
      where: { businessId, id: { in: productIds } },
    });
    if (count !== productIds.length)
      throw new NotFoundException("A selected product was not found.");
    let result;
    try {
      result = calculate(input.lines, input.deliveryKobo);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
    });
    return {
      type: input.type,
      customerId: input.customerId,
      dueDate: input.dueDate,
      notes: input.notes,
      paymentInstructions: input.paymentInstructions,
      seller: {
        name: business.name,
        location: business.location,
        contact: business.contact,
      },
      buyer: this.customerFields(customer),
      lines: json(result.lines),
      totals: json(result.totals),
      totalKobo: BigInt(result.totals.totalKobo),
    };
  }
  create(businessId: string, key: string | undefined, input: DocumentInput) {
    return this.once(businessId, key, ["create", input], async (tx) =>
      this.view(
        await tx.salesDocument.create({
          data: { businessId, ...(await this.fields(tx, businessId, input)) },
          include,
        }),
      ),
    );
  }
  update(businessId: string, id: string, input: DocumentUpdate) {
    return this.transaction(businessId, async (tx) => {
      const row = await this.owned(businessId, id, tx);
      this.version(row.version, input.version);
      if (row.status !== "DRAFT")
        throw new ConflictException("Issued documents cannot be edited.");
      if (input.type !== row.type)
        throw new BadRequestException(
          "Document type cannot change. Create a new document instead.",
        );
      const fields = await this.fields(tx, businessId, input);
      // Conversion snapshots remain intact unless the owner explicitly changes the customer.
      if (row.sourceQuotationId || row.replacesId) {
        fields.seller = row.seller as typeof fields.seller;
        if (row.customerId === input.customerId)
          fields.buyer = row.buyer as typeof fields.buyer;
      }
      return this.view(
        await tx.salesDocument.update({
          where: { id },
          data: {
            ...fields,
            version: { increment: 1 },
            pdfRevision: { increment: 1 },
            pdfStatus: "NONE",
            pdfKey: null,
            pdfToken: null,
          },
          include,
        }),
      );
    });
  }
  issue(
    businessId: string,
    id: string,
    actor: string,
    key: string | undefined,
    input: IssueInput,
  ) {
    return this.once(businessId, key, ["issue", id, input], async (tx) => {
      const row = await this.owned(businessId, id, tx);
      if (row.status === "ISSUED") return this.view(row);
      this.version(row.version, input.version);
      if (row.status !== "DRAFT")
        throw new ConflictException("Only drafts can be issued.");
      if (row.dueDate < lagosToday())
        throw new BadRequestException(
          "The due or validity date cannot be before the issue date.",
        );
      if (!(row.seller as { name: string }).name.trim())
        throw new BadRequestException(
          "Save your business name and save this draft again before issuing.",
        );
      const lines = row.lines as unknown as { taxRate: string }[];
      if (lines.some((line) => Number(line.taxRate) > 0) && !input.taxConfirmed)
        throw new BadRequestException(
          "Confirm the selected tax settings before issuing.",
        );
      if (
        process.env.NODE_ENV === "production" &&
        process.env.SALES_LAUNCH_APPROVED !== "true"
      )
        throw new ConflictException(
          "Sales issuance awaits the finance and retention launch review. Drafts remain available.",
        );
      const field =
        row.type === "INVOICE" ? "invoiceSequence" : "quotationSequence";
      const business = await tx.business.update({
        where: { id: businessId },
        data: { [field]: { increment: 1 } },
      });
      const number = `${row.type === "INVOICE" ? "INV" : "QUO"}-${String(business[field]).padStart(6, "0")}`;
      return this.view(
        await tx.salesDocument.update({
          where: { id },
          data: {
            status: "ISSUED",
            number,
            issueDate: lagosToday(),
            issuedAt: new Date(),
            issuedBy: actor,
            taxConfirmed: input.taxConfirmed,
            version: { increment: 1 },
            pdfRevision: { increment: 1 },
            pdfStatus: "PENDING",
            pdfToken: null,
            pdfKey: null,
          },
          include,
        }),
      );
    });
  }
  convert(
    businessId: string,
    id: string,
    key: string | undefined,
    version: number,
    replacement = false,
  ) {
    return this.once(
      businessId,
      key,
      [replacement ? "replace" : "convert", id, version],
      async (tx) => {
        const row = await this.owned(businessId, id, tx);
        const previous = replacement ? row.replacement : row.convertedInvoice;
        if (previous)
          return this.view(await this.owned(businessId, previous.id, tx));
        this.version(row.version, version);
        if (
          replacement
            ? row.status !== "VOID"
            : row.type !== "QUOTATION" ||
              row.status !== "ISSUED" ||
              row.dueDate < lagosToday()
        )
          throw new ConflictException(
            replacement
              ? "Only voided documents can be replaced."
              : "Only valid issued quotations can be converted.",
          );
        return this.view(
          await tx.salesDocument.create({
            data: {
              businessId,
              customerId: row.customerId,
              type: replacement ? row.type : "INVOICE",
              seller: row.seller as Prisma.InputJsonValue,
              buyer: row.buyer as Prisma.InputJsonValue,
              lines: row.lines as Prisma.InputJsonValue,
              totals: row.totals as Prisma.InputJsonValue,
              totalKobo: row.totalKobo,
              dueDate: row.dueDate,
              notes: row.notes,
              paymentInstructions: row.paymentInstructions,
              ...(replacement ? { replacesId: id } : { sourceQuotationId: id }),
            },
            include,
          }),
        );
      },
    );
  }
  payment(
    businessId: string,
    id: string,
    actor: string,
    key: string | undefined,
    input: PaymentInput,
  ) {
    return this.once(businessId, key, ["payment", id, input], async (tx) => {
      const row = await this.owned(businessId, id, tx);
      this.version(row.version, input.version);
      if (row.type !== "INVOICE" || row.status !== "ISSUED")
        throw new ConflictException("Record payments only on issued invoices.");
      if (!validDate(input.date) || input.date > lagosToday())
        throw new BadRequestException(
          "Enter a valid payment date that is not in the future.",
        );
      if (BigInt(input.amountKobo) > row.totalKobo - row.paidKobo)
        throw new BadRequestException(
          "Payment exceeds the outstanding balance.",
        );
      await tx.manualPayment.create({
        data: {
          businessId,
          documentId: id,
          amountKobo: input.amountKobo,
          date: input.date,
          method: input.method,
          reference: input.reference,
          recordedBy: actor,
        },
      });
      return this.view(
        await tx.salesDocument.update({
          where: { id },
          data: {
            paidKobo: { increment: input.amountKobo },
            version: { increment: 1 },
          },
          include,
        }),
      );
    });
  }
  reverse(
    businessId: string,
    paymentId: string,
    actor: string,
    key: string | undefined,
    input: ReasonInput,
  ) {
    return this.once(
      businessId,
      key,
      ["reverse", paymentId, input],
      async (tx) => {
        const payment = await tx.manualPayment.findUnique({
          where: { businessId_id: { businessId, id: paymentId } },
          include: { reversal: true },
        });
        if (!payment) throw new NotFoundException("Payment not found.");
        const row = await this.owned(businessId, payment.documentId, tx);
        if (payment.reversal) return this.view(row);
        this.version(row.version, input.version);
        if (!input.reason.trim())
          throw new BadRequestException("Enter a reversal reason.");
        await tx.paymentReversal.create({
          data: { paymentId, reason: input.reason.trim(), recordedBy: actor },
        });
        return this.view(
          await tx.salesDocument.update({
            where: { id: row.id },
            data: {
              paidKobo: { decrement: payment.amountKobo },
              version: { increment: 1 },
            },
            include,
          }),
        );
      },
    );
  }
  void(
    businessId: string,
    id: string,
    actor: string,
    key: string | undefined,
    input: ReasonInput,
  ) {
    return this.once(businessId, key, ["void", id, input], async (tx) => {
      const row = await this.owned(businessId, id, tx);
      this.version(row.version, input.version);
      if (row.status !== "ISSUED" || row.paidKobo !== 0n)
        throw new ConflictException(
          "Only issued documents with no unreversed payments can be voided.",
        );
      if (!input.reason.trim())
        throw new BadRequestException("Enter a void reason.");
      return this.view(
        await tx.salesDocument.update({
          where: { id },
          data: {
            status: "VOID",
            voidReason: input.reason.trim(),
            voidedAt: new Date(),
            voidedBy: actor,
            version: { increment: 1 },
            pdfRevision: { increment: 1 },
            pdfStatus: "PENDING",
            pdfToken: null,
            pdfKey: null,
          },
          include,
        }),
      );
    });
  }
  remove(businessId: string, id: string, version: number) {
    return this.transaction(businessId, async (tx) => {
      const row = await this.owned(businessId, id, tx);
      this.version(row.version, version);
      if (row.status !== "DRAFT" || row.sourceQuotationId || row.replacesId)
        throw new ConflictException(
          "Only unlinked drafts can be deleted. Linked drafts preserve conversion and replacement history.",
        );
      await tx.salesDocument.delete({ where: { id } });
      return { deleted: true };
    });
  }
}
