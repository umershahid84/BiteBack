// All money is handled in integer cents. Rates are in basis points (1 bp = 0.01%).

function roundHalfUp(n) {
  return Math.floor(n + 0.5);
}

function discountedUnitPrice(originalCents, discountPct) {
  return roundHalfUp((originalCents * (100 - discountPct)) / 100);
}

function quote({ originalUnitCents, discountPct, quantity, serviceFeeBps, taxRateBps, taxServiceFee = false }) {
  const unitPriceCents = discountedUnitPrice(originalUnitCents, discountPct);
  const subtotalCents = unitPriceCents * quantity;
  const serviceFeeCents = roundHalfUp((subtotalCents * serviceFeeBps) / 10000);
  const taxableCents = subtotalCents + (taxServiceFee ? serviceFeeCents : 0);
  const taxCents = roundHalfUp((taxableCents * taxRateBps) / 10000);
  return {
    quantity,
    originalUnitCents,
    discountPct,
    unitPriceCents,
    subtotalCents,
    savingsCents: (originalUnitCents - unitPriceCents) * quantity,
    serviceFeeBps,
    serviceFeeCents,
    taxRateBps,
    taxCents,
    totalCents: subtotalCents + serviceFeeCents + taxCents,
  };
}

module.exports = { quote, discountedUnitPrice };
