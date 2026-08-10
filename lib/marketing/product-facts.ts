const DEFAULT_PRICE_CENTS = 2_499;
const DEFAULT_FREE_ESSAY_LIMIT = 1;
const DEFAULT_PAID_ESSAY_LIMIT = 20;

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : fallback;
}

export function getPublicProductFacts() {
  return {
    freeEssayLimit: positiveInteger(
      process.env.FREE_ESSAY_LIMIT,
      DEFAULT_FREE_ESSAY_LIMIT,
    ),
    paidEssayLimit: positiveInteger(
      process.env.PAID_ESSAY_LIMIT,
      DEFAULT_PAID_ESSAY_LIMIT,
    ),
    price: new Intl.NumberFormat("en-US", {
      currency: "USD",
      style: "currency",
    }).format(
      positiveInteger(
        process.env.SEASON_PASS_PRICE_CENTS,
        DEFAULT_PRICE_CENTS,
      ) / 100,
    ),
    season: "2026–2027",
  } as const;
}
