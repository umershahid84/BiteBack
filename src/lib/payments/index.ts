import 'server-only';
import { paymentMode, serverEnv } from '@/lib/env';
import { createMockProvider } from './mock';
import { createStripeProvider } from './stripe';
import type { PaymentProvider } from './types';

export { PaymentError } from './types';
export type { PaymentProvider } from './types';

let provider: PaymentProvider | undefined;

// Stripe when STRIPE_SECRET_KEY and NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY are set; otherwise the mock processor.
export function payments(): PaymentProvider {
  provider ??= paymentMode() === 'stripe' ? createStripeProvider(serverEnv.stripeSecretKey) : createMockProvider();
  return provider;
}
