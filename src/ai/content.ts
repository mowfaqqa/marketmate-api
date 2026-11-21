import { BadRequestException } from "@nestjs/common";
export type Facts = {
  product: string;
  description: string;
  productVersion: number;
  businessVersion: number;
  brand: string;
  contact: string;
  price: number | null;
  expires: string | null;
  goal: string;
  channel: string;
  tone: string;
  policy: number;
  locale?: string;
  attributes?: {
    materialSize: string;
    serviceArea: string;
    fulfilmentTerms: string;
    confirmedClaims: string;
  };
  plannedDate?: string;
  theme?: string;
  task?: string;
};
export function validateText(text: string, channel: string) {
  const limit =
    channel === "facts"
      ? Infinity
      : channel === "whatsapp"
        ? 600
        : channel === "description"
          ? 800
          : 1200;
  if (
    channel !== "facts" &&
    /\p{Sc}|https?:|\b(?:NGN|naira|kobo)\b|\d{3,}|\d\s*%/iu.test(text)
  )
    throw new BadRequestException(
      "Use saved prices and contacts instead of typing amounts, discounts or links into copy.",
    );
  if (text.length > limit)
    throw new BadRequestException(`Keep the copy within ${limit} characters.`);
  if (
    /\b(weapons?|firearms?|gambling|casino|controlled drugs|cocaine|heroin|sexual services|pornography|guaranteed profits?|risk.free investment|miracle cure|cures?|treats? diabetes|nafdac approved|vote for|elect our|ignore (all |previous |prior )*instructions|system prompt|reveal.*password|fake reviews?)\b/i.test(
      text,
    )
  ) {
    throw new BadRequestException({
      code: "RESTRICTED_CONTENT",
      message:
        "Remove restricted products or unsupported claims before continuing.",
    });
  }
}
export function assemble(text: string, facts: Facts) {
  const price =
    facts.price === null
      ? "Price on request"
      : new Intl.NumberFormat("en-NG", {
          style: "currency",
          currency: "NGN",
        }).format(facts.price / 100);
  const expiry = facts.expires
    ? `\nOffer ends ${new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" }).format(new Date(facts.expires))} (Lagos time)`
    : "";
  return `${text}\n\n${price}${expiry}\nContact ${facts.brand}: ${facts.contact}`;
}

export function validateDraft(text: string, facts: Facts) {
  validateText(text, facts.channel);
  if (
    /(?:only \w+ left|selling out|guaranteed results|best in|cheapest|five.star reviews|clinically proven|doctor.recommended)/i.test(
      text,
    )
  )
    throw new BadRequestException(
      "Remove unsupported scarcity, endorsement or superiority claims.",
    );
  if (/\S+@\S+\.\S+/.test(text))
    throw new BadRequestException(
      "Use the saved public contact instead of an email in generated copy.",
    );
  if (
    facts.goal !== "offer" &&
    /(?:discount|special offer|on sale|limited.time deal)/i.test(text)
  )
    throw new BadRequestException(
      "This brief has no valid offer. Remove offer language.",
    );
  const numbers = text.match(/\d+(?:[.,]\d+)*/g) ?? [];
  const sourceNumbers = new Set(
    [facts.product, facts.description, ...Object.values(facts.attributes ?? {})]
      .join(" ")
      .match(/\d+(?:[.,]\d+)*/g) ?? [],
  );
  if (numbers.some((n) => !sourceNumbers.has(n)))
    throw new BadRequestException(
      "Remove numbers that are not present in the saved product facts.",
    );
  validateText(assemble(text, facts), "facts");
  const limit =
    facts.channel === "whatsapp"
      ? 600
      : facts.channel === "description"
        ? 800
        : 1200;
  if (assemble(text, facts).length > limit)
    throw new BadRequestException(
      "Shorten your copy to leave room for the saved price and contact details.",
    );
}

export function localSamples(facts: Facts, count = 3): string[] {
  const subject =
    facts.goal === "offer"
      ? "See the current offer on"
      : facts.goal === "launch"
        ? "Introducing"
        : "Find out more about";
  const texts =
    facts.channel === "ideas"
      ? [
          `Introduce ${facts.product} in a product spotlight.`,
          `Invite questions about ${facts.product} in a short post.`,
          `Feature ${facts.product} in a catalogue roundup.`,
        ]
      : [
          `${subject} ${facts.product}. ${facts.description}`.trim(),
          `Interested in ${facts.product}? Ask ${facts.brand} for details.`,
          `Explore ${facts.product} from ${facts.brand}.`,
        ];
  const selected = texts.slice(0, count);
  selected.forEach((text) => validateDraft(text, facts));
  return selected;
}
