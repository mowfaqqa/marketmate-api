/** All money is integer kobo; quantity is scaled to thousandths. No float arithmetic. */
export const MAX_MONEY = 1_000_000_000_000;
export type SalesLine = {
  productId?: string;
  description: string;
  quantity: string;
  unitPriceKobo: number;
  discountKobo: number;
  taxRate: string;
};
export type CalculatedLine = SalesLine & {
  grossKobo: number;
  netKobo: number;
  taxKobo: number;
  totalKobo: number;
};
export function scaled(value: string, places: number, maximum: bigint): bigint {
  if (!new RegExp(`^(0|[1-9]\\d*)(\\.\\d{1,${places}})?$`).test(value))
    throw new Error(
      `Use a nonnegative decimal with at most ${places} decimal places.`,
    );
  const [whole, fraction = ""] = value.split(".");
  const amount =
    BigInt(whole) * 10n ** BigInt(places) +
    BigInt(fraction.padEnd(places, "0"));
  if (amount > maximum)
    throw new Error("The decimal exceeds the allowed limit.");
  return amount;
}
function money(value: number): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY)
    throw new Error(
      "Money must be whole kobo between zero and NGN 10 billion.",
    );
  return BigInt(value);
}
const round = (value: bigint, divisor: bigint) =>
  (value + divisor / 2n) / divisor;
export function calculate(lines: SalesLine[], deliveryKobo: number) {
  if (lines.length < 1 || lines.length > 50)
    throw new Error("Include between 1 and 50 lines.");
  const taxByRate: Record<string, number> = {};
  let subtotal = 0n,
    discounts = 0n,
    tax = 0n;
  const calculated: CalculatedLine[] = lines.map((line) => {
    if (!line.description.trim() || line.description.length > 500)
      throw new Error("Each line needs a description of up to 500 characters.");
    const quantity = scaled(line.quantity, 3, 1_000_000_000n);
    if (!quantity) throw new Error("Quantity must be greater than zero.");
    const rate = scaled(line.taxRate, 4, 10000n);
    const gross = round(quantity * money(line.unitPriceKobo), 1000n);
    const discount = money(line.discountKobo);
    if (gross > BigInt(MAX_MONEY) || discount > gross)
      throw new Error(
        "Line amount is too large or discount exceeds its gross amount.",
      );
    const net = gross - discount;
    const lineTax = round(net * rate, 10000n);
    subtotal += gross;
    discounts += discount;
    tax += lineTax;
    const rateKey = `${rate / 10000n}.${String(rate % 10000n).padStart(4, "0")}`;
    taxByRate[rateKey] = (taxByRate[rateKey] ?? 0) + Number(lineTax);
    return {
      ...line,
      description: line.description.trim(),
      taxRate: rateKey,
      grossKobo: Number(gross),
      netKobo: Number(net),
      taxKobo: Number(lineTax),
      totalKobo: Number(net + lineTax),
    };
  });
  const total = subtotal - discounts + money(deliveryKobo) + tax;
  if (subtotal > BigInt(MAX_MONEY) || total > BigInt(MAX_MONEY))
    throw new Error("Document total exceeds NGN 10 billion.");
  return {
    lines: calculated,
    totals: {
      calculationPolicyVersion: 1,
      subtotalKobo: Number(subtotal),
      discountKobo: Number(discounts),
      deliveryKobo,
      taxKobo: Number(tax),
      taxByRate,
      totalKobo: Number(total),
    },
  };
}
export type Totals = ReturnType<typeof calculate>["totals"];

export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
