import type { Metadata } from 'next';
import { OffersBrowser } from '@/components/offers/offers-browser';
import { requirePageViewer } from '@/lib/auth';
import { paymentMode, publicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Deals near you' };

export default async function OffersPage() {
  await requirePageViewer('customer');
  return <OffersBrowser map={publicEnv.map} payment={{ mode: paymentMode(), publishableKey: publicEnv.stripePublishableKey }} />;
}
