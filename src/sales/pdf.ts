import PDFDocument from "pdfkit";
import { CalculatedLine, Totals } from "./money";
export type PdfSale = {
  type: string;
  status: string;
  number: string | null;
  issueDate: string | null;
  dueDate: string;
  seller: unknown;
  buyer: unknown;
  lines: unknown;
  totals: unknown;
  notes: string;
  paymentInstructions: string;
  voidReason: string | null;
  templateVersion: number;
  sourceQuotationId: string | null;
  replacesId: string | null;
};
const amount = (kobo: number) =>
  `NGN ${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** Version 1: text flows between pages; no remote HTML, URLs or user templates. */
export function renderSalesPdf(sale: PdfSale): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 48, left: 48, right: 48, bottom: 72 },
      bufferPages: true,
      info: {
        Title: `${sale.type} ${sale.number ?? "Draft"}`,
        Author: "MarketMate",
        CreationDate: new Date("2026-01-01T00:00:00Z"),
        ModDate: new Date("2026-01-01T00:00:00Z"),
      },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont(
      "Body",
      require.resolve(
        "@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff",
      ),
    );
    doc.font("Body").fontSize(10);
    const text = (value: string, size = 10) => {
      doc.fontSize(size).text(value, { width: 499, lineGap: 3 });
    };
    const heading = (value: string) => {
      if (doc.y > 715) doc.addPage();
      doc.moveDown(0.6);
      text(value, 12);
      doc.moveDown(0.3);
    };
    text("MarketMate · Sales document", 10);
    doc.moveDown();
    text(
      `${sale.status === "VOID" ? "VOID · " : sale.status === "DRAFT" ? "DRAFT · " : ""}${sale.type}`,
      22,
    );
    text(sale.number ?? "Preview — not issued", 14);
    text(
      `Issue date: ${sale.issueDate ?? "Not issued"}  |  ${sale.type === "QUOTATION" ? "Valid until" : "Due date"}: ${sale.dueDate}`,
    );
    const seller = sale.seller as {
      name: string;
      location: string;
      contact: string | null;
    };
    const buyer = sale.buyer as {
      name: string;
      address: string;
      email: string;
      phone: string;
    };
    heading("From");
    text(
      [seller.name, seller.location, seller.contact].filter(Boolean).join("\n"),
    );
    heading("To");
    text(
      [buyer.name, buyer.address, buyer.email, buyer.phone]
        .filter(Boolean)
        .join("\n"),
    );
    heading("Items");
    (sale.lines as CalculatedLine[]).forEach((line, index) => {
      if (doc.y > 650) doc.addPage();
      text(`${index + 1}. ${line.description}`, 11);
      text(
        `Quantity ${line.quantity} × ${amount(line.unitPriceKobo)} | Gross ${amount(line.grossKobo)}`,
      );
      text(
        `Discount ${amount(line.discountKobo)} | Net ${amount(line.netKobo)}`,
      );
      text(
        `Tax ${(Number(line.taxRate) * 100).toFixed(2)}%: ${amount(line.taxKobo)} | Line total ${amount(line.totalKobo)}`,
      );
      doc.moveDown(0.5);
    });
    const totals = sale.totals as Totals;
    heading("Totals");
    text(
      `Subtotal: ${amount(totals.subtotalKobo)}\nLine discounts: ${amount(totals.discountKobo)}\nDelivery (non-taxed): ${amount(totals.deliveryKobo)}`,
    );
    for (const [rate, tax] of Object.entries(totals.taxByRate))
      text(`Tax ${(Number(rate) * 100).toFixed(2)}%: ${amount(tax)}`);
    text(`Total: ${amount(totals.totalKobo)}`, 16);
    if (sale.paymentInstructions) {
      heading("Payment instructions");
      text(sale.paymentInstructions);
    }
    if (sale.notes) {
      heading("Notes and terms");
      text(sale.notes);
    }
    if (sale.voidReason) {
      heading("Void reason");
      text(sale.voidReason);
    }
    if (sale.sourceQuotationId) {
      heading("Linked quotation");
      text(sale.sourceQuotationId);
    }
    if (sale.replacesId) {
      heading("Replaces voided document");
      text(sale.replacesId);
    }
    doc.moveDown();
    text(
      "Payments are recorded separately by the owner and are not bank-verified. This document does not certify payment.",
      9,
    );
    const pages = doc.bufferedPageRange();
    for (let page = 0; page < pages.count; page++) {
      doc.switchToPage(page);
      doc
        .fontSize(8)
        .text(
          `MarketMate · Template ${sale.templateVersion} · Page ${page + 1} of ${pages.count}`,
          48,
          795,
          { lineBreak: false },
        );
    }
    doc.end();
  });
}
