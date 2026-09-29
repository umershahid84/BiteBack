import type { Metadata } from 'next';
import { AccountPanel } from '@/components/account/account-panel';
import { requirePageViewer } from '@/lib/auth';
import { paymentMode, publicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Account' };

export default async function AccountPage() {
  const viewer = await requirePageViewer('customer');
  return (
    <main className="container-page max-w-[900px] py-8">
      <h1 className="text-3xl font-extrabold">Account</h1>
      <AccountPanel
        username={viewer.username}
        email={viewer.email}
        payment={{ mode: paymentMode(), publishableKey: publicEnv.stripePublishableKey }}
      />
    </main>
  );
}
