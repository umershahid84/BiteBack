// All money is handled in integer cents. Rates are in basis points (1 bp = 0.01%).
// The database function public.price_quote() uses the same math; checkout always uses the database.

export const roundHalfUp = (n: number) => Math.floor(n + 0.5);

export const discountedUnitPrice = (originalCents: number, discountPct: number) =>
  roundHalfUp((originalCents * (100 - discountPct)) / 100);

export type Quote = {
  quantity: number;
  originalUnitCents: number;
  discountPct: number;
  unitPriceCents: number;
  subtotalCents: number;
  savingsCents: number;
  serviceFeeBps: number;
  serviceFeeCents: number;
  taxRateBps: number;
  taxCents: number;
  totalCents: number;
};

export function quote(q: {
  originalUnitCents: number;
  discountPct: number;
  quantity: number;
  serviceFeeBps: number;
  taxRateBps: number;
  taxServiceFee?: boolean;
}): Quote {
  const unitPriceCents = discountedUnitPrice(q.originalUnitCents, q.discountPct);
  const subtotalCents = unitPriceCents * q.quantity;
  const serviceFeeCents = roundHalfUp((subtotalCents * q.serviceFeeBps) / 10000);
  const taxableCents = subtotalCents + (q.taxServiceFee ? serviceFeeCents : 0);
  const taxCents = roundHalfUp((taxableCents * q.taxRateBps) / 10000);
  return {
    quantity: q.quantity,
    originalUnitCents: q.originalUnitCents,
    discountPct: q.discountPct,
    unitPriceCents,
    subtotalCents,
    savingsCents: (q.originalUnitCents - unitPriceCents) * q.quantity,
    serviceFeeBps: q.serviceFeeBps,
    serviceFeeCents,
    taxRateBps: q.taxRateBps,
    taxCents,
    totalCents: subtotalCents + serviceFeeCents + taxCents,
  };
}

// The restaurant's share of an order is the food subtotal. A refund to the original payment takes
// the same proportion of the food subtotal back from the restaurant (the rest is fee and tax).
export const restaurantShareOfRefund = (refundCents: number, subtotalCents: number, totalCents: number) =>
  totalCents ? Math.round((refundCents * subtotalCents) / totalCents) : 0;
