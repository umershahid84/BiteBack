import { describe, expect, it } from 'vitest';
import { discountedUnitPrice, quote, restaurantShareOfRefund } from '@/lib/pricing';

describe('pricing', () => {
  it('rounds the discounted price half up', () => {
    expect(discountedUnitPrice(1695, 50)).toBe(848); // $8.475 -> $8.48
    expect(discountedUnitPrice(1000, 33)).toBe(670);
  });

  it('builds the full total: food + 5% service fee + WA sales tax', () => {
    const q = quote({ originalUnitCents: 1695, discountPct: 50, quantity: 2, serviceFeeBps: 500, taxRateBps: 1035 });
    expect(q).toMatchObject({ unitPriceCents: 848, subtotalCents: 1696, savingsCents: 1694, serviceFeeCents: 85, taxCents: 176, totalCents: 1957 });
  });

  it('can tax the service fee when configured', () => {
    const q = quote({ originalUnitCents: 1000, discountPct: 50, quantity: 1, serviceFeeBps: 500, taxRateBps: 1000, taxServiceFee: true });
    expect(q.taxCents).toBe(Math.floor((500 + 25) * 0.1 + 0.5));
  });

  it('takes the proportional food share back from the restaurant on refunds', () => {
    expect(restaurantShareOfRefund(489, 848, 978)).toBe(424);
    expect(restaurantShareOfRefund(978, 848, 978)).toBe(848);
    expect(restaurantShareOfRefund(100, 0, 0)).toBe(0);
  });
});
